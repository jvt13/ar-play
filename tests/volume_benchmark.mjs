// Historical experimental benchmark; not an acceptance benchmark for 1.1.8. Use stability_benchmark.mjs.
// Synthetic desktop CPU comparison. No physical sensor, calibration or Android FPS claim.
import {ARCollisions,characterVolume,CollisionResolver} from '../src/collision.js';
import {configurePose} from './experimental/volume.js';
import {SpatialMap} from '../src/spatial-map.js';
const stats=a=>{a.sort((x,y)=>x-y);return {n:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)}};
const timed=(fn,n=1000)=>{const a=[];for(let i=0;i<n+100;i++){const start=performance.now();fn(i);if(i>=100)a.push(performance.now()-start)}return stats(a)};
const map=new SpatialMap();map.clear([0,0,0]);for(let t=0;t<=2000;t+=125){map.begin(t,[0,0,0],1);for(let z=-1;z<1;z+=.03)for(let y=.07;y<.7;y+=.07)map.observe(.6,y,z)}
const queries={};for(const mode of ['legacy','oriented']){const v=characterVolume('bip',.66,0);if(mode==='oriented')configurePose(v,'bip',0);const r=new CollisionResolver();queries[mode]={free:timed(()=>r.move(map,[0,0,0],.01,0,v,2100)),blocked:timed(()=>r.move(map,[.42,0,0],.0275,0,v,2100)),tangent:timed(()=>r.move(map,[.42,0,0],0,.02,v,2100))};}
const s=new ARCollisions({}, {orientedVolume:true});s.start('waiting');s.place([0,0,0]);s.setCharacter('bip',.66,[0,0,0]);s.setEnabled(true);s.frame(2100,true);
const update=timed(i=>{s.setCharacter('bip',.66,[0,0,0]);s.requestPose(i%2?.3:0,false,2100+i)}),cached=timed(i=>{s.setCharacter('bip',.66,[0,0,0]);s.requestPose(s.poseYaw,false,4000+i)});
s.map=map;const occupiedPose=timed(i=>s.requestPose(i%2?1.2:0,false,7000+i));
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,geometry:'SYNTHETIC wall .6m; same fixtures per representation, poses may have different overlap'},volumeUpdate:update,cachedVolumeUpdate:cached,occupiedPose,queries,staticProfileNumbers:144,extraNumericProfilePayloadBytes:144*8,extraNativeXRBuffers:0},null,2));
