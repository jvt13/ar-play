// SYNTHETIC temporal geometry: no physical sensor or semantic recognition.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialMap} from '../src/spatial-map.js';
import {ARCollisions, CollisionResolver} from '../src/collision.js';
import {createDepthReader} from '../src/depth.js';
import {DepthProjector} from '../src/spatial-map.js';
import {SpatialRevalidator} from '../src/revalidation.js';
import {SpatialDebug} from '../src/spatial-debug.js';
import {I,perspective,tr,mul,ry} from '../src/math.js';
const volume={radius:.2,height:.7,ground:0};
function observed(end=2000,config={}) {
  const m=new SpatialMap(config);m.clear([0,0,0]);
  for(let t=0;t<=end;t+=125){m.begin(t,[0,0,0],1);for(let z=-.45;z<=.45;z+=.04)m.observe(.6,.3,z);}
  return m;
}
test('known wall survives absence from view beyond five seconds and still blocks (synthetic)',()=>{
  const m=observed();m.begin(8000,[0,0,1],1); // Camera does not observe the wall again.
  assert.equal(m.stateAt(.6,.3,0,8000),'occupied');
  const r=new CollisionResolver().move(m,[0,0,0],1,0,volume,8000);
  assert.ok(r.blocked);assert.ok(r.x<.6-.2);
});
test('many pixels in one frame cannot manufacture consolidated occupancy (synthetic)',()=>{
  const m=new SpatialMap();m.clear([0,0,0]);m.begin(0,[0,0,0],1);
  for(let i=0;i<200;i++)m.observe(.6,.3,0);
  assert.equal(m.occupiedCount,0);
});

function pointMap(end=2000){
  const m=new SpatialMap();m.clear([0,0,0]);
  for(let t=0;t<=end;t+=125){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);}
  return m;
}
function fixture(depth=1.2,pose=tr(0,.35,0),width=160,height=90){
  const projection=perspective(Math.PI/2,1),data=new Uint16Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=Math.round((typeof depth==='function'?depth((x+.5)/width,(y+.5)/height):depth)*1000);
  return {info:{width,height,rawValueToMeters:.001,data:data.buffer,normDepthBufferFromNormView:{matrix:I()}},view:{projectionMatrix:projection,transform:{matrix:pose}}};
}
function revisit(m,r,f,time){
  m.begin(time,[0,0,0],1);const p=new DepthProjector();assert.ok(p.configure(f.info,f.view));
  r.update(time,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,m,[0,0,0],volume,0,-.55);
}
function system(){
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,-.3]);s.setCharacter('bip',1,[0,0,-.3]);s.setEnabled(true);return s;
}
function acquire(s,f,time){s.frame(time,true);s.accept(time,createDepthReader(f.info,'luminance-alpha'),f.info,f.view);}

test('memory states distinguish candidate, confirmed, consolidated, awaiting and unknown',()=>{
  const m=new SpatialMap();m.clear([0,0,0]);m.begin(0,[0,0,0],1);m.observe(.02,.3,-1.2);
  let c=m.cells.values().next().value;assert.equal(m.memoryState(c,0),'candidate');
  for(const t of [125,250]){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);}
  assert.equal(m.memoryState(c,250),'confirmed');
  for(let t=375;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);}
  assert.equal(m.memoryState(c,2000),'consolidated');assert.equal(m.memoryState(c,8000),'revalidating');
  assert.equal(c.firstSeen,0);assert.equal(c.time,2000);assert.equal(c.observations,17);
  assert.equal(m.memoryState(c,47000),'unknown');m.expire(47000);assert.equal(m.stateAt(.02,.3,-1.2,47000),'unknown');
});

test('consolidation requires temporal span, coherent geometry and independent updates',()=>{
  const m=pointMap(875),c=m.cells.values().next().value;assert.equal(c.consolidated,false);
  // Repeated batches with the same timestamp do not add independent observations.
  for(let i=0;i<30;i++){m.begin(875,[0,0,0],1);m.observe(.02,.3,-1.2);}
  assert.equal(c.observations,8);assert.equal(c.consolidated,false);
  for(let t=1000;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);}
  assert.equal(c.consolidated,true);
  const unstable=new SpatialMap();unstable.clear([0,0,0]);
  for(let t=0;t<=2000;t+=125){unstable.begin(t,[0,0,0],1,tr(t/1000,.35,0));unstable.observe(.001+(t/125%2)*.118,.3,-1.2);if(t===125)assert.equal(unstable.cells.values().next().value.consistentUpdates,1);}
  // The envelope can be real, but alternating early points must not multiply temporal votes.
  assert.equal(unstable.cells.values().next().value.observations,17);assert.ok(Math.abs(unstable.stats(2000).maxViewpointSpan-2)<1e-6);
});

test('camera return confirms measured geometry and renews retention without a semantic object',()=>{
  const m=pointMap(),r=new SpatialRevalidator(()=>0),f=fixture();
  revisit(m,r,f,8000);const c=m.cells.values().next().value;
  assert.equal(c.time,8000);assert.equal(r.refreshed,1);assert.ok(m.stats(8000).revalidated>0);
  assert.equal(m.stateAt(.02,.3,-1.2,47000),'occupied');
  revisit(m,r,f,48000);assert.equal(c.time,48000);
});

test('removed table clears through distinct directed observations before long retention expires',()=>{
  const m=pointMap(),r=new SpatialRevalidator(()=>0),f=fixture(3);
  revisit(m,r,f,8000);assert.equal(m.occupiedCount,1);assert.equal(m.memoryState(m.cells.values().next().value,8000),'revalidating');
  // Hundreds of pixels/duplicate updates cannot count as four observations.
  revisit(m,r,f,8000);assert.equal(m.occupiedCount,1);
  for(const t of [8250,8500,8750])revisit(m,r,f,t);
  assert.equal(m.occupiedCount,0);assert.equal(m.releasedCount,1);assert.equal(m.stateAt(.02,.3,-1.2,8750),'free');
  const out=new CollisionResolver().move(m,[.02,0,0],0,-1.8,volume,8750);assert.ok(out.z<-1.79);
});

test('nearer occluder preserves old obstacle without renewing its last observation',()=>{
  const m=pointMap(),r=new SpatialRevalidator(()=>0),f=fixture(.6);
  for(const t of [8000,8250,8500,8750])revisit(m,r,f,t);
  const c=m.cells.values().next().value;assert.equal(c.time,2000);assert.equal(c.freeHits,0);assert.equal(c.visibility,'occluded');
  assert.equal(m.stateAt(.02,.3,-1.2,8750),'occupied');assert.equal(m.stats(8750).occluded,1);
  assert.ok(new CollisionResolver().move(m,[.02,0,0],0,-1.8,volume,8750).z>-1);
});

test('missing, isolated, duplicate and incoherent depth never erase consolidated geometry',()=>{
  for(const f of [fixture(0),fixture((u,v)=>Math.floor(u*160)===81&&Math.floor(v*90)===46?3:0),fixture(3,tr(0,.35,0),1,1),fixture((u,v)=>(Math.floor(u*160)+Math.floor(v*90))%2?3:1.2)]){
    const m=pointMap(),r=new SpatialRevalidator(()=>0);
    for(const t of [8000,8250,8500,8750])revisit(m,r,f,t);
    assert.equal(m.stateAt(.02,.3,-1.2,8750),'occupied');assert.equal(m.releasedCount,0);
  }
});

test('contradictions interrupted by an actual occluder require fresh reliable evidence',()=>{
  const m=pointMap(),r=new SpatialRevalidator(()=>0);
  for(const t of [8000,8250,8500])revisit(m,r,fixture(3),t);
  revisit(m,r,fixture(.6),8750);revisit(m,r,fixture(3),9000);
  assert.equal(m.occupiedCount,1);
  for(const t of [9250,9500,9750])revisit(m,r,fixture(3),t);
  assert.equal(m.occupiedCount,0);
});

test('out-of-view and out-of-ROI memory is retained, revalidated and can be cleared on return',()=>{
  const m=pointMap(),r=new SpatialRevalidator(()=>0),turned=fixture(3,mul(tr(0,.35,0),ry(Math.PI)));
  revisit(m,r,turned,8000);assert.equal(r.outside,1);assert.equal(m.stateAt(.02,.3,-1.2,8000),'occupied');
  // Character moved >3 m away: existing cells remain; revalidation still targets their measured centre.
  m.begin(8250,[4,0,0],1);const p=new DepthProjector(),f=fixture(3);p.configure(f.info,f.view);
  for(const t of [8250,8500,8750,9000]){m.begin(t,[4,0,0],1);r.update(t,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,m,[4,0,0],volume,-.55,0);}
  assert.equal(m.occupiedCount,0);assert.equal(m.releasedCount,1);
});

test('temporal sequence: camera turns, character collides, returns, object is removed and path releases',()=>{
  const s=system(),p=[.02,0,-.3];
  for(let t=0;t<=2000;t+=125){s.map.begin(t,p,1);s.map.observe(.02,.3,-1.2);}
  const hidden=fixture(3,mul(tr(0,.35,0),ry(Math.PI)));acquire(s,hidden,8000);
  const blocked={...s.move(p,0,-1.5,8000)};assert.ok(s.blocked);assert.ok(blocked.z>-.95);assert.equal(s.blockEvidence,'memória espacial');
  const back={...s.move([blocked.x,0,blocked.z],0,.1,8100)};assert.ok(back.z>blocked.z+.09);
  const side=s.move([blocked.x,0,blocked.z],.1,0,8100);assert.ok(side.x>blocked.x+.09);
  acquire(s,fixture(1.2),8250);assert.equal(s.map.stateAt(.02,.3,-1.2,8250),'occupied');
  for(let t=9250;t<=11500;t+=125)acquire(s,fixture(3),t);
  assert.equal(s.map.stateAt(.02,.3,-1.2,11500),'free');assert.ok(s.map.releasedCount>0);
  const free=s.move(p,0,-1.3,11500);assert.ok(free.z<-1.59,free.z);
});

test('displaced furniture creates new occupancy and independently releases the old location',()=>{
  const s=system();for(let t=0;t<=2000;t+=125){s.map.begin(t,[0,0,-.3],1);s.map.observe(.02,.3,-1.2);}
  const moved=fixture((u)=>{const x=(2*u-1)*1.2;return x>.6&&x<1?1.2:3;});
  for(let t=8000;t<=10500;t+=125)acquire(s,moved,t);
  assert.notEqual(s.map.stateAt(.02,.3,-1.2,10500),'occupied');
  const old=s.move([.02,0,-.3],0,-1.3,10500);assert.ok(old.z<-1.59);
  const newPlace=s.move([.8,0,-.3],0,-1.3,10500);assert.ok(s.blocked);assert.ok(newPlace.z>-.95);
});

test('reliable release invalidates obsolete probe contacts without dropping independent neighbours',()=>{
  const s=system();for(let t=0;t<=2000;t+=125){s.map.begin(t,[0,0,-.3],1);s.map.observe(.02,.3,-1.2);}
  s.probe.count=2;s.probe.history.set([.02,.3,-1.2,8500,1,0,.02, .7,.3,-1.2,8500,1,0,.02]);
  for(const t of [8000,8250,8500,8750])revisit(s.map,s.revalidator,fixture(3),t);
  assert.equal(s.probe.count,1);assert.ok(Math.abs(s.probe.history[0]-.7)<1e-6);
  assert.equal(s.probe.penetration(.02,-1.2,volume,8750,.015),0);
});

test('capacity eviction prefers stale/far candidates and never exceeds either storage bound',()=>{
  const m=observed(2000,{maxCells:8,maxFreeCells:8});
  for(let t=3000;t<5000;t+=125){m.begin(t,[2,0,0],1);for(let i=0;i<30;i++)m.observe(2+(i%5)*.12,.2+Math.floor(i/5)*.12,0);}
  assert.ok(m.cells.size<=8);assert.ok(m.evictedCount>0||m.rejectedCount>0);assert.ok(m.evictionChecks<=256);
  const keep=pointMap();keep.config.maxCells=1;keep.begin(2500,[0,0,0],1);keep.observe(1,.3,-1);
  assert.equal(keep.stateAt(.02,.3,-1.2,2500),'occupied');assert.ok(keep.rejectedCount>0);
  const far=pointMap();far.config.maxCells=1;far.begin(3000,[5,0,0],1);far.observe(5,.3,0);
  assert.equal(far.stateAt(.02,.3,-1.2,3000),'unknown');assert.equal(far.evictedCount,1);
});

test('revalidation has fixed query/scan limits and adapts its budget with recovery',()=>{
  const m=observed(),r=new SpatialRevalidator(()=>0),f=fixture(3);
  revisit(m,r,f,8000);assert.ok(r.checks<=8);assert.ok(r.queries<=40);assert.ok(m.cells.size<=4096);
  let clock=0;r.now=()=>clock+=3;revisit(m,r,f,8250);assert.equal(r.budget,6);
  r.now=()=>0;for(let t=8500;t<=11000;t+=250)revisit(m,r,f,t);assert.ok(r.budget>6);
});

test('guided mapping holds the character and completing it preserves the exact map',()=>{
  const s=system();s.setGuided(true);assert.equal(s.guided,true);
  const p=[0,0,-.3];for(let t=0;t<=2000;t+=125)acquire(s,fixture(1.2),t);
  assert.ok(s.map.occupiedCount>0);const count=s.map.cells.size;
  assert.deepEqual({...s.move(p,1,-1,2100)},{x:0,z:-.3});
  s.setGuided(false);assert.equal(s.map.cells.size,count);assert.equal(s.guided,false);
  const r=s.move(p,.1,0,2125);assert.ok(r.x>.09);
});

test('disable, reset, reposition, tracking invalidation and session end clear all memory and schedules',()=>{
  for(const action of [s=>s.setEnabled(false),s=>s.clearReference(),s=>s.place([1,0,0]),s=>s.frame(9000,false),s=>s.stop()]){
    const s=system();for(let t=0;t<=2000;t+=125)acquire(s,fixture(1.2),t);s.setGuided(true);s.debug3D=true;
    action(s);assert.equal(s.map.cells.size,0);assert.equal(s.map.releaseCount,0);assert.equal(s.revalidator.count,0);assert.equal(s.revalidator.cursor,null);assert.equal(s.guided,false);assert.equal(s.debug3D,false);assert.equal(s.probe.count,0);
  }
});

test('3D debug and textual memory diagnostics represent consolidated, awaiting and released data',()=>{
  const s=system(),d=new SpatialDebug({releaseDebug(){},drawDebug(){}},()=>0);s.map=pointMap();s.debug3D=true;s.frame(2000,true);d.prepare(s,2000);
  assert.ok(d.groups[9].count>0);assert.equal(d.groups[2].count,0);
  s.frame(8000,true);d.prepare(s,8000);assert.ok(d.groups[10].count>0);
  for(const t of [8000,8250,8500,8750])revisit(s.map,s.revalidator,fixture(3),t);
  s.frame(8750,true);d.prepare(s,8750);assert.ok(d.groups[11].count>0);assert.equal(d.groups[10].count,0);
  const text=JSON.parse(s.diagnosticText());assert.equal(text.state.memory.released,1);assert.equal(text.state.memory.confirmed,0);assert.equal(text.state.guided,false);assert.equal(text.state.memory.oldestAgeMs,null);
});

test('unavailable depth keeps conventional movement without inventing a map or enabling guided mapping',()=>{
  const s=system();s.available=false;s.setGuided(true);assert.equal(s.guided,false);
  const r=s.move([0,0,-.3],.2,-.1,100);assert.ok(Math.abs(r.x-.2)<1e-6&&Math.abs(r.z+.4)<1e-6);assert.equal(s.map.occupiedCount,0);
});

test('last block distinguishes both recent probe and old spatial memory, surviving later free motion',()=>{
  const s=system();s.map=pointMap();s.volume={...volume};
  s.probe.count=1;s.probe.history.set([.02,.3,-1.2,8000,1,0,.2]);
  s.frame(8000,true);s.move([.02,0,-.8],0,-.4,8000);
  assert.equal(s.blocked,true);assert.equal(s.blockEvidence,'evidência atual e memória espacial');
  const saved={...s.lastBlock};assert.equal(saved.memoryAgeMs,6000);assert.equal(saved.probeEvidenceAgeMs,0);s.move([.02,0,-.8],0,.1,8100);
  assert.equal(s.blocked,false);assert.equal(s.lastBlock.memorySource,saved.memorySource);assert.equal(s.lastBlock.time,8000);
});

test('expiry ignores stale cells immediately and runtime maintenance scans a fixed budget',()=>{
  const m=new SpatialMap();m.clear([0,0,0]);
  for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);for(let x=-10;x<=10;x++)for(let z=-10;z<=10;z++)m.observe(x*.12+.02,.3,z*.12+.02);}
  assert.ok(m.cells.size>128);const before=m.cells.size;m.maintain(47000);
  assert.equal(before-m.cells.size,128);assert.equal(m.stateAt(.02,.3,.02,47000),'unknown');
  assert.equal(m.penetration(0,0,volume,47000),0);assert.equal(m.stats(47000).confirmed,0);
  m.expire(47000);assert.equal(m.cells.size,0);
});
