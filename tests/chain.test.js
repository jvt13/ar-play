import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import * as collision from '../src/collision.js';import * as depth from '../src/depth.js';import * as math from '../src/math.js';
import {runChain} from './chain-fixtures.mjs';
const API={...collision,...depth,...math};
const reference=JSON.parse(readFileSync(new URL('./fixtures/chain-v115.json',import.meta.url),'utf8'));
const motionReference=JSON.parse(readFileSync(new URL('./fixtures/chain-v118-motion.json',import.meta.url),'utf8'));
for(const expected of reference.results)test(`ARP-004I full controller ${expected.scenario} scale ${expected.scale}`,()=>{
  const actual=runChain(API,expected);
  // ARP-004J intentionally adds supported samples/cells. Keep the original full golden
  // untouched; compare every physical position, rejection and release to frozen 1.1.8.
  const golden=motionReference.results.find(r=>r.scenario===expected.scenario&&r.scale===expected.scale);
  assert.equal(createHash('sha256').update(JSON.stringify(actual.trace.map(r=>[r[0],r[1],r[4],r[5]]))).digest('hex'),golden.motionSha256,'all 400 physical states must match the functional reference');
  assert.ok(Math.abs(actual.distance-expected.distance)<1e-9);
  if(['floor','noisy-floor','pitched-camera'].includes(actual.scenario)){assert.equal(actual.maxOccupied,0);assert.ok(actual.distance>1.999);}
});
test('ARP-004I actual application controller has no oriented pose/placement gate',()=>{
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(app,/import \{ARCollisions\} from '\.\/collision.js'/);
  assert.match(app,/const collisions=new ARCollisions\(/);
  const controller=new collision.ARCollisions({}, {orientedVolume:true},()=>0);
  assert.equal(controller.orientedEnabled,false);controller.field.collides=()=>{throw Error('pose must not query geometry')};
  for(let i=0;i<100;i++)assert.equal(controller.requestPose(i,false,i*16),true);
});
