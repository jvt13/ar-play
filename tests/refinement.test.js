import {createDepthReader} from '../src/depth.js';
import {perspective,tr} from '../src/math.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {character} from '../src/engine.js';
import {I, ry} from '../src/math.js';
import {ARCollisions, characterVolume, CollisionResolver} from '../src/collision.js';
import {radiusAt} from '../src/volume.js';
import {SpatialMap} from '../src/spatial-map.js';

test('height cylinders conservatively contain animated geometry for three characters and headings (synthetic)',()=>{
  for(const id of ['bip','nori','luma']) for(const yaw of [0,.6,1.57]) {
    const v=characterVolume(id,1,0), size=.42;
    const collector={draw(kind,m){
      const a=m[0]**2+m[4]**2+m[8]**2,c=m[2]**2+m[6]**2+m[10]**2,b=m[0]*m[2]+m[4]*m[6]+m[8]*m[10];
      const r=(Math.hypot(m[12],m[14])+Math.sqrt((a+c+Math.sqrt((a-c)**2+4*b*b))/2))*size;
      const h=Math.hypot(m[1],m[5],m[9]);
      for(let j=0;j<12;j++) if((j+1)*v.height/12 >= (m[13]-h)*size && j*v.height/12 <= (m[13]+h)*size)
        assert.ok(v.profile[j]*size>=r-1e-6,`${id} bin ${j}`);
    }};
    for(const [w,d] of [[0,0],[1,0],[0,1],[1,1]]) for(let i=0;i<128;i++) character(collector,id,ry(yaw),i*Math.PI*2/128,w,d,0);
  }
});

test('contact positions improve for thin low/high obstacles without reducing the full-wall envelope (synthetic)',()=>{
  for(const id of ['bip','nori','luma']) for(const scale of [.63,1]) for(const axis of ['x','z']) {
    const v=characterVolume(id,scale,0), old={radius:v.radius,height:v.height,ground:0};
    let improvement=0;
    for(const height of [.065,v.height*.93]) {
      const map=new SpatialMap();map.clear([0,0,0]);
      for(const t of [0,125,250]){map.begin(t,[0,0,0],v.height);for(let q=-1;q<1;q+=.025) map.observe(axis==='x'?1:q,height,axis==='x'?q:-1);}
      const solver=new CollisionResolver();const dx=axis==='x'?2:0,dz=axis==='z'?-2:0;
      const before={...solver.move(map,[0,0,0],dx,dz,old,300)},after={...solver.move(map,[0,0,0],dx,dz,v,300)};
      const a=axis==='x'?after.x:-after.z,b=axis==='x'?before.x:-before.z;
      assert.ok(a>=b-1e-6); assert.ok(a<=1-radiusAt(v,height)+.001); improvement=Math.max(improvement,a-b);
      console.log(JSON.stringify({id,scale,axis,height,oldRadius:v.radius,localRadius:radiusAt(v,height),before:b,after:a}));
    }
    assert.ok(improvement>0,`${id} ${scale}`);
  }
});

test('adaptive recovery uses consecutive cheap updates and preserves slow-load safeguards (synthetic)',()=>{
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,-1]);s.setEnabled(true);
  const info={width:160,height:90,rawValueToMeters:.001,data:new Uint16Array(14400).fill(2000).buffer,normDepthBufferFromNormView:{matrix:I()}},view={projectionMatrix:perspective(Math.PI/2,1),transform:{matrix:tr(0,.35,0)}};
  s.interval=500;s.columns=16;s.rows=12;
  let time=0;
  for(let i=0;i<8;i++){time+=501;s.frame(time,true);s.accept(time,createDepthReader(info,'luminance-alpha'),info,view);}
  assert.equal(s.interval,400);
  for(let i=0;i<64;i++){time+=s.interval+1;s.frame(time,true);s.accept(time,createDepthReader(info,'luminance-alpha'),info,view);}
  assert.equal(s.interval,125);assert.equal(s.columns*s.rows,432);

});

test('last movement persists at rest, is bounded, excludes absolute maps, and clears on disable/reset/end',()=>{
  const s=new ARCollisions({}, {},()=>0);s.start('waiting');s.place([0,0,-1]);s.setEnabled(true);
  for(let i=0;i<50;i++){s.frame(i*300,true);s.move([0,0,-1],.01,0,i*300);}
  assert.equal(s.eventCount,32);s.setIntent(0,0,16000);s.frame(16000,true);
  assert.match(s.probeState(),/sem movimento/);assert.equal(s.eventCount,32);
  const text=s.diagnosticText();assert.ok(text.includes('actualX'));assert.ok(!text.includes('history'));
  s.setEnabled(false);assert.equal(s.eventCount,0);
  s.setEnabled(true);s.move([0,0,-1],.02,0,17000);s.clearReference();assert.equal(s.eventCount,0);
  s.stop();assert.equal(s.eventCount,0);
});
