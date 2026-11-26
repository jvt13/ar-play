// Desktop CPU only. Identical native pixels, poses, fixed budgets and schedules.
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {depthScene} from './mapping-fixtures.mjs';
const stats=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return {n:b.length,medianMs:b[Math.floor(b.length*.5)],p95Ms:b[Math.floor(b.length*.95)],maxMs:b.at(-1)};};
const results=[],versions=[['1.1.8',process.argv[2]],['1.1.9','.']];
if(process.env.BENCH_REVERSE==='1')versions.reverse();
for(const [version,directory] of versions){
 const API=Object.assign({},...await Promise.all(['collision','depth','math'].map(n=>import(pathToFileURL(resolve(directory,`src/${n}.js`))))));
 for(const budget of [192,432])for(const shape of ['floor','bed']){
  const s=new API.ARCollisions({}, {},()=>performance.now()),p=[0,0,-.8],f=depthScene(API,{shape,slope:shape==='floor'?.12:0});
  s.start('waiting');s.place(p);s.setCharacter('bip',.81,p);s.setEnabled(true);s.columns=budget===192?16:24;s.rows=budget===192?12:18;s.interval=budget===192?333:125;s.adaptSpatial=()=>{};
  const values=Object.fromEntries(['reader','reconstruction','pointReconstruction','floorClassification','mapUpdate','revalidation','collisionQuery','probe','movementResolution','diagnosticExport','localRefinement'].map(k=>[k,[]]));
  let maxCells=0,maxLocalQueries=0;
  for(let i=0;i<300;i++){
   const time=1000+i*s.interval;s.frame(time,true);s.setIntent(.3,0,time);s.revalidator.budget=8;
   let started=performance.now();const reader=API.createDepthReader(f.info,'float32'),readerMs=performance.now()-started;
   s.accept(time,reader,f.info,f.view);maxCells=Math.max(maxCells,s.map.cells.size);maxLocalQueries=Math.max(maxLocalQueries,s.localQueries||0);
   started=performance.now();s.field.penetration(.12,-.8,s.volume,time,s.resolver.skin);const query=performance.now()-started;
   started=performance.now();s.resolver.move(s.field,p,.005,.003,s.volume,time);const movement=performance.now()-started;
   if(i>=60){const row={reader:readerMs,reconstruction:s.reconstructionMs,pointReconstruction:s.pointReconstructionMs,floorClassification:s.ground?.costMs,mapUpdate:s.mapUpdateMs,revalidation:s.revalidator.costMs,collisionQuery:query,probe:s.probe.costMs,movementResolution:movement};for(const [key,value]of Object.entries(row))if(Number.isFinite(value))values[key].push(value);}
   if(i>=260){started=performance.now();s.exportText('manual-benchmark');values.diagnosticExport.push(performance.now()-started);}
  }
  // Local refinement is included in pointReconstruction; report its bounded incremental
  // cost via the same workload comparison rather than timing inside each native query.
  delete values.localRefinement;
  results.push({version,budget,shape,maxCells,maxLocalQueries,extraFixedBytes:s.ground?s.ground.snapshot().bytes+s.localPoints.byteLength+s.localIds.byteLength:0,metrics:Object.fromEntries(Object.entries(values).map(([key,a])=>[key,stats(a)]))});
 }
}
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,warmup:60,samples:240,nativeDepth:'160x90 analytic, already acquired; device getDepthInformation cost cannot be measured here',allocation:'reused fixed ground/auxiliary typed arrays; reader object/view once per sampled frame as before; no heap-allocation profiler used',localRefinement:'<=12 extra reads, within reconstruction; no global grid/frequency increase',claim:'desktop CPU only; no Android FPS claim'},results},null,2));
