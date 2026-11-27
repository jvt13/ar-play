import test from 'node:test';import assert from 'node:assert/strict';
import {SupportSurfaces,SUPPORT_CONFIG} from '../src/support-surfaces.js';
import {plane,combine,wall,sphere,observe} from './support-fixtures.mjs';
for(const height of [0,.05,.1,.15,.3,.6,.9])test(`ARP-005A known horizontal support ${height}m`,()=>{
 const s=new SupportSurfaces(()=>0),stats=observe(s,plane({height})),regions=s.regions.filter(r=>r.active&&r.confirmedMask);
 assert.ok(regions.length>0,JSON.stringify(stats));assert.ok(regions.every(r=>Math.abs(r.height-height)<.002));assert.ok(regions.every(r=>r.tilt<.001));
 const query=s.query({x:0,z:0,radius:.2});assert.ok(query.length>0);assert.ok(query.every(r=>Math.abs(r.height-height)<.002));assert.ok(query.every(r=>r.unknownFraction>=0));
 console.log('SUPPORT_HEIGHT '+JSON.stringify({height,regions:regions.length,error:Math.max(...regions.map(r=>Math.abs(r.height-height))),area:stats.summaries.reduce((a,b)=>a+b.observedArea,0),independent:Math.min(...regions.map(r=>r.observations))}));
});
test('ARP-005A noise, incline and displaced support reference retain metric geometry',()=>{
 const s=new SupportSurfaces(()=>0),offset=[12,3,-8];s.reset(7,offset);
 const stats=observe(s,plane({height:.3,slopeX:.15,noise:.002,offset}));assert.ok(stats.confirmedRegions>0);
 const rows=s.regions.filter(r=>r.active&&r.confirmedMask);assert.ok(rows.every(r=>Math.abs(r.height-(3+.3+.15*(r.x-12)))<.006));assert.ok(rows.every(r=>Math.abs(r.tilt-Math.atan(.15)*180/Math.PI)<2));
 assert.ok(stats.summaries.some(r=>r.kind==='inclined'));assert.ok(stats.summaries.every(r=>r.generation===7));
 const reference=new SupportSurfaces(()=>0),length=Math.hypot(.15,1);reference.reset(8,[0,0,0],[-.15/length,1/length,0]);observe(reference,plane({slopeX:.15}));assert.ok(reference.snapshot().summaries.some(r=>r.kind==='reference-floor'&&r.inclination>8));
});
test('ARP-005A table and floor preserve two heights at the same X/Z',()=>{
 const s=new SupportSurfaces(()=>0);const lower=plane({spacing:.08}),upper=plane({height:.6,spacing:.08});
 for(let i=0;i<18;i++){const p=i%2?upper:lower;s.update(i*250,p,p.length/3);}
 const q=s.query({x:0,z:0,radius:.25,time:4250});assert.ok(q.some(r=>Math.abs(r.height)<.003));assert.ok(q.some(r=>Math.abs(r.height-.6)<.003));
 assert.ok(s.below(0,0,.3,.25,4250).every(r=>r.height<.3));assert.ok(s.above(0,0,.3,.25,4250).every(r=>r.height>.3));
});
test('ARP-005A gaps and partial coverage are never filled from bounds',()=>{
 const s=new SupportSurfaces(()=>0);observe(s,plane({height:.3,hole:(x,z)=>Math.abs(x)<.15}));
 assert.equal(s.query({x:0,z:0,radius:.06}).length,0);assert.equal(s.observedAt(0,0,.3),false);
 const sides=s.query({x:0,z:0,radius:.4});assert.ok(sides.length>0);assert.ok(sides.every(r=>r.unknownFraction>0));
 const edges=s.boundaries({x:.18,z:0,radius:.15});assert.ok(edges.length);assert.ok(edges.every(r=>r.kind==='coverage-limit'));
});
for(const [name,cloud]of [['wall',wall()],['side-face',wall({x:.1,maxY:.6})],['curved-ball',sphere()],['isolated',new Float64Array([0,.3,0,.5,.3,.5,-.5,.3,.5])],['line',plane({minX:0,maxX:0})]])test(`ARP-005A rejects/keeps uncertain ${name}`,()=>{
 const s=new SupportSurfaces(()=>0),stats=observe(s,cloud);assert.equal(stats.confirmedRegions,0,JSON.stringify(stats));assert.equal(s.query({x:0,z:0,radius:.3}).length,0);
});
test('ARP-005A narrow observed strip provides partial geometry, not walkability',()=>{
 const s=new SupportSurfaces(()=>0);const stats=observe(s,plane({height:.3,minX:-.06,maxX:.06,spacing:.03}));assert.ok(stats.confirmedRegions>0);
 const q=s.query({x:0,z:0,radius:.2});assert.ok(q.length);assert.ok(q.every(r=>!r.fullyObserved&&r.evidence.includes('not calibrated')));
});
test('ARP-005A candidate confirmation requires independent acquisitions; memory ages and clears',()=>{
 const s=new SupportSurfaces(()=>0),p=plane({height:.15});s.update(0,p,p.length/3);s.update(1,p,p.length/3);s.update(2,p,p.length/3);assert.equal(s.snapshot().confirmedRegions,0);
 observe(s,p,{start:250});assert.ok(s.snapshot().confirmedRegions>0);assert.ok(s.snapshot(7000).revalidatingRegions>0);
 assert.equal(s.snapshot(50000).regions,0);s.reset(9,[0,0,0]);assert.equal(s.snapshot().generation,9);assert.equal(s.snapshot().regions,0);
});
test('ARP-005A bounded storage, copy ownership and ambiguous two-centimetre levels',()=>{
 const s=new SupportSurfaces(()=>0),p=plane();observe(s,p);p.fill(999);assert.ok(s.points.every(v=>v<999));
 assert.ok(s.snapshot().regions<=SUPPORT_CONFIG.maxRegions);assert.ok(s.typedBytes<150000);assert.ok(s.snapshot().summaries.length<=8);
 const ambiguous=new SupportSurfaces(()=>0);const stats=observe(ambiguous,combine(plane({spacing:.08}),plane({height:.02,spacing:.08})));assert.equal(stats.confirmedRegions,0);
 assert.throws(()=>s.query({x:NaN,z:0}));assert.throws(()=>s.query({x:0,z:0,radius:1}));
});
test('ARP-005A underside and grazing views cannot confirm an upper support face',()=>{
 const p=plane({height:.6});for(const camera of [[0,.3,0],[0,.61,0]]){
  const s=new SupportSurfaces(()=>0);observe(s,p,{camera});assert.equal(s.snapshot().confirmedRegions,0);
 }
 const s=new SupportSurfaces(()=>0);observe(s,p,{camera:[0,1.2,0]});assert.ok(s.snapshot().confirmedRegions>0);
});
test('ARP-005A sparse plane remains zero-area candidate until actual coverage is acquired',()=>{
 const s=new SupportSurfaces(()=>0),p=new Float64Array([-.08,.6,-.15,0,.6,-.15,.08,.6,-.15,-.08,.6,.15,0,.6,.15,.08,.6,.15]);observe(s,p);
 assert.ok(s.snapshot().candidateRegions>0);assert.equal(s.snapshot().confirmedRegions,0);assert.ok(s.snapshot().summaries.every(r=>r.pointOnly&&r.observedArea===0));
 assert.equal(s.query({x:0,z:0,radius:.25}).length,0);const candidates=s.query({x:0,z:0,radius:.25,includeCandidates:true});assert.ok(candidates.length);assert.ok(candidates.every(r=>r.coverage===0&&!r.fullyObserved));
 observe(s,plane({height:.6}),{start:3000});assert.ok(s.snapshot().confirmedRegions>0);
 s.reset(2,[0,0,0]);assert.equal(s.sampleCount,0);assert.ok(s.points.every(v=>v===0));assert.ok(s.regions.every(r=>!r.active&&r.pinX===0&&r.pinY===0&&r.pinZ===0&&r.c===0));assert.equal(s.fit.c,0);
});
test('ARP-005A area query detects unknown tiles missed by a centre/coarse sample test',()=>{
 const s=new SupportSurfaces(()=>0),fit={a:0,b:0,c:.3,nx:0,ny:1,nz:0,tilt:0,residual:0,samples:6};
 // Overlapping measured triangles (edges <=18cm) wholly cover the queried subregions.
 // Merely splitting a square along a diagonal would leave diagonal tiles uncertain.
 for(const t of [0,250,500]){s.time=t;s.triangle(-.03,-.03,.09,-.03,-.03,.09,fit);s.triangle(.09,.09,-.03,.09,.09,-.03,fit);s.triangle(.09,-.03,.09,.09,-.03,-.03,fit);s.triangle(-.03,.09,-.03,-.03,.09,.09,fit);}
 let q=s.query({x:.03,z:.03,radius:.025,time:500});assert.equal(q.length,1);assert.equal(q[0].fullyObserved,true);
 const r=s.regions.find(r=>r.active&&r.ix===0&&r.iz===0);r.mask&=~1;r.confirmedMask&=~1;
 q=s.query({x:.03,z:.03,radius:.025,time:500});assert.equal(q[0].centerObserved,true);assert.equal(q[0].fullyObserved,false);assert.ok(q[0].unknownFraction>0);
 assert.ok(q[0].observedBounds.minX>=0&&q[0].observedBounds.maxX<=.09+1e-9);
});
test('ARP-005A result limit preserves the nearest levels above/below and reports truncation',()=>{
 const s=new SupportSurfaces(()=>0);for(const t of [0,250,500]){s.time=t;for(let i=1;i<=40;i++){const fit={a:0,b:0,c:i*.03,nx:0,ny:1,nz:0,tilt:0,residual:0,samples:6};s.triangle(0,0,.12,0,.12,.12,fit);}}
 const below=s.below(.075,.015,2),above=s.above(.075,.015,0);assert.equal(below.length,32);assert.equal(above.length,32);assert.ok(Math.abs(below[0].height-1.2)<1e-9);assert.ok(Math.abs(above[0].height-.03)<1e-9);assert.equal(below[0].moreAvailable,true);
 assert.throws(()=>s.below(0,0,NaN));
});
for(const gap of [.06,.12,.24])test(`ARP-005A measured ${gap}m gap is not bridged by a plane fit`,()=>{
 const s=new SupportSurfaces(()=>0);observe(s,plane({height:.3,minX:-.24,maxX:.24,minZ:-.24,maxZ:.24,spacing:.03,hole:x=>Math.abs(x)<gap/2}));
 assert.ok(s.snapshot().confirmedRegions>0);assert.equal(s.observedAt(0,0,.3),false);assert.equal(s.query({x:0,z:0,radius:.01}).length,0);
});
