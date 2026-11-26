import test from 'node:test';
import assert from 'node:assert/strict';
import * as API from '../src/collision.js';
import {runSequence, setup, scales} from './collision-sequences.mjs';
import {readFileSync} from 'node:fs';
const reference = JSON.parse(readFileSync(new URL('./fixtures/recovery-v115.json', import.meta.url), 'utf8'));

for (const scale of scales) for (const scene of ['free','rapid','wall','corridor','competing','overlap','noise','historical']) {
  test(`ARP-004H circular temporal ${scene}, Bip ${Math.round(scale*100)}%`, () => {
    const {metrics: m, trace, system} = runSequence(API, {scale, scene});
    const legacy = reference.results.find(r => r.scale === scale && r.scene === scene);
    for (const key of ['distance','finalX','finalZ','rejected','maxNewPenetration'])
      assert.ok(Math.abs(m[key] - legacy[key]) < 1e-6, `1.1.5 behavior changed: ${key}`);
    assert.equal(system.volume.bodyBounds, null);
    assert.equal(system.volume.poseMode, 'legacy-circular');
    assert.equal(m.rotationsRejected, 0);
    assert.ok(m.maxNewPenetration <= 1e-7, `new penetration ${m.maxNewPenetration}`);
    assert.ok(m.distance > .5, `stuck ${JSON.stringify(m)}`);
    if (scene === 'free' || scene === 'rapid') assert.equal(m.rejected, 0);
    if (scene === 'overlap') {
      assert.ok(trace[0].before > 0); assert.ok(trace.at(-1).after <= 0);
      assert.ok(m.finalX < -.54); // Tangents then a sustained valid exit.
    }
    if (scene === 'wall' || scene === 'historical') {
      assert.ok(m.finalX < trace[89].x - .54); // Full retreat after prolonged contact.
      assert.ok(m.finalZ > .54); // Tangent is preserved even with inward input.
    }
  });
}

test('ARP-004H circular rotation is invariant even in known overlap, with no spatial pose query', () => {
  const s = setup(API, .81, 'overlap');
  s.field.collides = () => { throw Error('circular rotation queried occupied space'); };
  for (let i = 0; i < 120; i++) {
    const yaw = i * Math.PI / 8;
    assert.equal(s.requestPose(yaw, i % 2 === 0, 2100 + i * 16), true);
    assert.equal(s.poseYaw, yaw); assert.equal(s.poseDesiredYaw, yaw); assert.equal(s.posePending, false);
  }
});

test('ARP-004H experimental pose rejection does not gate sustained retreat; equivalent retries are diagnosed', () => {
  const s = setup(API, .81, 'overlap', true);
  assert.equal(s.requestPose(Math.PI, false, 2100), false);
  assert.equal(s.poseRejection, 'occupied-target-volume');
  assert.equal(s.requestPose(Math.PI, false, 2116), false);
  assert.equal(s.poseRejection, 'cached-occupied-target-volume');
  const p = [0, 0, 0];
  for (let i = 0; i < 60; i++) {
    const t = 2150 + i * 16;
    s.setCharacter('bip', .81, p); s.frame(t, true); s.requestPose(Math.PI, false, t);
    const out = s.move(p, -.01, 0, t); p[0] = out.x; p[2] = out.z;
  }
  assert.ok(p[0] < -.59); assert.equal(s.posePending, false);
});

test('ARP-004H camera headings preserve free movement and physical yaw over complete sequences', () => {
  for (const cameraYaw of [0, Math.PI/2, Math.PI, -Math.PI/2, .37]) {
    const {metrics, trace} = runSequence(API, {scene: 'rapid', cameraYaw});
    assert.equal(metrics.rejected, 0); assert.equal(metrics.rotationsRejected, 0);
    assert.ok(metrics.distance > 1.78); assert.ok(Math.hypot(metrics.finalX, metrics.finalZ) < 1e-7);
    assert.ok(trace.some(e => Math.abs(e.yaw) > .1));
  }
});

test('ARP-004H real controller diagnostic survives end, counts pressure and resets on rest/session', () => {
  const s = setup(API, .81, 'wall'), p = [0, 0, 0];
  for (let i = 0; i < 100; i++) {
    const t = 2100 + i * 16; s.setCharacter('bip', .81, p); s.frame(t, true);
    s.requestPose(Math.PI/2, false, t); const out = s.move(p, .01, 0, t); p[0] = out.x;
  }
  assert.ok(s.translationRejects > 20);
  const saved = JSON.parse(s.exportText('manual-export'));
  assert.equal(saved.state.volumeMode, 'legacy-circular');
  assert.equal(saved.lastBlock.requestedDx, .01); assert.ok(saved.lastBlock.allowedDx < 1e-5);
  assert.equal(saved.state.requestedYaw, Math.PI/2); assert.ok(saved.lastBlock.translationRejection);
  assert.ok(saved.lastBlock.translationRejects > 20);
  assert.equal(saved.lastBlock.initialOverlap, false);
  s.setIntent(0, 0, 4000); assert.equal(s.translationRejects, 0);
  s.stop('XRSession.end'); assert.ok(s.archive.last.lastBlock);
  assert.ok(new TextEncoder().encode(s.archive.text()).length <= 32000);
  assert.ok(!s.archive.text().includes('previousX'));
  s.start('waiting'); assert.equal(s.translationRejects, 0); assert.equal(s.poseRejects, 0);
  assert.equal(s.map.cells.size, 0); assert.equal(s.probe.count, 0);
});

test('ARP-004H production opts into one circular field; oriented experiments require constructor opt-in', () => {
  const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('orientedVolume:true'));
  assert.equal(new API.ARCollisions().orientedEnabled, false);
});

test('ARP-004H immediate-probe history is invariant across circular yaw/dance; stale contact does not block retreat', () => {
  const s = setup(API, .81, 'free'), p = [0,0,0];
  s.probe.count=1;s.probe.history.set([.6,.2,0,2100,0,1,2]);
  for (let i=0;i<90;i++) {
    const t=2110+i*6;
    s.setCharacter('bip',.81,p);s.frame(t,true);s.requestPose(i*Math.PI/4,i%2===0,t);
    const out=s.move(p,.01,0,t);p[0]=out.x;p[2]=out.z;
    assert.ok(p[0] < .6-s.volume.radius-.0399);
  }
  const stop=p[0];assert.ok(s.blocked);assert.equal(s.blockSource,'sonda imediata');
  for (let i=0;i<20;i++) {
    const t=2700+i*6;s.frame(t,true);s.requestPose(-Math.PI/2,false,t);
    const out=s.move(p,-.01,0,t);p[0]=out.x;p[2]=out.z;
  }
  assert.ok(p[0] < stop-.199);assert.equal(s.blocked,false);
  s.frame(3100,true);assert.equal(s.probe.penetration(.5,0,s.volume,3100,.015),0);
});
