// Shared immutable synthetic inputs for historical comparisons and regression tests.
// No captured phone geometry is available; these are controlled reproductions only.
export const scales = [.4, .54, .66, .81, 1];
export function setup(API, scale, scene, oriented = false, now = () => 0) {
  const s = new API.ARCollisions({}, {orientedVolume: oriented}, now);
  s.start('waiting'); s.place([0, 0, 0]); s.setCharacter('bip', scale, [0, 0, 0]); s.setEnabled(true);
  const r = s.volume.radius, h = s.volume.height;
  for (let t = 0; t <= 2000; t += 125) {
    s.map.begin(t, [0, 0, 0], h);
    const wall = (axis, at, from = -2, to = 2) => {
      for (let a = from; a <= to; a += .03) for (let y = .065; y < h; y += .045)
        s.map.observe(axis === 'x' ? at : a, y, axis === 'z' ? at : a);
    };
    if (scene === 'wall' || scene === 'historical') wall('x', .8);
    if (scene === 'corridor') { wall('x', r + .055); wall('x', -r - .055); }
    if (scene === 'overlap') wall('x', r * .45);
    if (scene === 'competing') { wall('x', .55, -.6, .6); wall('z', -.65, -.6, .6); }
    if (scene === 'noise') for (let a = 0; a < 15; a++)
      s.map.observe(.6 + .008 * Math.sin(a), .09 + a % 3 * .06, -.4 + a * .06);
  }
  return s;
}
export function inputs(scene) {
  const segment = (frames, x, z, yaw) => Array.from({length: frames}, () => ({x, z, yaw}));
  if (scene === 'free') return [...segment(50, 0, -.01), ...segment(50, .01, 0), ...segment(20, 0, 0, .7)];
  if (scene === 'rapid') return Array.from({length: 160}, (_, i) => ({x: i % 4 < 2 ? .01 : -.01, z: i % 2 ? .005 : -.005}));
  if (scene === 'corridor') return [...segment(100, .004, -.01), ...segment(50, -.004, .01), ...segment(10, 0, 0, 2.4)];
  if (scene === 'overlap') return [...segment(35, 0, .01), ...segment(35, 0, -.01), ...segment(55, -.01, 0), ...segment(15, 0, 0, .7)];
  return [...segment(90, .01, 0), ...segment(35, 0, 0, Math.PI), ...segment(55, .01, .01), ...segment(55, -.01, 0), ...segment(20, 0, 0)];
}
export function runSequence(API, {scale = .81, scene = 'wall', oriented = false, cameraYaw = 0} = {}) {
  const s = setup(API, scale, scene, oriented), p = [0, 0, 0];
  const metrics = {distance: 0, rejected: 0, maxConsecutive: 0, rotationsAllowed: 0, rotationsRejected: 0, maxPenetration: 0, maxNewPenetration: 0};
  let streak = 0;
  const trace = [];
  for (const [i, input] of inputs(scene).entries()) {
    const t = (scene === 'historical' ? 9000 : 2100) + i * 16;
    const dx = input.x * Math.cos(cameraYaw) + input.z * Math.sin(cameraYaw);
    const dz = input.z * Math.cos(cameraYaw) - input.x * Math.sin(cameraYaw);
    const yaw = input.yaw ?? Math.atan2(dx, dz);
    s.setCharacter('bip', scale, p); s.frame(t, true); s.setInput(input.x, input.z); s.setIntent(dx / .016, dz / .016, t);
    const pose = s.requestPose?.(yaw, false, t) ?? true;
    metrics[pose ? 'rotationsAllowed' : 'rotationsRejected']++;
    const before = s.field.penetration(p[0], p[2], s.volume, t, s.resolver.skin);
    const out = s.move(p, dx, dz, t), distance = Math.hypot(out.x - p[0], out.z - p[2]);
    metrics.distance += distance;
    if (s.blocked) { metrics.rejected++; streak++; } else streak = 0;
    metrics.maxConsecutive = Math.max(metrics.maxConsecutive, streak);
    p[0] = out.x; p[2] = out.z;
    s.requestPose?.(yaw, false, t); // Same pre/post-translation order as xrFrame/tick.
    const after = s.field.penetration(p[0], p[2], s.volume, t, s.resolver.skin);
    metrics.maxPenetration = Math.max(metrics.maxPenetration, after);
    if (before <= 0) metrics.maxNewPenetration = Math.max(metrics.maxNewPenetration, after);
    trace.push({x: p[0], z: p[2], yaw: s.poseYaw, before, after, blocked: s.blocked, distance});
  }
  return {metrics: {...metrics, finalX: p[0], finalZ: p[2]}, trace, system: s};
}
