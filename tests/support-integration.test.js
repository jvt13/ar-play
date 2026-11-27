import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import * as collision from '../src/collision.js';import * as depth from '../src/depth.js';import * as math from '../src/math.js';
import {SupportView} from '../src/support-view.js';import {DiagnosticArchive} from '../src/diagnostics.js';import {BUILD} from '../src/build.js';
import {runChain} from './chain-fixtures.mjs';import {plane,observe} from './support-fixtures.mjs';
import {depthScene} from './mapping-fixtures.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/chain-v119.json',import.meta.url),'utf8'));
const engine=()=>({releaseDebug(){},drawDebug(){}});
for(const expected of baseline.results)test(`ARP-005A passive integration equals stable 1.1.9, ${expected.scenario} / ${expected.scale}`,()=>{
 for(const mode of ['active','visual','unavailable']){
  let layer;
  class ObservedController extends collision.ARCollisions{
   constructor(...args){super(...args);this.observer=new SupportView(engine(),{},()=>0);this.observer.visual=mode==='visual';this.observer.disabled=mode==='unavailable';layer=this.observer;}
   move(position,dx,dz,time){const result=super.move(position,dx,dz,time);this.observer.update(this,time);if(mode==='visual')this.observer.draw();return result;}
  }
  const result=runChain({...collision,...depth,...math,ARCollisions:ObservedController},expected);
  assert.equal(createHash('sha256').update(JSON.stringify(result.trace)).digest('hex'),expected.traceSha256,mode+': all 400 positions, occupancy/probe counts, rejections and releases must be identical');
  assert.equal(result.distance,expected.distance);assert.equal(result.maxStreak,expected.maxStreak);
  if(expected.scenario==='floor'&&mode!=='unavailable')assert.ok(layer.layer.snapshot().confirmedRegions>0,'actual reconstructed ground is available before occupancy filtering');
 }
});
test('ARP-005A adapter copies data, resets with generations/sessions and fails independently',()=>{
 const source=new collision.ARCollisions({}, {},()=>0);source.start('waiting');source.place([0,0,0]);source.setEnabled(true);
 const view=new SupportView(engine(),{},()=>0),p=plane({height:.6});source.points.set(p.subarray(0,source.points.length));source.used=Math.min(432,p.length/3);source.lastSample=1000;source.projector.pose.set(math.tr(0,1.2,0));
 const copy=new Float32Array(source.points);for(let t=1000;t<2000;t+=250){source.lastSample=t;view.update(source,t);}assert.deepEqual(source.points,copy);assert.ok(view.layer.snapshot().confirmedRegions>0);
 source.place([1,0,0]);view.update(source,2100);assert.equal(view.layer.snapshot().regions,0);assert.equal(view.layer.generation,source.mapGeneration);
 view.layer.update=()=>{throw Error('perception failure')};source.lastSample=2400;view.update(source,2400);assert.equal(view.disabled,true);assert.ok(source.move([1,0,0],.2,0,2400).x>1.19);
 view.stop();assert.equal(view.layer.snapshot().regions,0);assert.equal(view.visual,false);
 const gpu=new SupportView({releaseDebug(){},drawDebug(){throw Error('optional visual failure');}},{},()=>0);gpu.visual=true;gpu.count=6;assert.doesNotThrow(()=>gpu.draw());assert.equal(gpu.disabled,true);
 const mesh=new SupportView(engine(),{},()=>0);mesh.layer.reset(4,[10,2,20]);observe(mesh.layer,plane({height:.3,offset:[10,2,20]}));mesh.build(2750);assert.ok(mesh.count>0&&mesh.count<=3072);
 const world=new Float32Array(mesh.data);mesh.camera.set([100,10,-50]);mesh.build(2750);assert.deepEqual(mesh.data,world,'world vertices remain independent of the viewing camera');
 for(let i=0;i<mesh.count;i++)assert.ok(Math.abs(mesh.data[i*6+1]-2.302)<1e-5);
});
test('ARP-005A bounded anonymous archive contains support summaries without absolute geometry',()=>{
 const archive=new DiagnosticArchive(()=>4000),view=new SupportView(engine(),{},()=>0);view.layer.reset(3,[1234,5,6789]);observe(view.layer,plane({height:.6,offset:[1234,5,6789]}));archive.supportInfo=()=>view.snapshot();
 archive.capture(archive.begin(),0,'manual-export',[],null,{});const text=archive.text(),record=JSON.parse(text);assert.ok(record.supports.confirmedRegions>0);assert.ok(record.supports.summaries.some(r=>Math.abs(r.relativeHeight-.6)<.003));
 for(const key of ['1234','6789','observedBounds','points','minX','origin','normal'])assert.ok(!text.includes(key),key);
 assert.ok(record.supports.summaries.length<=8);assert.ok(new TextEncoder().encode(text).length<=32000);assert.equal(record.version,BUILD.version);
 archive.supportInfo=()=>{throw Error('provider failure')};archive.capture(archive.last.session,0,'manual-export',[],null,{});assert.equal(archive.last.supports.state,'unavailable');
});
test('ARP-005A prerelease identity is shared by package, runtime and cache',()=>{
 const packageInfo=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.equal(BUILD.version,'1.2.0-alpha.1');assert.equal(packageInfo.version,BUILD.version);assert.equal(BUILD.cache,'ar-play-v'+BUILD.version+'-r2');assert.match(BUILD.revision,/^arp005a-.*-r2$/);
});
test('ARP-005A native floor/5cm support uses non-occupied samples and preserves stable occupancies',()=>{
 const nativeBaseline=JSON.parse(readFileSync(new URL('./fixtures/support-native-v119.json',import.meta.url),'utf8'));
 const API={...collision,...depth,...math};for(const expected of nativeBaseline.results){const options=expected.options;
  const s=new collision.ARCollisions({}, {},()=>0),view=new SupportView(engine(),{},()=>0),p=[0,0,-.8],f=depthScene(API,options);s.start('waiting');s.place(p);s.setEnabled(true);s.columns=16;s.rows=12;s.interval=333;s.adaptSpatial=()=>{};
  for(let i=0;i<40;i++){const t=1000+i*333;s.frame(t,true);s.accept(t,depth.createDepthReader(f.info,'float32'),f.info,f.view);s.move(p,0,0,t);view.update(s,t);}
  const stats=view.snapshot();assert.equal(s.map.occupiedCount,expected.occupied);assert.equal(s.used,expected.used);assert.deepEqual(p,expected.position);assert.ok(stats.confirmedRegions>0);assert.ok(stats.summaries.some(v=>Math.abs(v.relativeHeight-(options.height||0))<.02));
  let supportOutsideOccupancy=false;for(const r of view.layer.regions)if(r.active)for(let bit=0;bit<16;bit++)if(r.confirmedMask&(1<<bit)){const x=view.layer.origin[0]+r.ix*.12+(bit%4+.5)*.03,z=view.layer.origin[2]+r.iz*.12+(Math.floor(bit/4)+.5)*.03;if(s.map.stateAt(x,r.a*x+r.b*z+r.c,z,13987)!=='occupied')supportOutsideOccupancy=true;}
  assert.equal(supportOutsideOccupancy,true,'support includes reconstructed samples not stored as occupied voxels');
 }
});
test('ARP-005A unavailable perception still ages and expires its retained supports',()=>{
 const s=new collision.ARCollisions({}, {},()=>0),view=new SupportView(engine(),{},()=>0),p=plane({height:.3});s.start('waiting');s.place([0,0,0]);s.setEnabled(true);s.projector.pose.set(math.tr(0,1.2,0));s.points.set(p);s.used=p.length/3;
 for(let i=0;i<4;i++){s.lastSample=1000+i*250;view.update(s,s.lastSample);}assert.ok(view.snapshot().confirmedRegions>0);
 view.disabled=true;view.update(s,50000);assert.equal(view.snapshot().regions,0,'unavailability must not freeze the 45-second retention clock');assert.equal(view.snapshot().state,'unavailable');assert.ok(s.move([0,0,0],.2,0,50000).x>.19);
});
