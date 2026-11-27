// SYNTHETIC geometry. The supplied phone diagnosis does not include a scene reconstruction.
// ARP-004I: retired oriented/partial-step physics tests retain their bodies with explicit skip reasons; independent geometry tests remain active.
import test from 'node:test';import assert from 'node:assert/strict';
import {ARCollisions,CollisionResolver,characterVolume} from '../src/collision.js';
import {configurePose,supportAt,radiusAt} from './experimental/volume.js';
import {SpatialMap} from '../src/spatial-map.js';
import {character} from '../src/engine.js';
import {SpatialDebug} from '../src/spatial-debug.js';
import {SpatialRevalidator} from '../src/revalidation.js';
import {DepthProjector} from '../src/spatial-map.js';
import {createDepthReader} from '../src/depth.js';
import {I,ry,sc,mul,perspective,tr} from '../src/math.js';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
function wall(m,z,t){m.begin(t,[0,0,0],1);for(let x=-.5;x<=.5;x+=.02)m.observe(x,.2,z);}
function wedge(){
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);
 s.volume={radius:.129528,height:.28308,ground:0};
 for(const t of [0,125,250])wall(s.map,-.178445998665232,t);
 for(const [i,x,z] of [[0,-1,.3],[1,1,-.1]]){
  const n=Math.hypot(x,z),nx=x/n,nz=z/n,d=s.volume.radius+.04+2e-7;
  s.probe.history.set([nx*d,.2,nz*d,250,-nz,nx,.6],i*7);
 }s.probe.count=2;return s;
}
test('diagonal wedge permits a partial requested path although both axis-only directions touch',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 const s=wedge(),dx=-.005380779559468197,dz=-.02696844844132508;
 s.frame(300,true);const r=s.move([0,0,0],dx,dz,300);
 assert.equal(s.penetrationBefore,0);assert.ok(s.penetrationTarget>0);
 assert.ok(Math.hypot(r.x,r.z)>.008,`entire vector rejected: ${r.x},${r.z}`);
 assert.ok(r.z>-.0089191);assert.ok(s.blocked);assert.ok(s.lastBlockAvailable);assert.ok(Number.isFinite(s.lastBlock.contactDistance));assert.equal(s.lastBlock.rejectionMeasurement,'last-rejected-subquery');assert.equal(s.lastBlock.contactMeasurement,'representative-final-position');
});
test('map invalidation clears the live representative contact, state and delayed status',()=>{
 const status={hidden:false,textContent:''},s=new ARCollisions({status},{},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);
 for(const t of [0,125,250])wall(s.map,-.6,t);
 s.frame(300,true);s.move([0,0,0],0,-1,300);s.render(300,false);assert.ok(s.contact);
 s.clearReference();assert.equal(s.snapshot().contact,null);assert.equal(s.blocked,false);assert.equal(status.textContent,'');assert.equal(s.map.cells.size,0);
});
test('placement immediately adopts the selected support height, before the next XR frame',()=>{
 const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,-1.4,0]);near(s.volume.ground,-1.4);near(s.position[1],-1.4);
});

// Independent support of a transformed sphere clipped to a horizontal band.
function clippedSupport(m,nx,nz,low,high){
 const q=[m[0]*nx+m[2]*nz,m[4]*nx+m[6]*nz,m[8]*nx+m[10]*nz],a=[m[1],m[5],m[9]],length=Math.hypot(...q),ay2=a[0]**2+a[1]**2+a[2]**2;
 const dot=q[0]*a[0]+q[1]*a[1]+q[2]*a[2],supportY=m[13]+dot/length,cy=Math.max(low,Math.min(high,supportY))-m[13];
 if(supportY>=low&&supportY<=high)return m[12]*nx+m[14]*nz+length;
 return m[12]*nx+m[14]*nz+dot*cy/ay2+Math.sqrt(Math.max(0,length**2-dot**2/ay2))*Math.sqrt(Math.max(0,1-cy**2/ay2));
}
test('oriented walk envelope independently contains rendered sphere sections at headings and intermediate phases',()=>{
 for(const id of ['bip','nori','luma'])for(const yaw of [0,Math.PI/2,Math.PI,3*Math.PI/2,.37])for(const walk of [0,.13,.57,1]){
  const v=configurePose(characterVolume(id,1,0),id,yaw,false),root=mul(ry(yaw),sc(.42,.42,.42));
  const e={draw(kind,m){assert.equal(kind,'sphere');const hy=Math.hypot(m[1],m[5],m[9]);
   for(let b=0;b<12;b++){
    const low=b*v.height/12,high=(b+1)*v.height/12;if(m[13]+hy<low||m[13]-hy>high)continue;
    for(let n=0;n<8;n++){const angle=n*Math.PI/4,nx=Math.cos(angle),nz=Math.sin(angle),expected=clippedSupport(m,nx,nz,low,high),bound=supportAt(v,(low+high)/2,(low+high)/2,nx,nz);assert.ok(expected<=bound+2e-6,`${id} yaw=${yaw} walk=${walk} band=${b} ${expected}>${bound}`);}
   }
  }};
  for(let i=0;i<49;i++)character(e,id,root,(i+.371)*2*Math.PI/49/9,walk,0,0);
 }
});


test('oriented volume slides along a sampled wall without false radial-support contacts',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 const m=new SpatialMap();m.clear([0,0,0]);const v=configurePose(characterVolume('bip',.66,0),'bip',0),solver=new CollisionResolver();
 for(const t of [0,125,250]){m.begin(t,[0,0,0],v.height);for(let z=-2;z<=2;z+=.06)for(let y=.07;y<v.height;y+=.08)m.observe(.6,y,z);}
 const a={...solver.move(m,[0,0,0],1,0,v,300)},b=solver.move(m,[a.x,0,0],.3,.5,v,340);
 assert.ok(b.z>.49999,`tangent falsely blocked ${b.z}`);assert.ok(b.x<=a.x+1e-5);
});


test('ARP-004I restores 1.1.5 legacy free-evidence revalidation for off-view footprint',()=>{
 const m=new SpatialMap();m.clear([0,0,0]);for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1);m.observe(1.18,.3,-1.2);}
 const info={width:160,height:90,rawValueToMeters:.001,data:new Uint16Array(14400).fill(3000).buffer,normDepthBufferFromNormView:{matrix:I()}},view={projectionMatrix:perspective(Math.PI/2,1),transform:{matrix:tr(0,.35,0)}},p=new DepthProjector(),r=new SpatialRevalidator(()=>0);assert.ok(p.configure(info,view));
 for(const t of [8000,8250,8500,8750]){m.begin(t,[0,0,0],1);r.update(t,createDepthReader(info,'luminance-alpha'),p,view.projectionMatrix,m,[0,0,0],{radius:.2,height:.7,ground:0},0,-.5);}
 assert.equal(m.stateAt(1.18,.3,-1.2,8750),'free');
});


function sideWall(m,x,height,t){m.begin(t,[0,0,0],height);for(let z=-1;z<=1;z+=.03)for(let y=.061;y<height;y+=height/48)m.observe(x,y,z);}
function posedSystem(scale=.4){const s=new ARCollisions({}, {orientedVolume:true},()=>0);s.start('waiting');s.place([0,0,0]);s.setCharacter('bip',scale,[0,0,0]);s.setEnabled(true);s.frame(300,true);return s;}

test('known contact improves body clearance at four scales and multiple headings for all three characters',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 for(const id of ['bip','nori','luma'])for(const scale of [.4,.54,.66,1])for(const yaw of [0,Math.PI/2,Math.PI,3*Math.PI/2,.37]){
  const old=characterVolume(id,scale,0),v=configurePose(characterVolume(id,scale,0),id,yaw),m=new SpatialMap();m.clear([0,0,0]);for(const t of [0,125,250])sideWall(m,1,v.height,t);
  let radius=0,body=0;for(let y=.061;y<v.height;y+=v.height/48)radius=Math.max(radius,supportAt(v,y,y,1,0));
  const root=mul(ry(yaw),sc(v.size,v.size,v.size));character({draw(_k,a){body=Math.max(body,a[12]+Math.hypot(a[0],a[4],a[8]));}},id,root,0,0,0,0);
  const r={...new CollisionResolver().move(m,[0,0,0],1.5,0,v,300)},previous={...new CollisionResolver().move(m,[0,0,0],1.5,0,old,300)};
  assert.ok(Math.abs(1-r.x-radius-.04)<.001,`${id} scale ${scale} yaw ${yaw} gap ${1-r.x-radius}`);
  assert.ok(r.x>=previous.x-1e-6);assert.ok(1-r.x-body>.025,`visual penetration ${id}`);
  console.log('ORIENTED_CONTACT '+JSON.stringify({id,scale,yaw,oldRadius:1-previous.x-.04,newSupport:radius,restBodyExtent:body,oldStop:previous.x,newStop:r.x,oldBodyGap:1-previous.x-body,newBodyGap:1-r.x-body,margin:.025,skin:.015}));
 }
});

test('dance expansion waits for space; rest/walk transitions and jump keep grounded horizontal protection',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 const s=posedSystem(),v=s.volume;for(const t of [0,125,250])sideWall(s.map,.15,v.height,t);
 assert.equal(s.requestPose(0,true,300),false);assert.equal(s.poseDance,false);near(s.position[0],0);
 const out={...s.move([0,0,0],-.2,0,320)};assert.ok(out.x<-.19);assert.equal(s.requestPose(0,true,330),true);assert.equal(s.volume.bodyBounds,null);
 assert.equal(s.requestPose(.7,false,340),true);assert.equal(s.volume.poseMode,'oriented-walk');
 const ground=s.volume.ground;s.noteRendered(.1,.003,.1);near(s.volume.ground,ground);
 assert.ok(s.move([0,0,0],1,0,350).x<.15);
});

test('rotation validates the actual target volume without shifting the character or locking retreat',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 const s=posedSystem();s.setCharacter('nori',.4,[0,0,0]);for(const t of [0,125,250])sideWall(s.map,.15,s.volume.height,t);
 assert.equal(s.requestPose(-Math.PI/2,false,300),false);near(s.poseYaw,0);near(s.position[0],0);
 assert.ok(s.move([0,0,0],-.15,0,320).x<-.14);assert.equal(s.requestPose(-Math.PI/2,false,330),true);near(s.poseYaw,-Math.PI/2);
 s.requestPose(Math.PI/2,false,340);near(s.poseDesiredYaw,Math.PI/2);
});

test('continuous pressure stays at contact, retreat and sliding remain possible',()=>{
 const s=posedSystem(.66);for(const t of [0,125,250])sideWall(s.map,.6,s.volume.height,t);
 let p=[0,0,0];for(let i=0;i<100;i++){const r=s.move(p,.0275,0,300+i);p=[r.x,0,r.z];}
 const contact=p[0];assert.ok(contact<.6);for(let i=0;i<20;i++){const r=s.move(p,.0275,0,500+i);p=[r.x,0,r.z];}near(p[0],contact,2e-6);
 const slide={...s.move(p,.02,.2,550)};assert.ok(slide.z>.199);assert.ok(s.move(p,-.1,0,560).x<p[0]-.099);
});

test('oriented narrow phase still catches a small low obstacle and leaves an adjacent path free',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 const s=posedSystem(.66);for(const t of [0,125,250]){s.map.begin(t,[0,0,0],s.volume.height);s.map.observe(.45,.08,0);}
 const r={...s.move([0,0,0],1,0,300)};assert.ok(s.blocked&&r.x<.45);
 const free=s.move([0,0,.4],1,0,310);assert.ok(free.x>.99);
});

test('placement detects known overlap, permits relief and does not manufacture a global lock',()=>{
 const s=posedSystem();for(const t of [0,125,250])wall(s.map,-.085,t);s.validatePlacement(300);assert.equal(s.placementState,'occupied');near(s.position[2],0);
 const outward={...s.move([0,0,0],0,.2,310)};assert.ok(outward.z>.19);s.validatePlacement(310);assert.equal(s.placementState,'no-known-overlap');
 s.place([0,-.7,0]);assert.equal(s.map.cells.size,0);assert.equal(s.contact,null);assert.equal(s.placementState,'waiting-for-data');near(s.volume.ground,-.7);
 assert.ok(s.move([0,-.7,0],.1,0,320).x>.099);
});

test('same reference suspension preserves memory; new session and reference reset isolate all contacts',()=>{
 let clock=300;const s=new ARCollisions({}, {orientedVolume:true},()=>clock);s.start('waiting');s.place([0,0,0]);s.setCharacter('bip',.4,[0,0,0]);s.setEnabled(true);for(const t of [0,125,250])sideWall(s.map,.5,s.volume.height,t);
 s.frame(300,true);s.move([0,0,0],1,0,300);assert.ok(s.lastBlockAvailable);const generation=s.mapGeneration,oldId=s.sessionId;
 s.setVisibility('hidden');s.setVisibility('visible');assert.ok(s.map.occupiedCount);assert.equal(s.mapGeneration,generation);
 const saved=JSON.parse(s.exportText());assert.ok(saved.lastBlock);assert.ok(saved.state.lifecycle.some(e=>e.kind==='suspended'));assert.ok(saved.state.lifecycle.some(e=>e.kind==='resumed'));
 clock=500;s.stop('XRSession.end');assert.equal(s.map.cells.size,0);assert.equal(s.probe.count,0);assert.equal(s.contact,null);assert.ok(s.archive.last.lastBlock);
 s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.frame(510,true);assert.notEqual(s.sessionId,oldId);assert.equal(s.map.cells.size,0);assert.equal(s.lastBlockAvailable,false);assert.ok(s.move([0,0,0],1,0,520).x>.999);
 s.clearReference();assert.equal(s.contact,null);assert.equal(s.probe.count,0);assert.ok(s.mapGeneration>0);
});

test('lifecycle log is bounded and anonymised; fresh placements replace old-generation state',()=>{
 const s=posedSystem();for(let i=0;i<30;i++){s.setVisibility('hidden');s.setVisibility('visible');}
 let saved=JSON.parse(s.exportText());assert.ok(saved.state.lifecycle.length<=16);assert.equal(saved.version,'1.2.0-alpha.1');
 assert.ok(!s.archive.text().includes('previousX'));s.place([1,-1,2]);saved=JSON.parse(s.exportText());assert.equal(saved.mapGeneration,s.mapGeneration);assert.equal(saved.state.placementState,'waiting-for-data');assert.equal(saved.lastBlock,null);
});

test('turning collisions off preserves conventional displacement and clears live geometry',()=>{
 const s=posedSystem();for(const t of [0,125,250])wall(s.map,-.2,t);s.frame(300,true);s.move([0,0,0],0,-1,300);assert.ok(s.blocked);s.setEnabled(false);
 assert.equal(s.map.cells.size,0);assert.equal(s.probe.count,0);assert.equal(s.contact,null);const r=s.move([0,0,0],0,-1,310);near(r.z,-1);assert.equal(s.blocked,false);
});


test('3D debug displays the rotated body enclosure and legacy cap actually used by the query',{skip:'ARP-004I: post-1.1.5 physics retired; preserved in Git history'},()=>{
 const s=posedSystem();s.requestPose(Math.PI/2,false,300);s.debug3D=true;
 const d=new SpatialDebug({releaseDebug(){},drawDebug(){}},()=>0);d.prepare(s,300);
 assert.equal(d.groups[4].count,1536);assert.equal(d.data.byteLength,144000);assert.ok(d.count<=6000);
 const firstBox=(d.groups[4].first+104)*6;
 near(d.data[firstBox],-.296419*.168-.015);near(d.data[firstBox+2],.325*.168+.015);
 s.setEnabled(false);d.prepare(s,310);assert.equal(d.count,0);assert.equal(d.enabled,false);
});
