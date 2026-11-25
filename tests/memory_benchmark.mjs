// Optional desktop CPU benchmark: synthetic geometry, no Android/sensor claims.
import {SpatialMap,DepthProjector} from '../src/spatial-map.js';
import {SpatialRevalidator} from '../src/revalidation.js';
import {createDepthReader} from '../src/depth.js';
import {CollisionResolver} from '../src/collision.js';
import {I,perspective,tr} from '../src/math.js';

function stats(a){a.sort((x,y)=>x-y);return {n:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)};}
function timed(fn,n=200){const a=[];for(let i=0;i<n+20;i++){const t=performance.now();fn(i);if(i>=20)a.push(performance.now()-t);}return stats(a);}
const pose=tr(0,.35,0),projection=perspective(Math.PI/2,1),info={width:160,height:90,rawValueToMeters:.001,data:new Uint16Array(14400).fill(2000).buffer,normDepthBufferFromNormView:{matrix:I()}};
const projector=new DepthProjector();projector.configure(info,{projectionMatrix:projection,transform:{matrix:pose}});
const reader=createDepthReader(info,'luminance-alpha'),r=new SpatialRevalidator(),m=new SpatialMap(),volume={radius:.2,height:1.2,ground:0};
m.clear([0,0,0]);
for(let t=0;t<=2000;t+=125){m.begin(t,[0,0,0],1.2);for(let x=-10;x<=10;x++)for(let y=0;y<6;y++)m.observe(x*.12+.02,.08+y*.12,-2);}
let time=2000,maxQueries=0;
const directed=timed(()=>{time+=251;m.begin(time,[0,0,0],1.2);r.update(time,reader,projector,projection,m,[0,0,0],volume,0,-.55);maxQueries=Math.max(maxQueries,r.queries);});

global.gc?.();const heapBefore=process.memoryUsage().heapUsed;
const full=new SpatialMap();full.clear([0,0,0]);
for(let t=0;t<=2000;t+=125){full.begin(t,[0,0,0],1.2);let count=0;for(let x=-11;x<=12;x++)for(let z=-11;z<=11;z++)for(let y=0;y<8;y++)if(count++<4096)full.observe(x*.12+.02,.08+y*.12,z*.12+.02);}
for(let i=0;i<8192;i++)full.free.set(i,{key:i,time:2000,batch:0,hits:4}); // bounded synthetic free-evidence capacity fixture
global.gc?.();const heapAfter=process.memoryUsage().heapUsed;
const capacity={occupied:full.cells.size,free:full.free.size,heapDeltaBytes:heapAfter-heapBefore,heapMeasurement:global.gc?'process heap after explicit GC; approximate, not exact per-cell size':'process heap; GC not controlled'};
const solver=new CollisionResolver();
const query=timed(()=>solver.move(full,[1.8,0,0],-.01,0,volume,2100));
const maintenance=timed(i=>{full.lastMaintenance=-Infinity;full.maintain(2000+i*100);});
const saturation=timed(i=>{full.begin(2500+i*100,[0,0,0],1.2);for(let k=0;k<40;k++)full.observe(2.1+(k%4)*.12,.2+Math.floor(k/4)*.06,0);},100);
const evictionChecks=full.evictionChecks,evicted=full.evictedCount,rejected=full.rejectedCount;
const purge=[];for(let i=0;i<32;i++){const t=performance.now();full.maintain(50000+i*125);purge.push(performance.now()-t);}
console.log(JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,geometry:'SYNTHETIC known plane and 4096-cell capacity, no physical sensor'},directedRevalidation:{...directed,maxQueries,budget:r.budget},nearCapacityQuery:query,maintenance,saturation,capacity,evictionChecksPerBatch:evictionChecks,evicted,rejected,boundedExpiry:stats(purge),remaining:{occupied:full.cells.size,free:full.free.size}},null,2));
