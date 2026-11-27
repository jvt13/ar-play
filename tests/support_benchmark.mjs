// CPU desktop comparison; same native pixels/input and fixed reconstruction budgets.
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {SupportView} from '../src/support-view.js';import {SupportSurfaces} from '../src/support-surfaces.js';
import {depthScene} from './mapping-fixtures.mjs';import {plane} from './support-fixtures.mjs';
const stats=v=>{if(!v.length)return null;const a=[...v].sort((x,y)=>x-y);return {n:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)};};
const results=[],modes=['1.1.9','active','visual','unavailable'];if(process.env.BENCH_REVERSE==='1')modes.reverse();
for(const mode of modes){
 const directory=mode==='1.1.9'?process.argv[2]:'.',API=Object.assign({},...await Promise.all(['collision','depth','math'].map(n=>import(pathToFileURL(resolve(directory,`src/${n}.js`))))));
 for(const budget of [192,432]){
  const s=new API.ARCollisions({}, {},()=>performance.now()),p=[0,0,-.8],f=depthScene(API,{shape:'bed'}),view=mode==='1.1.9'?null:new SupportView({releaseDebug(){},drawDebug(){}},{},()=>performance.now());
  if(view){view.visual=mode==='visual';view.disabled=mode==='unavailable';s.archive.supportInfo=()=>view.snapshot();}
  s.start('waiting');s.place(p);s.setCharacter('bip',.81,p);s.setEnabled(true);s.columns=budget===192?16:24;s.rows=budget===192?12:18;s.interval=budget===192?333:125;s.adaptSpatial=()=>{};
  const values=Object.fromEntries(['reader','reconstruction','collisionQuery','movement','passiveObserver','surfaceUpdate','surfaceQuery','visualBuild','diagnosticExport','totalCpu'].map(k=>[k,[]]));let maxRegions=0,deferrals=0;
  for(let i=0;i<300;i++){
   const time=1000+i*s.interval,priorUpdate=view?.layer.updates,priorBuild=view?.buildUpdates;s.frame(time,true);s.setIntent(.3,0,time);let started=performance.now();const reader=API.createDepthReader(f.info,'float32'),readerMs=performance.now()-started;
   const total=performance.now();s.accept(time,reader,f.info,f.view);
   started=performance.now();s.field.penetration(.1,-.8,s.volume,time,s.resolver.skin);const query=performance.now()-started;
   started=performance.now();s.move(p,.005,0,time);const movement=performance.now()-started;
   started=performance.now();view?.update(s,time);const passive=performance.now()-started,elapsed=performance.now()-total;
   if(i>=60){const row={reader:readerMs,reconstruction:s.reconstructionMs,collisionQuery:query,movement,passiveObserver:passive,totalCpu:elapsed};
    if(view&&!view.disabled){if(view.layer.updates!==priorUpdate)row.surfaceUpdate=view.layer.updateMs;if(view.visual&&view.buildUpdates!==priorBuild)row.visualBuild=view.buildMs;view.layer.query({x:.55,z:-.8,radius:.15,time});row.surfaceQuery=view.layer.queryMs;maxRegions=Math.max(maxRegions,view.layer.regions.filter(r=>r.active).length);if(view.layer.updates!==priorUpdate&&view.layer.deferred)deferrals++;}
    for(const [key,value]of Object.entries(row))if(Number.isFinite(value))values[key].push(value);
   }
   if(i>=260){started=performance.now();s.exportText('manual-benchmark');values.diagnosticExport.push(performance.now()-started);}
  }
  results.push({mode,budget,maxRegions,deferrals,typedBytes:view?.layer.typedBytes??0,visualCpuBytes:view?.data.byteLength??0,metrics:Object.fromEntries(Object.entries(values).map(([key,a])=>[key,stats(a)]))});
 }
}
const geometry=[];
for(const options of [...[0,.05,.1,.15,.3,.6,.9].map(height=>({height})),{height:0,noise:.002},{height:.3,slopeX:.15,noise:.002}]){
 const {height,slopeX=0,noise=0}=options;
 const s=new SupportSurfaces(()=>0),p=plane(options);let confirmedAt=null;
 for(let i=0;i<12;i++){s.update(i*250,p,p.length/3);if(s.snapshot().confirmedRegions)confirmedAt??=i*250;}
 const regions=s.regions.filter(r=>r.active&&r.confirmedMask),q=s.query({x:0,z:0,radius:.4,includeCandidates:true});
 geometry.push({height,slopeX,noise,confirmedAtMs:confirmedAt,regions:regions.length,maxHeightError:Math.max(...regions.map(r=>Math.abs(r.height-height-slopeX*r.x))),maxInclineError:Math.max(...regions.map(r=>Math.abs(r.tilt-Math.atan(slopeX)*180/Math.PI))),observedArea:s.regions.reduce((sum,r)=>sum+(r.active?Array.from({length:16},(_,b)=>r.mask&(1<<b)?1:0).reduce((a,b)=>a+b,0)*.03**2:0),0),trueRectangleArea:.96**2,bounds:q.map(r=>r.observedBounds)});
}
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,warmup:60,samples:240,nativeDepth:'160x90 analytic buffer already acquired; device acquisition unavailable',visual:'CPU mesh preparation only here; real WebGL draw tested/measured in browser',claim:'No Android FPS or calibrated physical precision claim',allocation:'fixed typed-array footprint plus 128 preallocated region records; no heap profiler'},results,geometry},null,2));
