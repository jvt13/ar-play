// SYNTHETIC geometry and lifecycle. No physical precision or Android claims.
import test from 'node:test';import assert from 'node:assert/strict';
import {SpatialMap,DepthProjector} from '../src/spatial-map.js';
import {ARCollisions,CollisionResolver,characterVolume} from '../src/collision.js';
import {SpatialRevalidator} from '../src/revalidation.js';
import {createDepthReader} from '../src/depth.js';
import {I,perspective,tr,sc,mul,ry} from '../src/math.js';
import {character} from '../src/engine.js';
import {DiagnosticArchive} from '../src/diagnostics.js';
import {SpatialDebug} from '../src/spatial-debug.js';
const volume={radius:.2,height:.7,ground:0};
function wall(m,x,t){m.begin(t,[0,0,0],1);for(let z=-.8;z<=.8;z+=.02)m.observe(x,.3,z);}
function mapWall(x=1){const m=new SpatialMap();m.clear([0,0,0]);for(const t of [0,125,250])wall(m,x,t);return m;}
function fixture(depth){const info={width:160,height:90,rawValueToMeters:.001,data:new Uint16Array(14400).fill(Math.round(depth*1000)).buffer,normDepthBufferFromNormView:{matrix:I()}},view={projectionMatrix:perspective(Math.PI/2,1),transform:{matrix:tr(0,.35,0)}};return {info,view};}
test('stable current wall rejects accumulated old normal outlier as contact geometry',()=>{
 const m=mapWall(.97);for(let t=375;t<=2000;t+=125)wall(m,1.04,t);
 const r=new CollisionResolver().move(m,[0,0,0],1.5,0,volume,2100);
 assert.ok(r.x>=1.04-.2-.025-.015-.001,`contact too early: ${r.x}`);
 assert.ok(r.x<=1.04-.2-.025-.015+1e-6);
});
test('contact refinement removes substep gap without changing radius or margins',()=>{
 const m=mapWall(1);const r=new CollisionResolver().move(m,[0,0,0],1.4,0,volume,300);
 assert.ok(Math.abs((1-r.x-.2)-.04)<.001,`gap ${1-r.x-.2}`);
});
test('directed geometric clearance handles a small displacement below legacy 18 cm',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);}
 const r=new SpatialRevalidator(()=>0),f=fixture(1.29),p=new DepthProjector();p.configure(f.info,f.view);
 for(const t of [8000,8250,8500,8750]){m.begin(t,[0,0,0],1);r.update(t,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,m,[0,0,0],volume,0,-.55);}
 assert.notEqual(m.stateAt(.02,.3,-1.2,8750),'occupied');
 // A near measurement only 3 cm deeper is insufficient to prove this envelope empty.
 const keep=new SpatialMap();keep.clear([0,0,0]);for(let t=0;t<=2000;t+=125){keep.begin(t,[0,0,0],1);keep.observe(.02,.3,-1.2);}
 const near=fixture(1.23),q=new DepthProjector(),safe=new SpatialRevalidator(()=>0);q.configure(near.info,near.view);
 for(const t of [8000,8250,8500,8750]){keep.begin(t,[0,0,0],1);safe.update(t,createDepthReader(near.info,'luminance-alpha'),q,near.view.projectionMatrix,keep,[0,0,0],volume,0,-.55);}
 assert.equal(keep.stateAt(.02,.3,-1.2,8750),'occupied');
});

test('known-wall contact and actual rendered body are measured at 40,54,66,100 percent for all models',()=>{
 for(const id of ['bip','nori','luma'])for(const scale of [.4,.54,.66,1]){
  const v=characterVolume(id,scale,0),m=new SpatialMap();m.clear([0,0,0]);let body=0,radius=0;
  for(const t of [0,125,250]){m.begin(t,[0,0,0],v.height);for(let h=.061;h<v.height;h+=v.height/32){radius=Math.max(radius,v.profile[Math.min(11,Math.floor(h/v.height*12))]*.42*scale);for(let z=-.5;z<=.5;z+=.03)m.observe(1,h,z);}}
  character({draw(_kind,matrix){body=Math.max(body,matrix[12]+Math.hypot(matrix[0],matrix[4],matrix[8]));}},id,sc(.42*scale,.42*scale,.42*scale),0,0,0,0);
  const r=new CollisionResolver().move(m,[0,0,0],1.4,0,v,300);
  const expected=1-radius-.04;assert.ok(Math.abs(r.x-expected)<1e-6,`${id} ${scale}: ${r.x} vs ${expected}`);
  assert.ok(r.x+radius<1);console.log('CONTACT_FIXTURE '+JSON.stringify({id,scale,bodyRadiusAtRest:body,wallHeight:v.height,volumeRadius:radius,finalX:r.x,volumeGap:1-r.x-radius,bodyGap:1-r.x-body,margin:.025,skin:.015}));
 }
});

test('low and high obstacles, retreat and slide keep their height-specific envelopes',()=>{
 for(const scale of [.4,.54,.66,1])for(const h of [.065,.9]){
  const v=characterVolume('nori',scale,0),m=new SpatialMap();m.clear([0,0,0]);
  for(const t of [0,125,250]){m.begin(t,[0,0,0],v.height);for(let z=-.5;z<.5;z+=.02)m.observe(1,h,z);}
  const solver=new CollisionResolver(),r={...solver.move(m,[0,0,0],1.3,0,v,300)};
  if(h>v.height)assert.ok(r.x>1.29);else{assert.ok(r.blocked);assert.ok(solver.move(m,[r.x,0,0],-.1,0,v,310).x<r.x-.09);assert.ok(solver.move(m,[r.x,0,0],0,.1,v,310).z>.09);}
 }
});

test('recent contact refinement does not bridge separate boxes or let the body cross a known wall',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);
 for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);for(let x=-.6;x<=.6;x+=.02)if(Math.abs(x)>.25)m.observe(x,.3,-1);}
 const solver=new CollisionResolver(),small={radius:.05,height:.7,ground:0};
 assert.ok(solver.move(m,[0,0,0],0,-2,small,2100).z<-1.99);
 const solid=mapWall();for(const speed of [.1,1,5])assert.ok(solver.move(solid,[.7,0,0],speed,0,volume,300).x<=.760001);
});

test('temporal normal noise has bounded recent contact rather than an ever-expanding envelope',()=>{
 const m=mapWall(.97);for(let t=375;t<=2500;t+=125)wall(m,1.04+Math.sin(t)*.002,t);
 const r=new CollisionResolver().move(m,[0,0,0],1.5,0,volume,2600);
 assert.ok(r.x>.797&&r.x<.803);assert.ok([...m.cells.values()].some(c=>c.refineAxis===0));
});

test('separate historical layers are revalidated individually after a small surface displacement',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);
 for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.93,.3,.02);m.observe(1.04,.3,.02);}
 const f=fixture(1.04);f.view.transform.matrix=mul(tr(0,.35,0),ry(-Math.PI/2));const p=new DepthProjector();p.configure(f.info,f.view);const r=new SpatialRevalidator(()=>0);
 for(const t of [8000,8250,8500,8750]){m.begin(t,[0,0,0],1);r.update(t,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,m,[0,0,0],volume,.55,0);}
 assert.notEqual(m.stateAt(.93,.3,.02,8750),'occupied');assert.equal(m.stateAt(1.04,.3,.02,8750),'occupied');
});

test('partial removal releases old peripheral cells while retaining an independent adjacent surface',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);
 for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);m.observe(.14,.3,-1.2);}
 const f=fixture(1.29),data=new Uint16Array(f.info.data);
 for(let y=0;y<90;y++)for(let x=0;x<160;x++)if(((2*(x+.5)/160-1)*1.2)>.08)data[y*160+x]=1200;
 const p=new DepthProjector();p.configure(f.info,f.view);const r=new SpatialRevalidator(()=>0);
 for(const t of [8000,8250,8500,8750,9000]){m.begin(t,[0,0,0],1);r.update(t,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,m,[0,0,0],volume,0,-.55);}
 assert.notEqual(m.stateAt(.02,.3,-1.2,9000),'occupied');assert.equal(m.stateAt(.14,.3,-1.2,9000),'occupied');
});

test('one close part of the measured footprint prevents clearing the whole occupied cell',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.01,.3,-1.2);m.observe(.10,.3,-1.2);}
 const f=fixture(3),data=new Uint16Array(f.info.data);for(let y=0;y<90;y++)for(let x=0;x<160;x++)if((2*(x+.5)/160-1)*1.2>.07)data[y*160+x]=1200;
 const p=new DepthProjector();p.configure(f.info,f.view);const r=new SpatialRevalidator(()=>0);
 for(const t of [8000,8250,8500,8750]){m.begin(t,[0,0,0],1);r.update(t,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,m,[0,0,0],volume,0,-.55);}
 assert.equal(m.stateAt(.01,.3,-1.2,8750),'occupied');
});

test('intermittent free rays cannot erase the independent sequence of reliable directed evidence',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(.02,.3,-1.2);}
 const c=m.cells.values().next().value;
 for(let i=0;i<4;i++){m.begin(8000+i*250,[0,0,0],1);if(i%2===0)m.markFree(c.ix,c.iy,c.iz,true);m.markFree(c.ix,c.iy,c.iz,'targeted');}
 assert.equal(m.cells.size,0);assert.equal(m.releasedCount,1);
});

test('only evidence releases obstacles: attempts and outside/occluded views keep memory valid',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.volume={...volume};
 for(let t=0;t<=2000;t+=125)wall(s.map,.6,t);
 for(let t=8000;t<9000;t+=125){s.frame(t,true);s.move([0,0,0],1,0,t);}
 assert.ok(s.map.occupiedCount>0);assert.ok(s.map.lastBlockCells[0].lastBlocked>=8000);assert.equal(s.map.lastBlockCells[0].freeHits,0);
});

test('2.9 ms load recovers adaptive frequency with headroom while true overload still reduces it',()=>{
 const s=new ARCollisions({}, {},()=>0);s.interval=500;s.columns=16;s.rows=12;
 for(let i=0;i<16;i++)s.adaptSpatial(2.9);assert.equal(s.interval,400);
 s.adaptSpatial(13.8);assert.equal(s.interval,500);assert.equal(s.columns*s.rows,192);
 for(let i=0;i<40;i++)s.adaptSpatial(3.5);assert.equal(s.interval,500);
 for(let i=0;i<100;i++)s.adaptSpatial(1);assert.equal(s.interval,125);assert.equal(s.columns*s.rows,432);
});

test('occupied reconstruction is preserved while redundant free rays have an explicit bounded budget',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,-1]);s.setEnabled(true);const f=fixture(2);
 for(let t=0;t<=2000;t+=125){s.frame(t,true);s.accept(t,createDepthReader(f.info,'luminance-alpha'),f.info,f.view);assert.ok(s.freeRayCount<=96);}
 assert.equal(s.used,432);assert.ok(s.map.occupiedCount>0);assert.equal(s.gridReadMs,0);assert.equal(s.pointReconstructionMs,0);assert.equal(s.mapUpdateMs,0);
});

test('same-session visibility suspension preserves valid memory but reset/end never reuses old coordinates',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);for(let t=0;t<=2000;t+=125)wall(s.map,.6,t);
 const count=s.map.cells.size,session=s.sessionId;s.setVisibility('hidden');s.frame(3000,false);
 assert.equal(s.map.cells.size,count);assert.equal(s.wantsDepth(3000),false);assert.deepEqual({...s.move([0,0,0],.1,0,3000)},{x:0,z:0});
 s.setVisibility('visible');s.frame(4000,true);assert.equal(s.map.cells.size,count);s.move([0,0,0],1,0,4000);assert.ok(s.blocked);
 s.stop('mode-change');assert.equal(s.map.cells.size,0);assert.equal(s.archive.last.reason,'mode-change');assert.ok(s.archive.last.lastBlock);
 s.start('waiting');assert.notEqual(s.sessionId,session);assert.equal(s.map.cells.size,0);assert.equal(s.eventCount,0);assert.equal(s.archive.last.session,session);const fresh=JSON.parse(s.exportText('manual-copy'));assert.equal(fresh.session,s.sessionId);assert.equal(fresh.lastBlock,null);assert.equal(fresh.events.length,0);
 s.place([0,0,0]);s.setEnabled(true);s.clearReference();assert.equal(s.map.cells.size,0);assert.equal(s.lastMapClearReason,'reference-reset');
});

test('visible pose invalidation clears geometry while preserving an anonymous last diagnostic',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([100,-5,200]);s.setEnabled(true);s.frame(100,true);s.move([100,-5,200],.02,0,100);s.frame(200,false);
 assert.equal(s.map.cells.size,0);assert.equal(s.archive.last.reason,'tracking-invalid');const archived=JSON.parse(s.archive.text());
 assert.equal(archived.events[0].dx,.02);assert.ok(!('previousX' in archived.events[0]));assert.ok(!('supportY' in archived.state));assert.ok(!s.archive.text().includes('projectionMatrix'));
});

test('archived text is bounded, versioned, isolated and does not retain raw geometry or absolute positions',()=>{
 const a=new DiagnosticArchive(()=>2000),id=a.begin(),events=Array.from({length:200},(_,i)=>({time:i,dx:.1,actualX:.1,previousX:12345,previousZ:6789,source:'x'.repeat(1000)}));
 a.capture(id,0,'session-end',events,events[199],{phase:'limited',supportY:999,points:new Float32Array(14400),blockedCells:[{id:7,state:'revalidating',ageMs:1000,freeEvidence:2,reason:'evidência contraditória',key:8877,minX:12345}],contact:{cellId:7,state:'revalidating',clearance:.04,surfaceDistance:.24,pointMargin:.025,skin:.015,absoluteX:12345}});
 const text=a.text(),record=JSON.parse(text);assert.ok(new TextEncoder().encode(text).length<=32000);assert.equal(record.version,'1.1.5');assert.equal(record.session,id);assert.ok(record.events.length<=32);assert.ok(!text.includes('12345'));assert.ok(!text.includes('points'));assert.ok(record.lastBlock);assert.equal(record.state.blockedCells[0].id,7);assert.equal(record.state.blockedCells[0].freeEvidence,2);assert.equal(record.state.blockedCells[0].reason,'evidência contraditória');assert.ok(!('key' in record.state.blockedCells[0]));assert.ok(!('minX' in record.state.blockedCells[0]));assert.equal(record.state.contact.clearance,.04);assert.ok(!('absoluteX' in record.state.contact));
 events[199].dx=999;assert.equal(a.last.lastBlock.dx,.1);a.clear();assert.equal(a.text(),'');
});

test('copy failure is explicit and manual export produces anonymous text without clearing active geometry',async()=>{
 const e={copyButton:{},exportButton:{},feedback:{},onExport:text=>{e.exported=text;}};
 const s=new ARCollisions(e,{},()=>0);s.start('waiting');s.place([100,0,200]);s.setEnabled(true);s.frame(100,true);s.move([100,0,200],.1,0,100);
 const result=await s.archive.copy('text',{writeText:async()=>{throw Error('denied');}});assert.equal(result.ok,false);assert.match(result.message,/Exportar/);
 e.exportButton.onclick();const record=JSON.parse(e.exported);assert.equal(record.session,s.sessionId);assert.ok(!('previousX' in record.events[0]));assert.equal(s.anchored,true);assert.equal(s.enabled,true);
 const ok=await s.archive.copy(e.exported,{writeText:async()=>{}});assert.equal(ok.ok,true);
});

test('significant contact diagnostics and actual 3D contact cells survive free movement until cleared',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.volume={...volume};for(let t=0;t<=2000;t+=125)wall(s.map,1,t);
 s.frame(3000,true);s.move([0,0,0],1.5,0,3000);assert.ok(s.contact);assert.ok(Math.abs(s.contact.clearance-.04)<1e-6);assert.ok(s.lastBlock.surfaceDistance>0);
 const d=new SpatialDebug({releaseDebug(){},drawDebug(){}},()=>0);s.debug3D=true;d.prepare(s,3000);assert.ok(d.groups[12].count>0);assert.ok(d.groups[13].count>0);
 s.frame(3100,true);s.move([.7,0,0],-.1,0,3100);assert.equal(s.blocked,false);assert.ok(s.lastBlock.surfaceDistance>0);d.prepare(s,3100);assert.ok(d.groups[12].count>0);
 s.stop();d.prepare(s,3200);assert.equal(d.count,0);
});


test('immediate-only blocking reports the actual measured segment distance without inventing map cells',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.volume={...volume};s.probe.count=1;s.probe.history.set([1,.3,0,250,0,1,.5]);
 s.frame(300,true);const r=s.move([0,0,0],1.5,0,300);assert.ok(r.x<.761);assert.equal(s.blockSource,'sonda imediata');assert.equal(s.contact.kind,'sonda');assert.ok(Math.abs(s.contact.clearance-.04)<1e-6);assert.equal(s.contact.cellId,null);assert.equal(s.map.occupiedCount,0);
});

test('the actual blocking cell is revalidated before older unrelated cells and movement is released',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([.02,0,0]);s.setEnabled(true);s.volume={...volume};
 for(let t=0;t<=2000;t+=125){s.map.begin(t,[.02,0,0],1);for(let x=-10;x<=10;x++)for(let z=-12;z<=-5;z++)if(Math.abs(x)>=4)s.map.observe(x*.12,.3,z*.12);s.map.observe(.02,.3,-1.2);}
 s.frame(7500,true);s.move([.02,0,0],0,-1.8,7500);assert.ok(s.blocked);assert.ok(s.map.blockCellCount>0);
 const f=fixture(3),p=new DepthProjector();p.configure(f.info,f.view);
 for(const t of [8000,8250,8500,8750]){s.map.begin(t,[.02,0,0],1);s.revalidator.update(t,createDepthReader(f.info,'luminance-alpha'),p,f.view.projectionMatrix,s.map,[.02,0,0],volume,0,-.55);}
 assert.notEqual(s.map.stateAt(.02,.3,-1.2,8750),'occupied');assert.ok(s.map.occupiedCount>0);assert.ok(s.move([.02,0,0],0,-1.8,8750).z<-1.79);
});

test('clearing textual histories preserves active map and collision controls',()=>{
 const e={clearButton:{},feedback:{}},s=new ARCollisions(e,{},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.volume={...volume};
 for(let t=0;t<=2000;t+=125)wall(s.map,1,t);s.frame(3000,true);s.move([0,0,0],1.5,0,3000);s.exportText();const count=s.map.cells.size;assert.ok(s.lastBlockAvailable);assert.ok(s.archive.last);
 e.clearButton.onclick();assert.equal(s.lastBlockAvailable,false);assert.equal(s.archive.last,null);assert.equal(s.map.cells.size,count);assert.equal(s.enabled,true);assert.equal(s.map.blockCellCount,0);
});
