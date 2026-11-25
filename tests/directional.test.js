import {cameraXZ} from '../src/math.js';
// SYNTHETIC geometry, independent expected coordinates; no physical XR measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DepthProjector, SpatialMap} from '../src/spatial-map.js';
import {ARCollisions, CollisionResolver} from '../src/collision.js';
import {createDepthReader} from '../src/depth.js';
import {character} from '../src/engine.js';

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const projection=[1,0,0,0,0,2,0,0,.2,-.2,-1.01,-1,0,0,-.1,0];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const volume={radius:.2,height:.7,ground:0};
function wall(map,x,z,axis) { for(let v=-1;v<=1;v+=.04)for(let y=.15;y<.6;y+=.12)map.observe(axis==='x'?x:v,y,axis==='z'?z:v); }
function confirmed(shape){const m=new SpatialMap();m.clear([0,0,0]);for(const t of [0,125,250]){m.begin(t,[0,0,0],1);shape(m);}return m;}

test('independent asymmetric ray, buffer flip and rotated translated camera agree with known world point',()=>{
  const pose=[0,0,-1,0,0,1,0,0,1,0,0,0,1,2,3,1]; // +90 degrees about Y, camera at (1,2,3).
  const bufferTransform=[-1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1];
  const info={width:2,height:2,rawValueToMeters:.001,data:new Uint16Array([2000,4000,6000,8000]).buffer,normDepthBufferFromNormView:{matrix:bufferTransform}};
  const reader=createDepthReader(info,'luminance-alpha'),p=new DepthProjector(),out=new Float64Array(3);
  assert.ok(p.configure(info,{projectionMatrix:projection,transform:{matrix:pose}}));
  const depth=reader.at(.75,.25,true);near(depth,2);
  p.point(.75,.25,depth,out);
  // Camera point (1.4,.3,-2): x=(.5+.2)*2, y=(.5-.2)*2/2.
  near(out[0],-1);near(out[1],2.3);near(out[2],1.6);
  // Reprojection calculated directly: R^T*(world-camera), then perspective divide.
  const cx=-(out[2]-3),cy=out[1]-2,cz=out[0]-1;
  near(((cx+.2*cz)/-cz+1)/2,.75);near((1-(2*cy-.2*cz)/-cz)/2,.25);
});

test('new depth view metadata must not silently accept an unaligned sensor',()=>{
  const other=[...identity];other[12]=.2;
  const p=new DepthProjector();
  assert.equal(p.configure({view:{projectionMatrix:projection,transform:{matrix:other}}},{projectionMatrix:projection,transform:{matrix:identity}}),false);
  assert.equal(p.configure({view:{projectionMatrix:projection,transform:{matrix:identity}}},{projectionMatrix:projection,transform:{matrix:identity}}),true);
});

test('independent downward pitch reconstructs axial depth without assuming a perpendicular camera',()=>{
  const c=Math.SQRT1_2,pose=[1,0,0,0,0,c,-c,0,0,c,c,0,0,1.5,2,1];
  const p=[...projection];p[8]=p[9]=0;
  const projector=new DepthProjector(),point=new Float64Array(3);
  assert.ok(projector.configure({},{projectionMatrix:p,transform:{matrix:pose}}));
  projector.point(.5,.5,2,point);
  near(point[0],0);near(point[1],1.5-Math.SQRT2);near(point[2],2-Math.SQRT2);
  projector.point(.5,.5,1.5/c,point);near(point[1],0);near(point[2],.5);
});

test('existing joystick and sensing formulas agree at cardinal yaw and positive/negative pitch',()=>{
  const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const line=source.split('\n').find(s=>s.startsWith('function senseIntent('));
  const run=new Function('move','keys','lastView','placed','collisions','t','cameraXZ','spatialMotion',line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
  const cases=[[1,0,0,-1],[0,-1,-1,0],[-1,0,0,1],[0,1,1,0]];
  for(const [a,b,fx,fz] of cases) for(const pitch of [-.6,0,.6]) for(const [x,z] of [[0,-1],[0,1],[1,0],[-1,0],[1,-1]]) {
    const cp=Math.cos(pitch),sp=Math.sin(pitch);const pose=[a,0,b,0,-b*sp,cp,a*sp,0,-b*cp,-sp,a*cp,0,0,1.5,0,1];let received;
    run([x,z],new Set(),pose,true,{setIntent:(dx,dz)=>{received=[dx,dz]}},10,cameraXZ,new Float64Array(2));
    const n=Math.max(1,Math.hypot(x,z));near(received[0],(a*x-b*z)/n*.55);near(received[1],(b*x+a*z)/n*.55);
    if(!x&&z===-1){near(received[0],fx*.55);near(received[1],fz*.55);}
  }
});

test('walls in four directions reject inward movement and permit retreat and tangent',()=>{
  for(const [axis,sign] of [['x',1],['x',-1],['z',1],['z',-1]]) {
    const m=confirmed(m=>wall(m,sign*.6,sign*.6,axis)),solver=new CollisionResolver();
    const r={...solver.move(m,[0,0,0],axis==='x'?sign:0,axis==='z'?sign:0,volume,300)};
    assert.ok(r.blocked);const p=[r.x,0,r.z];
    const back={...solver.move(m,p,axis==='x'?-sign*.1:0,axis==='z'?-sign*.1:0,volume,310)};
    assert.equal(back.blocked,false);
    const side=solver.move(m,p,axis==='z'?.1:0,axis==='x'?.1:0,volume,320);assert.equal(side.blocked,false);
  }
});

test('a decreasing map maximum must not hide increasing immediate-probe penetration',()=>{
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);
  s.volume={...volume};s.map=confirmed(m=>wall(m,-.1,0,'x'));
  s.field.config=s.map.config;
  // A real derived segment representation: wall on the right, already lightly overlapping.
  s.probe.count=1;s.probe.history.set([.19,.3,0,250,0,1,.5]);
  const r=s.move([0,0,0],.04,0,300);
  assert.ok(r.x<=1e-6,`advanced into right obstacle: ${r.x}`);
});

test('a decreasing maximum must not hide another occupied cell on the opposite side',()=>{
  const m=confirmed(m=>{wall(m,-.1,0,'x');wall(m,.19,0,'x');});
  const r=new CollisionResolver().move(m,[0,0,0],.04,0,volume,300);
  assert.ok(r.x<=1e-6,`advanced into right obstacle: ${r.x}`);
});

test('resting rendered feet remain at translated logical support at 63 and 100 percent',()=>{
  for(const id of ['bip','nori','luma'])for(const scale of [.63,1]) {
    const size=.42*scale,ground=-1.4,root=[size,0,0,0,0,size,0,0,0,0,size,0,1,ground,-2,1];let base=Infinity;
    character({draw(_kind,m){base=Math.min(base,m[13]-Math.hypot(m[1],m[5],m[9]));}},id,root,0,0,0,0);
    near(base,ground);near(ground+.003-base,.003);
  }
});

test('initial overlap escape cannot cross a second previously untouched wall',()=>{
  const m=confirmed(m=>{
    for(let x=.6;x<1.5;x+=.04)for(let z=-.8;z<.8;z+=.04)m.observe(x,.3,z);
    wall(m,.25,0,'x');
  });
  const r=new CollisionResolver().move(m,[.78,0,0],-1,0,volume,300);
  assert.ok(r.x>=.25+volume.radius,`crossed second wall: ${r.x}`);
  assert.ok(r.x<=.78);assert.ok(r.blocked);
});

test('last significant block survives free movement and retains actual vectors/support',()=>{
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,-1.4,0]);s.setCharacter('bip',1,[0,-1.4,0]);s.setEnabled(true);
  for(const t of [0,125,250]){s.map.begin(t,[0,-1.4,0],s.volume.height);for(let z=-1;z<1;z+=.04)s.map.observe(.6,-1.1,z);}
  s.frame(300,true);s.setInput(1,0);s.setIntent(.55,0,300);s.move([0,-1.4,0],1,0,300);
  assert.ok(s.lastBlockAvailable);const saved={...s.lastBlock};
  near(saved.rawX,1);near(saved.transformedX,.55);near(saved.supportY,-1.4);near(saved.wantedX,1);
  assert.ok(saved.finalX<.6);assert.ok(saved.penetrationBefore===0);assert.ok(saved.rejection);
  s.noteRendered(-1.4,-1.397,0);
  s.frame(600,true);s.setInput(-1,0);s.setIntent(-.55,0,600);s.move([saved.finalX,-1.4,0],-.1,0,600);
  assert.equal(s.blocked,false);near(s.lastBlock.time,300);near(s.lastBlock.finalX,saved.finalX);
  const copied=JSON.parse(s.diagnosticText());assert.equal(copied.lastBlock.ageMs,300);
  assert.equal(copied.lastBlock.probeDirectionX,null); // No sensor reading was acquired in this fixture.
  s.setEnabled(false);assert.equal(s.lastBlockAvailable,false);
});

test('overlap from all sides blocks inward and diagonal penetration while allowing outward/tangent',()=>{
  for(const [axis,sign] of [['x',1],['x',-1],['z',1],['z',-1]]){
    const map=confirmed(m=>wall(m,sign*.6,sign*.6,axis)),solver=new CollisionResolver(),p=axis==='x'?[sign*.55,0,0]:[0,0,sign*.55];
    const forward={...solver.move(map,p,axis==='x'?sign*.05:0,axis==='z'?sign*.05:0,volume,300)};
    near(axis==='x'?forward.x:forward.z,axis==='x'?p[0]:p[2]);
    const back={...solver.move(map,p,axis==='x'?-sign*.1:0,axis==='z'?-sign*.1:0,volume,310)};
    near(axis==='x'?back.x:back.z,sign*.45);
    const diagonal={...solver.move(map,p,axis==='x'?sign*.1:.1,axis==='z'?sign*.1:.1,volume,320)};
    near(axis==='x'?diagonal.x:diagonal.z,sign*.55);near(axis==='x'?diagonal.z:diagonal.x,.1);
  }
});

test('measured inclined wall permits tangential motion during initial overlap',()=>{
  const map=confirmed(m=>{for(let z=-1;z<1;z+=.02)for(let y=.2;y<.6;y+=.12)m.observe(.8-z,y,z);});
  const r=new CollisionResolver().move(map,[.35,0,.35],.08,-.08,volume,300);
  near(r.x,.43);near(r.z,.27);
});

test('support-plane diagnosis exposes horizontal-motion separation without changing body height',()=>{
  const s=new ARCollisions({}, {},()=>0),support=[...identity],n=Math.hypot(.1,1);
  support[4]=.1/n;support[5]=1/n;
  s.start('waiting');s.place([0,-1.4,0],support);s.setCharacter('bip',.63,[1,-1.4,0]);
  s.noteRendered(-1.4,-1.397,0);
  const state=s.snapshot();near(state.supportY,-1.4);near(state.supportPlaneYAtCharacter,-1.5);near(state.baseVsSupportPlane,.1);
  near(s.position[1],-1.4);near(state.renderedBase,-1.4);
});

test('overlapping centre cannot cross a measured plane between substep endpoints',()=>{
  const map=confirmed(m=>wall(m,.6,0,'x')),solver=new CollisionResolver();
  for(const dx of [.04,.8]){
    const r=solver.move(map,[.59,0,0],dx,0,volume,300);
    assert.ok(r.x<=.59+1e-6,`crossed plane during initial overlap: ${r.x}`);
  }
  const pointMap=confirmed(m=>m.observe(.6,.3,0));
  const p=solver.move(pointMap,[.59,0,0],.04,0,volume,300);assert.ok(p.x<=.59+1e-6,`crossed measured map point: ${p.x}`);
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.volume={...volume};
  s.probe.count=1;s.probe.history.set([.6,.3,0,250,0,1,.5]);
  const r=s.move([.59,0,0],.04,0,300);assert.ok(r.x<=.59+1e-6,`crossed probe segment: ${r.x}`);
  s.probe.history.set([.6,.3,0,250,0,0,0]);
  const point=s.move([.59,0,0],.04,0,300);assert.ok(point.x<=.59+1e-6,`crossed point contact: ${point.x}`);
});
