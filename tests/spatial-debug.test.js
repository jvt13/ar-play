// Derived SYNTHETIC algorithm data, not physical depth measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ARCollisions} from '../src/collision.js';
import {SpatialDebug} from '../src/spatial-debug.js';
import {radiusAt} from '../src/volume.js';

test('3D debug uses exact processed points, measured occupied bounds, actual contacts and volume',()=>{
  let draws=0;const debug=new SpatialDebug({releaseDebug(){},drawDebug(){draws++;}},()=>0);
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setCharacter('bip',.63,[0,0,0]);s.setEnabled(true);
  for(const t of [0,125,250]){s.map.begin(t,[0,0,0],s.volume.height);s.map.observe(.4,.3,-.5);}
  s.points.set([0,.01,-.5,.1,.3,-.6,2,1.5,-2]);s.used=3;
  s.probe.count=1;s.probe.history.set([.1,.3,0,250,0,1,.2]);
  debug.prepare(s,300);assert.equal(debug.count,0);debug.draw();assert.equal(draws,0);
  s.debug3D=true;debug.prepare(s,300);
  assert.equal(debug.groundCount,1);assert.equal(debug.candidateCount,1);assert.equal(debug.cellCount,1);assert.equal(debug.contactCount,1);
  assert.equal(debug.outsideCount,1);
  const g=debug.groups,d=debug.data;
  assert.ok(Math.abs(d[g[0].first*6+1]-.01)<1e-6);
  assert.ok(Math.abs(d[g[1].first*6]-.1)<1e-6);assert.ok(Math.abs(d[g[1].first*6+2]+.6)<1e-6);
  assert.ok(Math.abs(d[g[2].first*6]-(.4-s.map.config.pointMargin))<1e-6);
  assert.ok(Math.abs(d[g[3].first*6]-.1)<1e-6);
  assert.equal(d[g[8].first*6],2);assert.equal(d[g[8].first*6+1],1.5);
  const expected=radiusAt(s.volume,s.volume.height/24)+s.resolver.skin;
  assert.ok(Math.abs(d[g[4].first*6]-expected)<1e-6);
  assert.equal(debug.data.byteLength,144000);assert.ok(debug.count<=6000);
  debug.draw();assert.equal(draws,1);
  s.setEnabled(false);debug.prepare(s,400);assert.equal(debug.count,0);assert.equal(debug.enabled,false);
  for(let i=0;i<6000;i++)assert.equal(debug.data[i*6]+debug.data[i*6+1]+debug.data[i*6+2],0);
});

test('debug respects evidence expiration and explicit geometry limits',()=>{
  const debug=new SpatialDebug({releaseDebug(){},drawDebug(){}},()=>0),s=new ARCollisions({}, {},()=>0);
  s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.debug3D=true;
  for(const t of [0,125,250]){s.map.begin(t,[0,0,0],1);for(let i=0;i<100;i++)s.map.observe((i%10)*.12,.3,-Math.floor(i/10)*.12);}
  debug.prepare(s,300);assert.equal(debug.cellCount,64);assert.ok(debug.count<=6000);
  debug.prepare(s,6000);assert.equal(debug.cellCount,0);
  s.stop();debug.prepare(s,6100);assert.equal(debug.enabled,false);
});
