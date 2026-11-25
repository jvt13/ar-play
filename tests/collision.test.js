import test from 'node:test';
import assert from 'node:assert/strict';
import {I, perspective, tr, rx, mul} from '../src/math.js';
import {character} from '../src/engine.js';
import {createDepthReader, DepthDiagnostics} from '../src/depth.js';
import {SpatialMap} from '../src/spatial-map.js';
import {ARCollisions, CollisionResolver, characterVolume, MODEL_BOUNDS} from '../src/collision.js';

const volume = {radius: .2, height: .7, ground: 0};
function mapWith(shape) {
  const map = new SpatialMap(); map.clear([0, 0, 0]);
  for (const time of [0, 125, 250]) { map.begin(time, [0, 0, 0], volume.height); shape(map); }
  return map;
}
const wall = map => { for (let z = -2; z < 2; z += .06) for (let y = .18; y < .7; y += .12) map.observe(.6, y, z); };
const box = map => { for (let x = .6; x <= .96; x += .06) for (let z = -.3; z <= .3; z += .06) map.observe(x, .3, z); };

test('wall blocks position before penetration but permits retreat and lateral motion (synthetic)', () => {
  const map = mapWith(wall), solver = new CollisionResolver(), p = [0, 0, 0];
  let solved = solver.move(map, p, 1, 0, volume, 300);
  assert.ok(solved.x > .2 && solved.x <= .6 - volume.radius); assert.ok(solved.blocked); assert.equal(solved.direction, 'X+');
  p[0] = solved.x;
  solved = solver.move(map, p, -.25, 0, volume, 320); assert.ok(solved.x < p[0] - .24); assert.equal(solved.blocked, false);
  solved = solver.move(map, p, .3, .5, volume, 340);
  assert.ok(solved.z > .49); assert.ok(solved.x <= .6 - volume.radius); assert.ok(solved.blocked);
});

test('box blocks only its footprint; known obstacles still block with unknown surrounding coverage (synthetic)', () => {
  const map = mapWith(box), solver = new CollisionResolver();
  const hit = solver.move(map, [0, 0, 0], 2, 0, volume, 300);
  assert.ok(hit.x < .6 && hit.blocked);
  const clear = solver.move(map, [0, 0, 1], 2, 0, volume, 300);
  assert.ok(Math.abs(clear.x - 2) < 1e-6); assert.equal(clear.blocked, false); assert.equal(clear.coverage, 0);
  const empty = mapWith(() => {}), conventional = solver.move(empty, [0, 0, 0], .4, -.3, volume, 300);
  assert.ok(Math.abs(conventional.x - .4) < 1e-6); assert.ok(Math.abs(conventional.z + .3) < 1e-6);
  assert.equal(conventional.coverage, 0); assert.equal(empty.stateAt(.4, .3, -.3, 300), 'unknown');
});

test('substeps prevent tunneling at high speed and queries remain bounded (synthetic)', () => {
  const map = mapWith(wall), solver = new CollisionResolver();
  const fast = solver.move(map, [-1, 0, 0], 5, 0, volume, 300);
  assert.ok(fast.x <= .6 - volume.radius); assert.ok(fast.blocked); assert.ok(fast.steps <= 256);
  const huge = solver.move(map, [-1, 0, 0], 10000, 0, volume, 300);
  assert.ok(huge.x < .6); assert.equal(huge.steps, 256);
});

test('initial overlap allows a nearby exit, never pushes idle characters or crosses the whole box (synthetic)', () => {
  const map = mapWith(box), solver = new CollisionResolver();
  let p = [.55, 0, 0];
  const deeper = solver.move(map, p, .1, 0, volume, 300); assert.ok(deeper.x <= p[0] + 1e-8);
  const retreat = solver.move(map, p, -.5, 0, volume, 300); assert.ok(retreat.x < .1); assert.equal(map.collides(retreat.x, 0, volume, 300), false);
  p = [.78, 0, 0]; const idle = solver.move(map, p, 0, 0, volume, 300); assert.equal(idle.x, p[0]); assert.equal(idle.z, p[2]);
  const exit = solver.move(map, p, -.8, 0, volume, 300); assert.ok(exit.x < .1); assert.equal(map.collides(exit.x, exit.z, volume, 300), false);
});

test('contact skin is stable; floor and high objects do not create horizontal walls (synthetic)', () => {
  const map = mapWith(wall), solver = new CollisionResolver(), p = [0, 0, 0];
  p[0] = solver.move(map, p, 1, 0, volume, 300).x; const stopped = p[0];
  for (let i = 0; i < 50; i++) { const next = solver.move(map, p, .01, 0, volume, 320 + i); p[0] = next.x; }
  assert.ok(Math.abs(p[0] - stopped) < 1e-6);
  const floor = mapWith(m => { for (let x = 0; x <= 1; x += .06) { m.observe(x, 0, 0); m.observe(x, .03, 0); m.observe(x, 1.2, 0); } });
  assert.equal(floor.cells.size, 0); assert.equal(solver.move(floor, [0, 0, 0], 1, 0, volume, 300).blocked, false);
  const table = mapWith(m => { for (let x = .6; x < 1; x += .06) for (let z = -.3; z < .3; z += .06) m.observe(x, .4, z); });
  assert.ok(solver.move(table, [0, 0, 0], 1, 0, volume, 300).blocked); // Horizontal != traversable.
});

test('all three cylinder dimensions follow the actual animated model geometry and scale (synthetic)', () => {
  for (const id of ['bip', 'nori', 'luma']) {
    const bounds = MODEL_BOUNDS[id];
    const collector = {draw(kind, m) {
      assert.equal(kind, 'sphere');
      const a = m[0] ** 2 + m[4] ** 2 + m[8] ** 2, b = m[0] * m[2] + m[4] * m[6] + m[8] * m[10], c = m[2] ** 2 + m[6] ** 2 + m[10] ** 2;
      const r = Math.hypot(m[12], m[14]) + Math.sqrt((a + c + Math.sqrt((a - c) ** 2 + 4 * b * b)) / 2);
      assert.ok(r <= bounds.radius); assert.ok(m[13] + Math.hypot(m[1], m[5], m[9]) <= bounds.height);
    }};
    for (const [walk, dance] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (let i = 0; i < 256; i++) character(collector, id, I(), i * 2 * Math.PI / 256, walk, dance, 0);
    const small = characterVolume(id, .5, 2), big = characterVolume(id, 1, 2);
    assert.equal(big.radius, small.radius * 2); assert.equal(big.height, small.height * 2); assert.equal(big.ground, 2);
    const map = mapWith(wall), solver = new CollisionResolver();
    const smallStop = solver.move(map, [0, 0, 0], 1, 0, {...small, ground: 0}, 300).x;
    const bigStop = solver.move(map, [0, 0, 0], 1, 0, {...big, ground: 0}, 300).x;
    assert.ok(bigStop < smallStop);
  }
});

function planeInfo(depth = 2, pose = tr(0, .35, 0)) {
  const info = {width: 24, height: 18, rawValueToMeters: .001, data: new Uint16Array(432).fill(depth * 1000).buffer, normDepthBufferFromNormView: {matrix: I()}};
  return {info, view: {projectionMatrix: perspective(Math.PI / 2, 1), transform: {matrix: pose}}};
}
function setup(system) { system.start('waiting'); system.place([0, 0, -1]); system.setCharacter('bip', 1, [0, 0, -1]); system.setEnabled(true); }
function acquire(system, fixture, time) { system.frame(time, true); system.accept(time, createDepthReader(fixture.info, 'luminance-alpha'), fixture.info, fixture.view); }

test('reconstructed depth wall blocks actual movement with diagnosis closed (synthetic)', () => {
  const system = new ARCollisions({}, {}, () => 0); setup(system); const fixture = planeInfo();
  for (const time of [0, 125, 250]) acquire(system, fixture, time);
  assert.ok(system.map.occupiedCount > 0); assert.ok(system.used > 100);
  const result = system.move([0, 0, -1], 0, -2, 300);
  assert.ok(result.z > -1.8 && result.z < -1.1); assert.ok(system.blocked);
  system.missing(400, 'waiting');
  assert.ok(system.move([0, 0, -1], 0, -2, 500).z > -1.8); // Live confirmed geometry persists.
  system.frame(5500, true);
  assert.ok(system.move([0, 0, -1], 0, -2, 5500).z < -2.9); // Expired unknown uses conventional fallback.
  assert.equal(system.phase(), 'unavailable');
});

test('collision reconstruction does not assume ground Y=0 or camera at the reference origin (synthetic)', () => {
  const system = new ARCollisions({}, {}, () => 0), position = [1, -1.4, -1];
  system.start('waiting'); system.place(position); system.setCharacter('bip', 1, position); system.setEnabled(true);
  const fixture = planeInfo(2, tr(1, -1.05, 0));
  for (const time of [0, 125, 250]) acquire(system, fixture, time);
  assert.ok(system.map.occupiedCount > 0);
  const stopped = system.move(position, 0, -2, 300);
  assert.ok(stopped.z > -1.8 && stopped.z < -1.1); assert.equal(stopped.x, 1);
  assert.equal(system.volume.ground, -1.4); assert.equal(position[1], -1.4);
});

test('raycast depth from a known furniture box blocks its front, not a lateral corridor (synthetic)', () => {
  const system = new ARCollisions({}, {}, () => 0); setup(system);
  const fixture = planeInfo(4), values = new Uint16Array(fixture.info.data);
  const low = [-.3, .08, -2], high = [.3, .6, -1.8], origin = [0, .35, 0];
  for (let y = 0; y < 18; y++) for (let x = 0; x < 24; x++) {
    const ray = [2 * (x + .5) / 24 - 1, 1 - 2 * (y + .5) / 18, -1];
    let enter = 0, exit = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(ray[axis]) < 1e-8) { if (origin[axis] < low[axis] || origin[axis] > high[axis]) exit = -1; continue; }
      const a = (low[axis] - origin[axis]) / ray[axis], b = (high[axis] - origin[axis]) / ray[axis];
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    if (exit >= enter && enter > 0) values[y * 24 + x] = Math.round(enter * 1000);
  }
  for (const time of [0, 125, 250]) acquire(system, fixture, time);
  const hit = system.move([0, 0, -1], 0, -2, 300); assert.ok(hit.z > -1.6 && hit.z < -1.1);
  const clear = system.move([1.2, 0, -1], 0, -2, 300); assert.ok(Math.abs(clear.z + 3) < 1e-6);
});

test('spatial work reduces sample count and frequency when its measured budget is exceeded (synthetic)', () => {
  let clock = 0;
  const system = new ARCollisions({}, {}, () => { clock += 5; return clock; }); setup(system);
  const fixture = planeInfo(); acquire(system, fixture, 0);
  assert.ok(system.interval > 125); assert.equal(system.columns * system.rows, 192);
  assert.equal(system.wantsDepth(100), false); assert.equal(system.wantsDepth(200), true);
  acquire(system, fixture, 200); assert.ok(system.used <= 192);
  system.stop(); assert.ok(system.point.every(v => v === 0)); assert.ok(system.projector.pose.every(v => v === 0));
});

test('isolated depth samples and incompatible source geometry never invent obstacles (synthetic)', () => {
  const system = new ARCollisions({}, {}, () => 0); setup(system); const fixture = planeInfo();
  new Uint16Array(fixture.info.data).fill(0); new Uint16Array(fixture.info.data)[200] = 500;
  for (const time of [0, 125, 250]) acquire(system, fixture, time);
  assert.equal(system.used, 0); assert.equal(system.map.cells.size, 0);
  const good = planeInfo(); good.info.transform = {matrix: tr(.1, .35, 0)}; good.info.projectionMatrix = good.view.projectionMatrix;
  acquire(system, good, 400); assert.equal(system.depthState, 'geometry'); assert.equal(system.map.cells.size, 0);
});

test('tilted-camera floor reconstruction is filtered in XR coordinates, not camera coordinates (synthetic)', () => {
  const system = new ARCollisions({}, {}, () => 0); setup(system);
  const pose = mul(tr(0, 1.5, 0), rx(-Math.PI / 4)), fixture = planeInfo(0, pose), values = new Float32Array(432);
  // Independent ray/ground intersection: direction = R * (nx,ny,-1), axial t = -cameraY/directionY.
  for (let y = 0; y < 18; y++) for (let x = 0; x < 24; x++) {
    const ny = 1 - 2 * (y + .5) / 18, dy = ny * Math.SQRT1_2 - Math.SQRT1_2;
    const axial = -1.5 / dy; values[y * 24 + x] = axial > 0 && axial <= 6 ? axial : 0;
  }
  fixture.info.data = values.buffer; fixture.info.rawValueToMeters = 1;
  for (const time of [0, 125, 250]) { system.frame(time, true); system.accept(time, createDepthReader(fixture.info, 'float32'), fixture.info, fixture.view); }
  assert.ok(system.used > 50); assert.equal(system.map.cells.size, 0);
  assert.equal(system.move([0, 0, -1], .2, -.2, 300).x, .2);
});

test('single native acquisition feeds diagnostics and spatial map, no retained XR buffers (synthetic)', () => {
  let nativeCalls = 0, reads = 0, active = false;
  const session = {enabledFeatures: ['depth-sensing'], depthUsage: 'cpu-optimized', depthDataFormat: 'luminance-alpha'};
  const monitor = new DepthDiagnostics({}, () => 0), system = new ARCollisions({}, {}, () => 0), fixture = planeInfo(); setup(system);
  const buffer = fixture.info.data;
  Object.defineProperty(fixture.info, 'data', {get() { assert.ok(active); reads++; return buffer; }});
  const frame = {session, getDepthInformation: () => { assert.ok(active); nativeCalls++; return fixture.info; }};
  monitor.start(session, {apiAvailable: true});
  for (const time of [0, 125, 250]) {
    system.move([0, 0, -1], 0, -.001, time); system.frame(time, true);
    active = true; monitor.update(time, frame, fixture.view, system); active = false;
  }
  assert.equal(monitor.enabled, false); assert.equal(nativeCalls, 3); assert.equal(reads, 3); assert.ok(system.map.occupiedCount > 0);
  assert.equal(system.probe.tested, 75); assert.ok(system.probe.used >= 3);
  monitor.setEnabled(true); system.frame(375, true); active = true; monitor.update(375, frame, fixture.view, system); active = false;
  assert.equal(nativeCalls, 4); assert.equal(reads, 4); assert.equal(monitor.snapshot().center, 2);
  monitor.setEnabled(false); system.setEnabled(false); monitor.update(500, frame, fixture.view, system); assert.equal(nativeCalls, 4);
  system.stop(); monitor.stop(); assert.equal(system.map.cells.size, 0); assert.ok(system.points.every(v => v === 0)); assert.equal(system.projector.valid, false);
});

test('unavailable depth, toggles, placement and reference loss preserve conventional movement and cleanup (synthetic)', () => {
  const system = new ARCollisions({}, {}, () => 0);
  system.start('not-granted'); system.place([0, 0, -1]); system.setEnabled(true);
  assert.equal(system.wantsDepth(0), false); assert.equal(system.phase(), 'unavailable');
  assert.equal(system.move([0, 0, -1], .3, 0, 0).x, .3);
  setup(system); const fixture = planeInfo(); for (const time of [0, 125, 250]) acquire(system, fixture, time);
  system.frame(300, false); assert.equal(system.map.cells.size, 0); assert.equal(system.wantsDepth(500), false);
  system.frame(500, true); assert.equal(system.wantsDepth(500), true);
  acquire(system, fixture, 500); system.clearReference(); assert.equal(system.anchored, false); assert.equal(system.map.cells.size, 0);
  system.place([1, 0, -1]); assert.equal(system.anchor[0], 1);
  system.setEnabled(false); assert.equal(system.map.cells.size, 0); assert.equal(system.move([1, 0, -1], .4, 0, 600).x, 1.4);
  system.stop(); assert.equal(system.enabled, false); assert.equal(system.map.free.size, 0);
});
