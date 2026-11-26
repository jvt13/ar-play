import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import * as collision from '../src/collision.js';import * as depth from '../src/depth.js';import * as math from '../src/math.js';
import {runChain} from './chain-fixtures.mjs';
const API={...collision,...depth,...math};
const reference=JSON.parse(readFileSync(new URL('./fixtures/chain-v115.json',import.meta.url),'utf8'));
for(const expected of reference.results)test(`ARP-004I full controller ${expected.scenario} scale ${expected.scale}`,()=>{
  const actual=runChain(API,expected);
  assert.equal(createHash('sha256').update(JSON.stringify(actual.trace)).digest('hex'),expected.traceSha256,'all 400 acquisition/movement states must match 1.1.5');
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
