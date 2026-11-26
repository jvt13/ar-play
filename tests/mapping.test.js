import test from 'node:test';import assert from 'node:assert/strict';
import * as collision from '../src/collision.js';import * as depth from '../src/depth.js';import * as math from '../src/math.js';
import {GroundEvidence} from '../src/ground.js';import {SpatialMap} from '../src/spatial-map.js';
import {runMapping,depthScene} from './mapping-fixtures.mjs';
const API={...collision,...depth,...math};
for(const id of ['bip','nori','luma'])for(const scale of [.4,.81,1]){
  test(`ARP-004J anchored reconstructed floor +9cm, ${id} ${scale}`,()=>{
    const r=runMapping(API,{id,scale,slope:.12,frames:240});assert.ok(r.distance>1.079);assert.equal(r.rejected,0);assert.equal(r.ground.confidence,'anchored-temporal');
  });
  for(const shape of ['ball','slipper','toy','leg','step'])test(`ARP-004J small ${shape} retained, ${id} ${scale}`,()=>{
    const r=runMapping(API,{id,scale,shape,frames:240});assert.ok(r.rejected>0,JSON.stringify({id,scale,shape,...r,system:undefined,trace:undefined}));
    assert.ok(Math.max(...r.trace.map(t=>t[1]))<.5,'known object cannot be crossed');
    assert.ok(r.trace.at(-1)[1]<r.trace[155][1]-.35,'sustained retreat remains possible');
  });
  for(const shape of ['ball','slipper','toy','leg','step'])test(`ARP-004J ${shape} above anchored slope remains an obstacle, ${id} ${scale}`,()=>{
    const r=runMapping(API,{id,scale,shape,slope:.12,objectLift:.066,frames:240});
    assert.ok(r.rejected>0);assert.ok(Math.max(...r.trace.map(t=>t[1]))<.5);assert.ok(r.maxObstaclePoints>0||r.maxProbeEvidence>=3,'measured grid or immediate probe evidence during approach; the same slope without the object stays free');
  });
}
for(const height of [0,.02,.05,.09,.12])test(`ARP-004J uniform support discrepancy ${height}m is not blindly cleared`,()=>{
  const r=runMapping(API,{height,frames:400,immediate:true});
  if(height<=.05){assert.ok(r.distance>1.999);assert.equal(r.rejected,0);}
  else {assert.equal(r.distance,0);assert.equal(r.rejected,400);assert.equal(r.ground.confidence,'uncertain');assert.ok(Math.abs(r.ground.observedSupportDelta-height)<.025);assert.ok(r.ground.uncertainPoints>0);}
});
for(const noise of [-.003,0,.003])test(`ARP-004J noisy anchored floor, signed noise ${noise}`,()=>{
  const r=runMapping(API,{slope:.12,noise});assert.ok(r.distance>1.87);assert.equal(r.rejected,0);
});
test('ARP-004J cold movement and reduced 192-point/3Hz budget recover without immunity',()=>{
  for(const options of [{slope:.12,immediate:true},{slope:.12,reduced:true}]){
    const r=runMapping(API,options);assert.ok(r.distance>1.8);assert.ok(r.maxStreak<15);assert.equal(r.ground.confidence,'anchored-temporal');assert.equal(r.ground.bytes,8624);
  }
});
function planePoints(slope=.12){const a=[];for(let x=-.9;x<=.9;x+=.09)for(let z=-.9;z<=.9;z+=.09)a.push(x,x*slope,z);return new Float64Array(a);}
test('ARP-004J support evidence needs independent time, expires and cannot turn missing depth into free space',()=>{
  const map=new SpatialMap();map.clear([0,0,0]);const g=new GroundEvidence(map,()=>0),points=planePoints();
  for(const t of [0,1,2])g.update(t,points,points.length/3);assert.equal(g.certified,false);
  g.update(100,points,points.length/3);g.update(200,points,points.length/3);assert.equal(g.certified,true);
  assert.equal(g.isMeasuredFloor(.75,.09,0),true);assert.equal(g.isMeasuredFloor(.75,.16,0),false);
  g.queryTime=1300;assert.equal(g.isMeasuredFloor(.75,.09,0),false);assert.equal(g.snapshot().confidence,'stale');
  g.update(1400,new Float64Array(),0);assert.equal(g.certified,false);
});
test('ARP-004J previously occupied floor is released only by current compatible evidence and old temporal votes',()=>{
  const s=new collision.ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);
  for(const t of [0,125,250]){s.map.begin(t,[0,0,0],1);s.map.observe(.72,.0864,0);s.map.observe(.72,.3,0);}
  assert.equal(s.map.occupiedCount,2);const points=planePoints();let freedAt=null;
  for(let t=500;t<=2250;t+=250){s.ground.update(t,points,points.length/3);s.map.begin(t,[0,0,0],1);s.map.observeGround(.72,.0864,0);if(s.map.stateAt(.72,.0864,0,t)!=='occupied')freedAt??=t;}
  assert.ok(freedAt>=1500&&freedAt<=2250);assert.equal(s.map.stateAt(.72,.3,0,2250),'occupied');assert.equal(s.map.releasedCount,1);
});
test('ARP-004J gradual anchored slope, reset, size, toggles and new sessions preserve isolation',()=>{
  const s=new collision.ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);
  for(let i=0;i<30;i++){const p=planePoints(i*.002);s.ground.update(i*125,p,p.length/3);}
  assert.equal(s.ground.certified,true);const before=s.position[1];s.setCharacter('bip',1,[0,0,0]);assert.equal(s.position[1],before);
  s.place([1,-1,2]);assert.equal(s.ground.certified,false);assert.equal(s.map.cells.size,0);
  s.setEnabled(false);assert.equal(s.ground.certified,false);s.start('waiting');assert.equal(s.ground.observations,0);assert.equal(s.probe.count,0);
});
test('ARP-004J tilted/translated compatible poses remain aligned; incompatible depth pose is rejected',()=>{
  const s=new collision.ARCollisions({}, {},()=>0),p=[0,0,-.8];s.start('waiting');s.place(p);s.setEnabled(true);s.setCharacter('bip',.81,p);
  for(let i=0;i<20;i++){const f=depthScene(API,{pitch:-.7,cameraX:i*.003});s.frame(i*125,true);s.accept(i*125,depth.createDepthReader(f.info,'float32'),f.info,f.view);}
  assert.equal(s.ground.certified,true);assert.equal(s.map.occupiedCount,0);
  const f=depthScene(API);f.info.transform={matrix:math.tr(.5,0,0)};f.info.projectionMatrix=f.view.projectionMatrix;s.accept(3000,depth.createDepthReader(f.info,'float32'),f.info,f.view);assert.equal(s.depthState,'geometry');
});
