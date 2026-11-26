import test from 'node:test';import assert from 'node:assert/strict';
import * as collision from '../src/collision.js';import * as depth from '../src/depth.js';import * as math from '../src/math.js';
import {runMapping,depthScene} from './mapping-fixtures.mjs';import {observationSequence} from './mapping-memory.mjs';
const API={...collision,...depth,...math};
for(const id of ['bip','nori','luma'])for(const scale of [.4,.81,1])for(const shape of ['wall','bed'])test(`ARP-004J known ${shape}, ${id} ${scale}, sustained retreat`,()=>{
 const r=runMapping(API,{id,scale,shape,frames:400});assert.ok(r.rejected>0);
 const surface=shape==='wall'?.8:.45;assert.ok(Math.max(...r.trace.map(t=>t[1]))+r.system.volume.radius<surface+.005,'physical envelope cannot cross known surface');assert.ok(r.finalX<r.trace[259][1]-.6);
});
test('ARP-004J limited view, other angle, return, missing, revisit and removal preserve evidence policy',()=>{
 const r=observationSequence(API);console.log('OBSERVATION_SEQUENCE '+JSON.stringify({...r,trace:undefined}));
 assert.equal(r.partial,0,'unknown coverage is not fabricated into solid geometry');assert.ok(r.otherAngle>0);assert.ok(r.returned>=r.otherAngle);
 assert.equal(r.missing,r.consolidated,'unseen consolidated cells survive; short-lived candidates retain their original TTL');
 assert.ok(r.present>=r.missing);assert.ok(r.stopped<.15);assert.ok(r.incompleteRelease>0,'insufficient/grazing observations do not erase old geometry');
 assert.equal(r.released,0);assert.equal(r.allowed,.6);assert.ok(r.firstReleased>r.removedAt);assert.ok(r.allReleased-r.removedAt<30000,'valid revisited rays release before 45s expiration');
});
test('ARP-004J bounded refinement cannot promote one noisy native pixel',()=>{
 const s=new collision.ARCollisions({}, {},()=>0),p=[0,0,-.8],f=depthScene(API),data=new Float32Array(f.info.data);
 data[61*160+115]*=.85;s.start('waiting');s.place(p);s.setEnabled(true);
 for(let i=0;i<30;i++){s.frame(i*125,true);s.accept(i*125,depth.createDepthReader(f.info,'float32'),f.info,f.view);assert.ok(s.localQueries<=12);assert.equal(s.localAccepted,0);assert.equal(s.map.occupiedCount,0);}
 assert.equal(s.points.length,432*3);assert.equal(s.ground.labels.length,432);
});
test('ARP-004J critical noisy-floor and thin-object sequences repeat without temporal instability',()=>{
 for(let repeat=0;repeat<4;repeat++)for(const options of [{slope:.12,noise:.003,immediate:true},{id:'nori',scale:1,shape:'toy'},{id:'luma',scale:1,shape:'leg'}]){
   const r=runMapping(API,{...options,frames:600});if(options.slope){assert.ok(r.distance>2.8);assert.ok(r.maxStreak<15);}else{assert.ok(r.rejected>0);assert.ok(Math.max(...r.trace.map(t=>t[1]))<.5);assert.ok(r.finalX<-.6);}
 }
});
test('ARP-004J diagnostics distinguish current ground, movement-start overlap and blocking history without geometry',()=>{
 const r=runMapping(API,{shape:'bed'}),s=r.system,text=s.exportText('manual-export'),record=JSON.parse(text);
 assert.equal(record.ground.confidence,'anchored-temporal');assert.ok(record.ground.floorPoints>0);assert.ok(record.ground.obstaclePoints>0);
 assert.equal(record.state.placementMeasurement,'move-start');assert.ok('localQueries' in record.state);assert.ok(record.mapGeneration>=0);
 assert.ok(!text.includes('minX'));assert.ok(!text.includes('localPoints'));assert.ok(new TextEncoder().encode(text).length<=32000);
});
