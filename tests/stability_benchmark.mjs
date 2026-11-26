// Desktop CPU microbenchmarks, identical geometry/call schedule per commit.
// node tests/stability_benchmark.mjs reports/v115 reports/v117
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {setup} from './collision-sequences.mjs';
const versions = [['1.1.5',process.argv[2],false],['1.1.7',process.argv[3],false],['1.1.8-candidate','.',false]];
function stats(values) {
  const a = values.toSorted ? values.toSorted((a,b)=>a-b) : [...values].sort((a,b)=>a-b);
  return {n:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)};
}
function timed(fn, before = () => {}, n = 240) {
  const values = [];
  for (let i = 0; i < n+30; i++) { before(i); const t=performance.now(); fn(i); const elapsed=performance.now()-t; if(i>=30)values.push(elapsed); }
  return stats(values);
}
const results = [];
for (const [version, directory, oriented] of versions) {
  if (!directory) throw Error('Pass historical snapshot directories');
  const modules=await Promise.all(['collision','spatial-map','depth','revalidation','math'].map(name=>import(pathToFileURL(resolve(directory,`src/${name}.js`)))));
  const API=Object.assign({},...modules), s=setup(API,.81,'wall',oriented,()=>performance.now()), p=[.55,0,0];
  s.setCharacter('bip',.81,p);s.frame(2100,true);
  const volumeUpdate=timed(()=>s.setCharacter('bip',.81,p));
  const poseValidation=timed(i=>{if(s.requestPose)s.requestPose(i%2?Math.PI/2:0,false,2500+i*130);else s.poseYaw=i%2?Math.PI/2:0;});
  const movementResolution=timed(()=>s.resolver.move(s.field,p,.01,.005,s.volume,2200));
  const collisionQuery=timed(()=>s.field.penetration(.55,0,s.volume,2200,s.resolver.skin));
  const projection=API.perspective(Math.PI/2,1), pose=API.tr(0,.35,0);
  const info={width:160,height:90,rawValueToMeters:.001,data:new Uint16Array(14400).fill(2000).buffer,normDepthBufferFromNormView:{matrix:API.I()}};
  const view={projectionMatrix:projection,transform:{matrix:pose}},reader=API.createDepthReader(info,'luminance-alpha');
  s.projector.configure(info,view);
  const immediateProbe=timed(i=>s.probe.update(2300+i*66,reader,s.projector,projection,[0,0,-1.4],s.volume,0,-.55,s.map));
  const reconstruction=[], revalidation=[];
  const rebuild=setup(API,.81,'free',oriented,()=>performance.now());rebuild.frame(2100,true);
  for(let i=0;i<270;i++) {
    const t=2200+i*125;
    rebuild.lastSample=-Infinity;rebuild.frame(t,true);rebuild.accept(t,reader,info,view);
    if(i>=30) {reconstruction.push(rebuild.reconstructionMs);revalidation.push(rebuild.revalidator.costMs);}
  }
  results.push({version,volumeUpdate,poseValidation,movementResolution,collisionQuery,immediateProbe,reconstruction:stats(reconstruction),revalidation:stats(revalidation)});
}
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,scale:.81,geometry:'synthetic wall; identical fixed starting pose and input; same circular profile, initial position and inputs in all versions',warmup:30,samples:240,poseNote:'All compared circular headings are invariant and require no spatial validation',reconstructionNote:'controller reconstructionMs and revalidator.costMs from repeated full acquisitions; native acquisition not simulated as CPU work',claim:'desktop CPU only; no Android FPS or physical calibration claim'},results},null,2));
