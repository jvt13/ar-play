import test from 'node:test';
import assert from 'node:assert/strict';
import {I, perspective, tr, rx, ry, mul, invert4} from '../src/math.js';
import {createDepthReader} from '../src/depth.js';
import {DepthProjector, SpatialMap} from '../src/spatial-map.js';

const close = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const view = (pose = I(), projection = perspective(Math.PI / 2, 1)) => ({projectionMatrix: projection, transform: {matrix: pose}});
const point = new Float64Array(3);

test('axial depth reconstructs view rays in meters, top-left origin (synthetic)', () => {
  const projector = new DepthProjector();
  assert.ok(projector.configure({}, view(tr(1, 1.5, 3))));
  assert.ok(projector.point(1, .5, 2, point));
  close(point[0], 3); close(point[1], 1.5); close(point[2], 1);
  assert.ok(Math.hypot(point[0] - 1, point[2] - 3) > 2.8); // Not radial depth.
  projector.point(.25, .25, 2, point); close(point[0], 0); close(point[1], 2.5); close(point[2], 1);
  assert.equal(projector.point(.5, .5, 0, point), false);
  assert.equal(projector.point(.5, .5, NaN, point), false);
});

test('camera pitch and yaw reconstruct in the character XR reference (synthetic)', () => {
  const projector = new DepthProjector(), pose = mul(tr(1, 2, 3), mul(ry(Math.PI / 2), rx(-Math.PI / 4)));
  assert.ok(projector.configure({}, view(pose)));
  projector.point(.5, .5, 2, point);
  close(point[0], 1 - Math.SQRT2); close(point[1], 2 - Math.SQRT2); close(point[2], 3);
});

test('asymmetric projection inverse agrees with independent frustum calculation (synthetic)', () => {
  const p = perspective(Math.PI / 2, 1); p[0] = 1; p[5] = 2; p[8] = .2; p[9] = -.2;
  const projector = new DepthProjector(); assert.ok(projector.configure({}, view(I(), p)));
  projector.point(.75, .25, 2, point);
  close(point[0], 1.4); close(point[1], .3); close(point[2], -2);
  const inverse = new Float64Array(16), scratch = new Float64Array(32);
  assert.ok(invert4(inverse, p, scratch));
  const product = mul(p, inverse); for (let i = 0; i < 16; i++) close(product[i], i % 5 === 0 ? 1 : 0);
  assert.equal(invert4(inverse, new Float32Array(16), scratch), false);
});

test('depth UV transform is applied once; out-of-buffer geometry remains unknown (synthetic)', () => {
  const matrix = I(); matrix[0] = -1; matrix[12] = 1;
  const info = {width: 4, height: 2, rawValueToMeters: .001, data: new Uint16Array([1000, 2000, 3000, 4000, 1000, 2000, 3000, 4000]).buffer, normDepthBufferFromNormView: {matrix}};
  const reader = createDepthReader(info, 'luminance-alpha'), projector = new DepthProjector();
  assert.ok(projector.configure(info, view()));
  projector.point(.125, .25, reader.at(.125, .25, true), point);
  close(point[0], -3); close(point[1], 2); close(point[2], -4);
  matrix[12] = 3;
  assert.equal(reader.at(.5, .5, true), null);
  assert.equal(reader.at(.5, .5), 4); // Diagnostic API convention still clamps.
});

test('incompatible sensor geometry is rejected rather than guessed (synthetic)', () => {
  const projector = new DepthProjector(), v = view(), other = new Float32Array(v.projectionMatrix);
  other[8] = .2;
  assert.equal(projector.configure({projectionMatrix: other, transform: {matrix: I()}}, v), false);
  assert.equal(projector.configure({projectionMatrix: v.projectionMatrix, transform: {matrix: tr(.02, 0, 0)}}, v), false);
  assert.equal(projector.configure({transform: {matrix: I()}}, v), false);
  assert.equal(projector.configure({}, view(I(), I())), false);
  assert.ok(projector.configure({projectionMatrix: v.projectionMatrix, transform: v.transform}, v));
  projector.clear(); assert.equal(projector.point(.5, .5, 2, point), false);
});

function anchored(config = {}) { const map = new SpatialMap(config); map.clear([0, 0, 0]); return map; }
function confirm(map, x, y, z) { for (const time of [0, 125, 250]) { map.begin(time, [0, 0, 0], 1); map.observe(x, y, z); } }

test('floor, overhead, non-finite and out-of-ROI points are not obstacles (synthetic)', () => {
  const map = anchored(); map.begin(0, [0, 0, 0], .7);
  for (const y of [-.1, 0, .03, .06, .71, 3]) assert.equal(map.observe(0, y, -.5), false);
  assert.equal(map.observe(NaN, .3, 0), false); assert.equal(map.observe(4, .3, 0), false);
  assert.equal(map.cells.size, 0);
  assert.equal(map.observe(0, .3, -.5), true);
});

test('close observations consolidate, but a single frame never confirms an obstacle (synthetic)', () => {
  const map = anchored(); map.begin(0, [0, 0, 0], 1);
  for (let i = 0; i < 100; i++) map.observe(.02 + i * .0001, .3, -.5);
  assert.equal(map.cells.size, 1); assert.equal(map.occupiedCount, 0);
  map.begin(125, [0, 0, 0], 1); map.observe(.03, .3, -.5); assert.equal(map.occupiedCount, 0);
  map.begin(250, [0, 0, 0], 1); map.observe(.04, .3, -.5); assert.equal(map.occupiedCount, 1);
  assert.equal(map.stateAt(.04, .3, -.5, 250), 'occupied');
});

test('occupied expiration means unknown, never proven free (synthetic)', () => {
  const map = anchored(); confirm(map, .02, .3, -.5);
  assert.equal(map.stateAt(.02, .3, -.5, 3249), 'occupied');
  assert.equal(map.stateAt(.02, .3, -.5, 3250), 'unknown');
  map.expire(3250); assert.equal(map.occupiedCount, 0); assert.equal(map.cells.size, 0);
  assert.equal(map.stateAt(.02, .3, -.5, 3250), 'unknown');
});

test('removed objects clear through repeated free rays; occluded geometry is not cleared (synthetic)', () => {
  const map = anchored(); confirm(map, .02, .3, -1.2);
  for (const time of [375, 500]) { map.begin(time, [0, 0, 0], 1); map.traceFree(.02, .3, 0, .02, .3, -3); }
  assert.equal(map.occupiedCount, 1);
  map.begin(625, [0, 0, 0], 1); map.traceFree(.02, .3, 0, .02, .3, -3);
  assert.equal(map.occupiedCount, 0); assert.equal(map.stateAt(.02, .3, -1.2, 625), 'free');
  map.expire(2125); assert.equal(map.stateAt(.02, .3, -1.2, 2125), 'unknown');
  map.clear([0, 0, 0]); confirm(map, .02, .3, -2);
  for (const time of [375, 500, 625]) { map.begin(time, [0, 0, 0], 1); map.traceFree(.02, .3, 0, .02, .3, -1); }
  assert.equal(map.stateAt(.02, .3, -2, 625), 'occupied');
});

test('sparse storage, free rays and session clearing have explicit bounds (synthetic)', () => {
  assert.throws(() => new SpatialMap({maxCells: Infinity}));
  assert.throws(() => new SpatialMap({maxRaySteps: 0}));
  const map = anchored({maxCells: 3, maxFreeCells: 4}); map.begin(0, [0, 0, 0], 1);
  for (let i = 0; i < 20; i++) map.observe(i * .12, .3, -.5);
  assert.equal(map.cells.size, 3); assert.equal(map.saturated, true);
  for (let i = 0; i < 10; i++) map.traceFree(.01, .3, 0, i * .12, .3, -2);
  assert.ok(map.free.size <= 4);
  map.clear(); assert.equal(map.cells.size, 0); assert.equal(map.free.size, 0); assert.equal(map.ready, false);
});

test('the chosen support normal filters its plane without making other horizontal surfaces walkable (synthetic)', () => {
  const map = new SpatialMap(), n = Math.hypot(.2, 1);
  map.clear([0, 0, 0], [-.2 / n, 1 / n, 0]); map.begin(0, [0, 0, 0], .7);
  assert.equal(map.observe(1, .2, 0), false); assert.equal(map.observe(2, .4, 0), false);
  assert.equal(map.observe(1, .4, 0), true);
});

test('previous overhead observations stop blocking when the collision height decreases (synthetic)', () => {
  const map = anchored();
  for (const time of [0, 125, 250]) { map.begin(time, [0, 0, 0], 1.2); map.observe(.3, .71, 0); }
  assert.equal(map.collides(0, 0, {radius: .3, height: 1, ground: 0}, 300), true);
  assert.equal(map.collides(0, 0, {radius: .3, height: .7, ground: 0}, 300), false);
});
