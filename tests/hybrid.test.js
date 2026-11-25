// All depth/geometry in this file is SYNTHETIC; no physical-device homologation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ARCollisions, CollisionResolver} from '../src/collision.js';
import {SpatialMap} from '../src/spatial-map.js';
import {createDepthReader} from '../src/depth.js';
import {I, perspective, tr, ry, rx, mul} from '../src/math.js';

const position = [0, 0, -1], volume = {radius: .2, height: .7, ground: 0};
function systemAt(p = position, capability = 'waiting') {
  const s = new ARCollisions({}, {}, () => 0);
  s.start(capability); s.place(p); s.setCharacter('bip', 1, p); s.setEnabled(true); return s;
}
function fixture({pose = tr(0, .35, 0), projection = perspective(Math.PI / 2, 1), surface = () => 2} = {}) {
  const width = 160, height = 90, values = new Float32Array(width * height);
  // Independent perspective-ray formula, including asymmetric principal point and rigid camera pose.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cx = (2 * (x + .5) / width - 1 + projection[8]) / projection[0];
    const cy = (1 - 2 * (y + .5) / height + projection[9]) / projection[5];
    const direction = [pose[0] * cx + pose[4] * cy - pose[8], pose[1] * cx + pose[5] * cy - pose[9], pose[2] * cx + pose[6] * cy - pose[10]];
    values[y * width + x] = surface([pose[12], pose[13], pose[14]], direction);
  }
  const info = {width, height, rawValueToMeters: 1, data: values.buffer, normDepthBufferFromNormView: {matrix: I()}};
  return {info, view: {projectionMatrix: projection, transform: {matrix: pose}}};
}
const planeZ = z => (o, d) => (z - o[2]) / d[2];
const floor = (o, d) => { const t = -o[1] / d[1]; return t > 0 && t < 6 ? t : 0; };
function sample(s, f, t) { s.frame(t, true); s.accept(t, createDepthReader(f.info, 'float32'), f.info, f.view); }
function intent(s, dx = 0, dz = -.001, t = 0) { s.move(position, dx, dz, t); }

test('immediate probe blocks a known frontal wall in one frame with an unconfirmed partial map', () => {
  const s = systemAt(); intent(s); sample(s, fixture(), 16);
  assert.equal(s.map.occupiedCount, 0); assert.ok(s.probe.used >= 3);
  const result = s.move(position, 0, -2, 32);
  assert.ok(result.z > -1.7 && result.z < -1.5, result.z);
  assert.equal(s.snapshot().blockSource, 'sonda imediata');
  assert.equal(s.snapshot().coverageInsufficient, true);
  const stopped = result.z;
  assert.ok(s.move([0, 0, stopped], 0, .2, 40).z > stopped + .19);
  const side = s.move([0, 0, -1.62], .35, -.3, 45);
  assert.ok(side.x > .34); assert.ok(side.z > -1.7);
});

test('probe works with camera rotation, asymmetric projection and world-space known wall', () => {
  const p = perspective(Math.PI / 2, 1); p[8] = .18; p[9] = -.12;
  const s = systemAt(); intent(s);
  sample(s, fixture({pose: mul(tr(.12, .55, .05), mul(ry(.1), rx(-.12))), projection: p, surface: planeZ(-2)}), 20);
  assert.ok(s.probe.used >= 3);
  assert.ok(s.move(position, 0, -2, 40).z > -1.7);
});

test('floor-only depth, isolated noise and unknown space never globally freeze the character', () => {
  const s = systemAt(); intent(s);
  sample(s, fixture({pose: mul(tr(0, 1.4, 0), rx(-.5)), surface: floor}), 20);
  assert.equal(s.probe.used, 0); assert.equal(s.map.occupiedCount, 0);
  let moved = s.move(position, .3, -.3, 40);
  assert.ok(Math.abs(moved.x - .3) < 1e-8); assert.ok(Math.abs(moved.z + 1.3) < 1e-8);
  const isolated = fixture({surface: () => 0}); new Float32Array(isolated.info.data)[7200] = 1.3;
  sample(s, isolated, 160); assert.equal(s.probe.used, 0);
  moved = s.move(position, -.3, .3, 180); assert.ok(moved.x < -.29 && moved.z > -.71);
  assert.equal(s.map.stateAt(0, .3, -1.5, 180), 'unknown');
});

test('contact memory survives brief missing depth and a small lateral/viewpoint change', () => {
  const s = systemAt(); intent(s); sample(s, fixture(), 16);
  s.missing(70, 'waiting');
  let result = s.move([.12, 0, -1.5], 0, -.5, 250);
  assert.ok(result.z > -1.7); assert.equal(s.blockSource, 'sonda imediata');
  intent(s, 0, -.001, 260);
  sample(s, fixture({pose: mul(tr(.12, .35, .02), ry(.07)), surface: planeZ(-2)}), 280);
  result = s.move([.18, 0, -1.5], 0, -.5, 350); assert.ok(result.z > -1.7);
  // Missing data cannot refresh evidence forever; expired contact is unknown, not proven free.
  s.frame(1300, true); s.map.clear(position);
  assert.ok(s.move(position, 0, -2, 1300).z < -2.99);
});

test('persistent map and probe combine and cannot be bypassed by limited coverage', () => {
  const s = systemAt(), f = fixture();
  for (const t of [0, 125, 250, 375]) { intent(s, 0, -.001, t); sample(s, f, t + 1); }
  assert.ok(s.map.occupiedCount > 0);
  const stopped = s.move(position, 0, -2, 400);
  assert.ok(stopped.z > -1.7); assert.equal(s.blockSource, 'ambos');
  // Lateral movement + no new frame must not erase the long-lived map.
  s.frame(1800, true); const later = s.move([.15, 0, -1.5], 0, -1, 1800);
  assert.ok(later.z > -1.7); assert.equal(s.blockSource, 'mapa persistente');
});

function confirmedMap() {
  const m = new SpatialMap(); m.clear([0, 0, 0]);
  for (const t of [0, 125, 250]) { m.begin(t, [0, 0, 0], 1); m.observe(.02, .3, -1.2); }
  return m;
}
test('weak free observations and grazing rays do not erase confirmed occupancy', () => {
  const m = confirmedMap();
  for (let t = 1000; t < 2200; t += 125) {
    m.begin(t, [0, 0, 0], 1);
    const c = [...m.cells.values()][0]; m.markFree(c.ix, c.iy, c.iz); // Coverage only, not reliable clearance.
    m.traceFree(.09, .3, 0, .09, .3, -3); // Same voxel, 7 cm from measured surface sample.
  }
  assert.equal(m.stateAt(.02, .3, -1.2, 2200), 'occupied');
  assert.ok(new CollisionResolver().move(m, [.02, 0, 0], 0, -2, volume, 2200).z > -1);
});

test('clearance needs hold time and consecutive central unobstructed observations', () => {
  const m = confirmedMap();
  for (const t of [375, 500, 625, 750]) { m.begin(t, [0, 0, 0], 1); m.traceFree(.02, .3, 0, .02, .3, -3); }
  assert.equal(m.occupiedCount, 1);
  for (const t of [1000, 1125, 1250]) { m.begin(t, [0, 0, 0], 1); m.traceFree(.02, .3, 0, .02, .3, -3); }
  m.begin(1375, [0, 0, 0], 1); // A missing/grazing frame breaks the release sequence.
  m.traceFree(.1, .3, 0, .1, .3, -3);
  m.begin(1500, [0, 0, 0], 1); m.traceFree(.02, .3, 0, .02, .3, -3);
  assert.equal(m.occupiedCount, 1);
  for (const t of [1625, 1750, 1875]) { m.begin(t, [0, 0, 0], 1); m.traceFree(.02, .3, 0, .02, .3, -3); }
  assert.equal(m.occupiedCount, 0); assert.equal(m.stateAt(.02, .3, -1.2, 1875), 'free');
  assert.ok(new CollisionResolver().move(m, [.02, 0, 0], 0, -2, volume, 1875).z < -1.99);
});

test('measured wall extents remove voxel-size early stopping while keeping geometric skin', () => {
  const m = new SpatialMap(); m.clear([0, 0, 0]);
  for (const t of [0, 125, 250]) {
    m.begin(t, [0, 0, 0], 1);
    for (let x = -1; x < 1; x += .03) m.observe(x, .3, -1.99);
  }
  const result = new CollisionResolver().move(m, [0, 0, 0], 0, -3, volume, 300);
  const gap = result.z - (-1.99 + volume.radius);
  assert.ok(gap >= .035 && gap < .075, gap); // 2.5 cm sample envelope + 1.5 cm skin + <=3 cm step.
});

test('overlap tangent and retreat remain available; reposition clears map and short contact memory', () => {
  const s = systemAt(); intent(s); sample(s, fixture(), 16);
  const retreat = s.move([0, 0, -1.8], 0, .4, 30); assert.ok(retreat.z > -1.41);
  const slide = s.move([0, 0, -1.8], .1, 0, 35); assert.ok(slide.x > .09);
  s.place([1, 0, -1]); s.setCharacter('bip', 1, [1, 0, -1]);
  assert.equal(s.probe.count, 0); assert.equal(s.map.cells.size, 0);
  assert.ok(s.move([1, 0, -1], .2, -.2, 45).x > 1.19);
});

test('multiple frames keep blocking, while toggling off, tracking loss, reference reset and end clean both layers', () => {
  const s = systemAt(), f = fixture();
  for (let t = 0; t < 1200; t += 70) {
    intent(s, 0, -.001, t); sample(s, f, t + 1);
    assert.ok(s.move(position, 0, -2, t + 2).z > -1.7);
    assert.ok(s.probe.count <= 128); assert.ok(s.probe.tested <= 75);
  }
  s.setEnabled(false); assert.equal(s.probe.count, 0); assert.equal(s.map.cells.size, 0);
  assert.ok(s.move(position, 0, -2, 1300).z < -2.99);
  s.setEnabled(true); intent(s, 0, -.001, 1400); sample(s, f, 1401); s.frame(1410, false);
  assert.equal(s.probe.count, 0); assert.equal(s.map.cells.size, 0);
  s.frame(1450, true); intent(s, 0, -.001, 1450); sample(s, f, 1451); s.clearReference(); assert.equal(s.probe.count, 0);
  s.place(position); intent(s, 0, -.001, 1500); sample(s, f, 1501); s.stop();
  assert.ok(s.probe.history.every(v => v === 0)); assert.equal(s.probe.costMs, null);
});

test('unavailable depth preserves AR fallback without claiming that unknown space is free', () => {
  const s = systemAt(position, 'not-granted'); intent(s);
  assert.equal(s.wantsDepth(100), false);
  const result = s.move(position, .3, -.4, 100);
  assert.ok(result.x > .29 && result.z < -1.39);
  assert.equal(s.phase(), 'unavailable'); assert.equal(s.snapshot().coverageInsufficient, true);
});

test('probe acquires between map updates with diagnosis closed, without rescanning the full depth image', () => {
  const s = systemAt(), f = fixture(); intent(s); sample(s, f, 1);
  const batch = s.map.batch; intent(s, 0, -.001, 60);
  assert.equal(s.wantsDepth(70), true); sample(s, f, 70);
  assert.equal(s.map.batch, batch); assert.equal(s.probe.lastUpdate, 70);
  assert.ok(s.probe.used >= 3); assert.ok(s.probe.tested <= 75);
});

test('many queries of a single native pixel cannot fabricate strong immediate evidence', () => {
  const s = systemAt(), f = fixture(); intent(s);
  f.info.width = f.info.height = 1; f.info.data = new Float32Array([1.5]).buffer;
  sample(s, f, 1);
  assert.equal(s.probe.used, 0); assert.equal(s.probe.count, 0); assert.equal(s.map.occupiedCount, 0);
  assert.ok(s.move(position, 0, -.1, 2).z < -1.09);
});

test('expired occupied cells discard accumulated weak-free votes and return to unknown', () => {
  const m = confirmedMap();
  for (const t of [4500, 4625, 4750, 4875]) {
    m.begin(t, [0, 0, 0], 1);
    m.traceFree(.09, .3, 0, .09, .3, -3); // Weak ray through another part of the voxel.
  }
  assert.equal(m.stateAt(.02, .3, -1.2, 5000), 'occupied');
  m.expire(5250);
  assert.equal(m.stateAt(.02, .3, -1.2, 5250), 'unknown');
  assert.equal(m.free.has(m.key(0, 2, -10)), false);
});
