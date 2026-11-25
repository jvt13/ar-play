// Optional CPU benchmark, NOT a physical-device measurement or test of sensor precision.
import {ARCollisions, characterVolume} from '../src/collision.js';
import {createDepthReader} from '../src/depth.js';
import {I, perspective, tr} from '../src/math.js';

const system = new ARCollisions();
system.start('waiting'); system.place([0, 0, -1]); system.setCharacter('bip', 1, [0, 0, -1]); system.setEnabled(true);
const info = {width: 160, height: 90, rawValueToMeters: .001, data: new Uint16Array(160 * 90).fill(2000).buffer, normDepthBufferFromNormView: {matrix: I()}};
const view = {projectionMatrix: perspective(Math.PI / 2, 1), transform: {matrix: tr(0, .35, 0)}};
let time = 0, cold;
const updates = [];
for (let i = 0; i < 240; i++) {
  time += system.interval + 1; system.frame(time, true);
  system.accept(time, createDepthReader(info, 'luminance-alpha'), info, view);
  if (!i) cold = system.reconstructionMs;
  if (i >= 40) updates.push(system.reconstructionMs);
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {n: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1)};
}
const queries = {};
for (const id of ['bip', 'nori', 'luma']) {
  system.setCharacter(id, 1, [0, 0, -1]); const position = [0, 0, -1], samples = [];
  for (let i = 0; i < 1200; i++) {
    const result = system.move(position, 0, -.02, time + 1); position[0] = result.x; position[2] = result.z;
    if (i >= 200) samples.push(system.queryMs);
  }
  queries[id] = {...summary(samples), finalPosition: position};
}
const volume = characterVolume('bip', 1, 0), fast = [];
for (let i = 0; i < 30; i++) {
  const started = performance.now(); system.resolver.move(system.map, [0, 0, -1], 0, -5, volume, time + 1);
  fast.push(performance.now() - started);
}
console.log(JSON.stringify({
  environment: {node: process.version, platform: process.platform, arch: process.arch, geometry: 'SYNTHETIC 160x90 plane, 2 axial meters; no physical camera'},
  reconstruction: {coldMs: cold, ...summary(updates), points: system.used, cells: system.map.cells.size, occupied: system.map.occupiedCount, free: system.map.free.size, intervalMs: system.interval},
  queries, stressFiveMeterMove: summary(fast),
}, null, 2));
system.stop();
