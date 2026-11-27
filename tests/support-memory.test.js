import test from 'node:test';import assert from 'node:assert/strict';
import {SupportSurfaces} from '../src/support-surfaces.js';import {plane,combine,wall,observe} from './support-fixtures.mjs';
const boxTop=()=>plane({height:.3,minX:-.18,maxX:.18,minZ:-.18,maxZ:.18,spacing:.03});
function removalSequence({occluded=false,moved=false,replacement=false}={}){
 const s=new SupportSurfaces(()=>0);observe(s,boxTop());const ids=s.regions.filter(r=>r.active).map(r=>r.id);let first=null,complete=null;
 for(let i=0;i<140;i++){
  const time=3000+i*250,camera=[Math.sin(i*.9)*.15,1.2,Math.cos(i*.7)*.15];
  const data=moved&&i%2===0?plane({height:.3,minX:.3,maxX:.6,minZ:-.18,maxZ:.18,spacing:.03}):plane({height:occluded?.5:replacement?.1:0,...(moved?{minX:-.6,maxX:.6,spacing:.08}:{})});s.update(time,data,data.length/3,camera);
  if(s.invalidated)first??=time;if(!s.regions.some(r=>r.active&&ids.includes(r.id)))complete??=time;
 }
 return {s,ids,first,complete};
}
test('ARP-005A removed box clears from sufficient revisited rays before retention expiration',()=>{
 const r=removalSequence();assert.ok(r.first>=3750);assert.ok(r.complete!==null&&r.complete<45000);assert.equal(r.s.regions.filter(s=>s.active&&r.ids.includes(s.id)).length,0);
 console.log('SUPPORT_REMOVAL '+JSON.stringify({firstFreeMs:r.first,completeMs:r.complete,retentionMs:45000,invalidatedTiles:r.s.invalidated}));
});
test('ARP-005A foreground occlusion and missing depth do not remove remembered support',()=>{
 const r=removalSequence({occluded:true});assert.equal(r.first,null);assert.ok(r.s.regions.some(s=>s.active&&r.ids.includes(s.id)));
 const before=r.s.snapshot().regions;for(let i=0;i<10;i++)r.s.update(38000+i*250,new Float64Array(),0,[0,1.2,0]);assert.equal(r.s.snapshot().regions,before);assert.equal(r.s.invalidated,0);
});
test('ARP-005A revisited still-present support refreshes without height drift',()=>{
 const s=new SupportSurfaces(()=>0),p=boxTop();observe(s,p);const ids=s.regions.filter(r=>r.active).map(r=>r.id);
 observe(s,p,{start:15000,camera:[0,1.2,0]});assert.ok(s.regions.some(r=>r.active&&ids.includes(r.id)&&Math.abs(r.height-.3)<.002));assert.equal(s.invalidated,0);
});
test('ARP-005A lower replacement is represented independently and old height revalidates',()=>{
 const r=removalSequence({replacement:true});assert.ok(r.first!==null);assert.ok(r.s.regions.some(s=>s.active&&Math.abs(s.height-.1)<.003));
 assert.equal(r.s.regions.filter(s=>s.active&&r.ids.includes(s.id)).length,0);
});
test('ARP-005A moved chair/box is observed at its new location while former location revalidates',()=>{
 const r=removalSequence({moved:true});assert.ok(r.first!==null);assert.ok(r.s.invalidated>0);assert.ok(r.s.regions.some(s=>s.active&&s.x>.3&&Math.abs(s.height-.3)<.003));
});
test('ARP-005A consecutive steps and partially observed seat preserve observed limits',()=>{
 const s=new SupportSurfaces(()=>0),steps=combine(plane({height:.1,minX:-.48,maxX:-.18,spacing:.06}),plane({height:.15,minX:-.06,maxX:.18,spacing:.06}),plane({height:.3,minX:.3,maxX:.48,spacing:.06}));
 observe(s,steps,{frames:16});const heights=s.snapshot().summaries.map(r=>r.relativeHeight);assert.ok(heights.some(h=>Math.abs(h-.1)<.003));assert.ok(heights.some(h=>Math.abs(h-.15)<.003));assert.ok(heights.some(h=>Math.abs(h-.3)<.003));assert.equal(s.query({x:.24,z:0,radius:.015}).length,0);
 const seat=new SupportSurfaces(()=>0);observe(seat,plane({height:.45,minX:0,maxX:.3,minZ:0,maxZ:.3,spacing:.03}));assert.ok(seat.snapshot().confirmedRegions>0);assert.equal(seat.query({x:-.1,z:.1}).length,0);
});
test('ARP-005A straight/curved corners remain coverage limits without measured lower side evidence',()=>{
 const s=new SupportSurfaces(()=>0);observe(s,plane({height:.3,hole:(x,z)=>x*x+z*z>.3*.3}));const b=s.boundaries({x:.21,z:.1,radius:.16});assert.ok(b.length);assert.ok(b.every(e=>e.kind==='coverage-limit'));
 const p=new SupportSurfaces(()=>0);observe(p,plane({height:.3,minX:-.3,maxX:0,spacing:.03}));const b1=p.boundaries({x:-.03,z:0,radius:.09});assert.ok(b1.length);
 // Only after actual lower side heights are observed may a possible geometric edge appear.
 const side=wall({x:0,minY:.1,maxY:.3,spacing:.02,minZ:-.2,maxZ:.2}),points=combine(plane({height:.3,minX:-.3,maxX:0,minZ:-.2,maxZ:.2,spacing:.04}),side);
 observe(p,points,{start:3000,frames:12});assert.ok(p.boundaries({x:-.03,z:0,radius:.1}).every(e=>e.kind==='coverage-limit'),'mixed top/side evidence did not extend confirmed coverage to the edge');
 const qualified=new SupportSurfaces(()=>0);observe(qualified,plane({height:.3,minX:-.3,maxX:0,spacing:.03}));qualified.update(3000,side,side.length/3);
 const edges=qualified.boundaries({x:-.03,z:0,radius:.1}).filter(e=>e.kind==='possible-vertical-drop');assert.ok(edges.length);assert.ok(edges.every(e=>Math.abs(e.x)<.002&&e.uncertaintyRadius===.045));
});
test('ARP-005A budget overload defers perception without exceeding buffers or acquiring depth',()=>{
 let ticks=0;const s=new SupportSurfaces(()=>ticks++*.3),p=plane();s.update(1000,p,p.length/3);assert.ok(s.deferred>0);assert.ok(s.processed<=64);assert.ok(s.interval>250);assert.equal(s.points.length,432*3);assert.ok(s.snapshot().regions<=128);
});
