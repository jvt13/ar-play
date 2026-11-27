// Passive geometric evidence, metres / milliseconds / degrees. No physical decisions.
// Inputs are owned reconstructed world points, never XRFrame/depth/camera objects.
export const SUPPORT_CONFIG=Object.freeze({cellSize:.12,subdivisions:4,maxSamples:432,maxSeeds:64,maxNeighbors:32,maxRegions:128,maxQueryResults:32,maxExport:8,neighborhood:.36,maxTriangleEdge:.18,planeError:.012,maxTilt:25,mergeHeight:.015,independentMs:100,confirmations:3,candidateTtl:5000,retentionMs:45000,revalidateAfter:1500,freeVotes:4,freeSpan:300,holdMs:750,intervalMs:250,budgetMs:2});
const popcount=n=>{let c=0;for(;n;n&=n-1)c++;return c;};
function inside(x,z,ax,az,bx,bz,cx,cz){
 const d=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(d)<1e-9)return false;
 const a=((bx-x)*(cz-z)-(bz-z)*(cx-x))/d,b=((cx-x)*(az-z)-(cz-z)*(ax-x))/d;
 return a>=-1e-7&&b>=-1e-7&&a+b<=1+1e-7;
}
function intersectsDisk(x,z,radius,px,pz,size){const dx=Math.max(px-x,0,x-px-size),dz=Math.max(pz-z,0,z-pz-size);return dx*dx+dz*dz<=radius*radius+1e-12;}
export class SupportSurfaces{
 constructor(now=()=>performance.now()){
  this.now=now;this.config=SUPPORT_CONFIG;const c=this.config;
  this.points=new Float64Array(c.maxSamples*3);this.neighbors=new Int16Array(c.maxNeighbors);this.distances=new Float64Array(c.maxNeighbors);this.parent=new Int16Array(c.maxRegions);
  this.rays=new Float64Array(c.maxSamples*2);this.rayOrder=new Uint16Array(c.maxSamples);this.hull=new Uint16Array(c.maxSamples*2);
  this.origin=new Float64Array(3);this.normal=new Float64Array([0,1,0]);this.fit={};
  this.regions=Array.from({length:c.maxRegions},()=>({active:false,hits:new Uint8Array(16),seen:new Float64Array(16),independent:new Float64Array(16),free:new Uint8Array(16),freeFirst:new Float64Array(16),freeLast:new Float64Array(16)}));
  this.typedBytes=this.points.byteLength+this.neighbors.byteLength+this.distances.byteLength+this.parent.byteLength+this.rays.byteLength+this.rayOrder.byteLength+this.hull.byteLength+this.origin.byteLength+this.normal.byteLength+this.regions.reduce((n,r)=>n+r.hits.byteLength+r.seen.byteLength+r.independent.byteLength+r.free.byteLength+r.freeFirst.byteLength+r.freeLast.byteLength,0);
  this.reset(0,[0,0,0]);
 }
 reset(generation,origin,normal=[0,1,0]){
  this.generation=generation;this.origin.set(origin);this.normal.set(normal);this.points.fill(0);this.rays.fill(0);this.rayOrder.fill(0);this.hull.fill(0);this.neighbors.fill(0);this.distances.fill(0);this.parent.fill(0);this.sampleCount=0;this.fit.a=this.fit.b=this.fit.c=this.fit.nx=this.fit.nz=this.fit.tilt=this.fit.residual=this.fit.samples=0;this.fit.ny=1;
  for(const r of this.regions){r.active=r.pointOnly=false;r.mask=r.confirmedMask=0;r.id=r.ix=r.iz=r.x=r.z=r.height=r.a=r.b=r.c=r.nx=r.nz=r.pinX=r.pinY=r.pinZ=r.tilt=r.residual=r.samples=r.firstSeen=r.lastSeen=r.observations=0;r.ny=1;r.lastIndependent=-Infinity;r.hits.fill(0);r.seen.fill(-Infinity);r.independent.fill(-Infinity);r.free.fill(0);r.freeFirst.fill(0);r.freeLast.fill(-Infinity);}
  this.sequence=this.invalidated=this.invalidatedRegions=this.expired=this.cursor=this.revalidationCursor=this.updates=0;this.revalidationTurn=false;this.time=0;this.lastUpdate=-Infinity;this.interval=this.config.intervalMs;this.updateMs=this.queryMs=null;this.processed=this.accepted=this.rejectedVertical=this.rejectedGeometry=this.rejectedCurved=this.saturated=this.deferred=0;this.state='waiting-for-reconstruction';
 }
 maintain(time){
  this.time=time;const c=this.config;
  for(const r of this.regions){if(!r.active)continue;
   for(let b=0;b<16;b++)if(r.mask&(1<<b)){
    if(time-r.seen[b]>=(r.confirmedMask&(1<<b)?c.retentionMs:c.candidateTtl)){r.mask&=~(1<<b);r.confirmedMask&=~(1<<b);r.hits[b]=0;this.expired++;}
   }
   if(!r.mask&&(!r.pointOnly||time-r.lastSeen>=c.candidateTtl))r.active=false;
  }
 }
 fitPlane(seed,n,band){
  const p=this.points,j=seed*3,sx=p[j],sy=p[j+1],sz=p[j+2];let count=0,x=0,z=0,y=0,xx=0,zz=0,xz=0,xy=0,zy=0,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let k=0;k<n;k++){const b=this.neighbors[k]*3,dx=p[b]-sx,dz=p[b+2]-sz,dy=p[b+1]-sy;if(band&&Math.abs(dy)>.02)continue;
   count++;x+=dx;z+=dz;y+=dy;xx+=dx*dx;zz+=dz*dz;xz+=dx*dz;xy+=dx*dy;zy+=dz*dy;minX=Math.min(minX,dx);maxX=Math.max(maxX,dx);minZ=Math.min(minZ,dz);maxZ=Math.max(maxZ,dz);minY=Math.min(minY,dy);maxY=Math.max(maxY,dy);
  }
  if(count<6||maxX-minX<.07||maxZ-minZ<.07){if(count>=6&&maxY-minY>.07)this.rejectedVertical++;return false;}
  xx-=x*x/count;zz-=z*z/count;xz-=x*z/count;xy-=x*y/count;zy-=z*y/count;const det=xx*zz-xz*xz;
  if(det<1e-9||det/(xx+zz)**2<.025){if(maxY-minY>.07)this.rejectedVertical++;return false;}
  const a=(xy*zz-zy*xz)/det,b=(zy*xx-xy*xz)/det,d=(y-a*x-b*z)/count,length=Math.hypot(a,1,b),tilt=Math.acos(1/length)*180/Math.PI;
  if(tilt>this.config.maxTilt){this.rejectedVertical++;return false;}
  let squared=0,maxError=0,ambiguous=0;
  for(let k=0;k<n;k++){const q=this.neighbors[k]*3,dx=p[q]-sx,dz=p[q+2]-sz,dy=p[q+1]-sy,error=Math.abs(dy-a*dx-b*dz-d);
   if(band&&Math.abs(dy)>.02){if(error>.012&&error<.04&&dx>=minX&&dx<=maxX&&dz>=minZ&&dz<=maxZ)ambiguous++;continue;}
   squared+=error*error;maxError=Math.max(maxError,error);
  }
  if(maxError>this.config.planeError||Math.sqrt(squared/count)>.006||ambiguous>=3){this.rejectedCurved++;return false;}
  const fit=this.fit;fit.a=a;fit.b=b;fit.c=sy+d-a*sx-b*sz;fit.nx=-a/length;fit.ny=1/length;fit.nz=-b/length;fit.tilt=tilt;fit.residual=Math.sqrt(squared/count);fit.samples=count;return true;
 }
 region(ix,iz,height,fit){
  const c=this.config,x=this.origin[0]+(ix+.5)*c.cellSize,z=this.origin[2]+(iz+.5)*c.cellSize;let empty=null;
  for(const r of this.regions){if(!r.active){empty??=r;continue;}if(r.ix===ix&&r.iz===iz&&Math.abs(r.height-height)<=c.mergeHeight&&r.nx*fit.nx+r.ny*fit.ny+r.nz*fit.nz>.995)return r;}
  if(!empty){this.saturated++;return null;}
  const r=empty;Object.assign(r,{active:true,pointOnly:false,id:++this.sequence,generation:this.generation,ix,iz,x,z,height,a:fit.a,b:fit.b,c:fit.c,nx:fit.nx,ny:fit.ny,nz:fit.nz,tilt:fit.tilt,residual:fit.residual,samples:fit.samples,mask:0,confirmedMask:0,firstSeen:this.time,lastSeen:this.time,observations:0,lastIndependent:-Infinity});
  r.hits.fill(0);r.seen.fill(-Infinity);r.independent.fill(-Infinity);r.free.fill(0);r.freeFirst.fill(0);r.freeLast.fill(-Infinity);return r;
 }
 triangle(ax,az,bx,bz,cx,cz,fit){
  const c=this.config,s=c.cellSize,q=s/4,o=this.origin;
  const minX=Math.floor((Math.min(ax,bx,cx)-o[0])/s),maxX=Math.floor((Math.max(ax,bx,cx)-o[0])/s),minZ=Math.floor((Math.min(az,bz,cz)-o[2])/s),maxZ=Math.floor((Math.max(az,bz,cz)-o[2])/s);
  let observed=0;for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
   let mask=0;for(let b=0;b<16;b++){const x=o[0]+ix*s+(b%4)*q,z=o[2]+iz*s+Math.floor(b/4)*q;
    if(inside(x,z,ax,az,bx,bz,cx,cz)&&inside(x+q,z,ax,az,bx,bz,cx,cz)&&inside(x,z+q,ax,az,bx,bz,cx,cz)&&inside(x+q,z+q,ax,az,bx,bz,cx,cz))mask|=1<<b;
   }
   if(!mask)continue;const x=o[0]+(ix+.5)*s,z=o[2]+(iz+.5)*s,height=fit.a*x+fit.b*z+fit.c,r=this.region(ix,iz,height,fit);if(!r)continue;observed++;r.pointOnly=false;
   // Geometry follows current measured evidence, never an extrapolated whole cell.
   r.a=fit.a;r.b=fit.b;r.c=fit.c;r.height=height;r.nx=fit.nx;r.ny=fit.ny;r.nz=fit.nz;r.tilt=fit.tilt;r.residual=fit.residual;r.samples=fit.samples;r.lastSeen=this.time;
   if(this.time-r.lastIndependent>=c.independentMs){r.observations++;r.lastIndependent=this.time;}
   for(let b=0;b<16;b++)if(mask&(1<<b)){
    r.mask|=1<<b;r.seen[b]=this.time;r.free[b]=0;r.freeLast[b]=-Infinity;
    if(this.time-r.independent[b]>=c.independentMs){r.hits[b]=Math.min(c.confirmations,r.hits[b]+1);r.independent[b]=this.time;}
    if(r.hits[b]>=c.confirmations)r.confirmedMask|=1<<b;
   }
  }
  return observed;
 }
 pointCandidate(x,y,z,fit){
  const c=this.config,ix=Math.floor((x-this.origin[0])/c.cellSize),iz=Math.floor((z-this.origin[2])/c.cellSize),cx=this.origin[0]+(ix+.5)*c.cellSize,cz=this.origin[2]+(iz+.5)*c.cellSize;
  const r=this.region(ix,iz,fit.a*cx+fit.b*cz+fit.c,fit);if(!r||r.mask)return;
  r.pointOnly=true;r.pinX=x;r.pinY=y;r.pinZ=z;r.lastSeen=this.time;r.a=fit.a;r.b=fit.b;r.c=fit.c;r.height=fit.a*cx+fit.b*cz+fit.c;r.nx=fit.nx;r.ny=fit.ny;r.nz=fit.nz;r.tilt=fit.tilt;r.residual=fit.residual;r.samples=fit.samples;
  if(this.time-r.lastIndependent>=c.independentMs){r.observations++;r.lastIndependent=this.time;}
 }
 supported2D(x,z,fit,n,radius){
  const p=this.points;for(let k=0;k<n;k++){const b=this.neighbors[k]*3,dx=p[b]-x,dz=p[b+2]-z;if(dx*dx+dz*dz<=radius*radius+1e-10&&Math.abs(p[b+1]-fit.a*p[b]-fit.b*p[b+2]-fit.c)<=this.config.planeError)return true;}return false;
 }
 continuousEdge(ax,az,bx,bz,pitch,fit,n){
  if((ax-bx)**2+(az-bz)**2<=(pitch*1.8)**2)return true;
  // A long edge needs actual intermediate samples; equal height on either side
  // of a measured gap is not evidence that the gap contains a support face.
  for(let k=1;k<=3;k++){const fraction=k===1?1/3:k===2?.5:2/3;if(!this.supported2D(ax+(bx-ax)*fraction,az+(bz-az)*fraction,fit,n,pitch*.55))return false;}return true;
 }
 update(time,points,count,camera=null){
  this.maintain(time);if(time-this.lastUpdate<this.interval)return false;
  this.lastUpdate=time;this.updates++;const started=this.now(),c=this.config;this.processed=this.accepted=this.rejectedVertical=this.rejectedGeometry=this.rejectedCurved=this.deferred=0;
  count=Math.min(c.maxSamples,Math.max(0,Math.trunc(count)));let valid=0;
  for(let i=0;i<count*3;i+=3)if(Number.isFinite(points[i]+points[i+1]+points[i+2])){this.points[valid*3]=points[i];this.points[valid*3+1]=points[i+1];this.points[valid*3+2]=points[i+2];valid++;}
  this.sampleCount=valid;const p=this.points,limit=Math.min(valid,c.maxSeeds);
  this.revalidationTurn=!this.revalidationTurn;if(camera&&this.revalidationTurn)this.revalidate(time,p,valid,camera,started);
  for(let step=0;step<limit;step++){
   if(step>0&&this.now()-started>c.budgetMs){this.deferred=limit-step;break;}
   const seed=Math.floor((this.cursor++%limit)*valid/limit),j=seed*3;this.processed++;let n=0;
   for(let k=0;k<valid;k++){
    const b=k*3,dx=p[b]-p[j],dz=p[b+2]-p[j+2],dy=p[b+1]-p[j+1],distance=dx*dx+dz*dz;
    if(distance>c.neighborhood**2||Math.abs(dy)>.14)continue;
    let index=n;if(index===c.maxNeighbors){if(distance>=this.distances[index-1])continue;index--;}else n++;
    while(index>0&&distance<this.distances[index-1]){this.distances[index]=this.distances[index-1];this.neighbors[index]=this.neighbors[index-1];index--;}
    this.distances[index]=distance;this.neighbors[index]=k;
   }
   if(!this.fitPlane(seed,n,true)&&!this.fitPlane(seed,n,false)){this.rejectedGeometry++;continue;}
   const f=this.fit;let best=0,bi=-1,ci=-1,pitch=Infinity;
   // A horizontal underside is not an observed upper support face. Runtime supplies
   // the acquisition camera; point-only callers retain geometric potential only.
   if(camera&&(camera[1]-f.a*camera[0]-f.b*camera[2]-f.c)*f.ny<.03){this.rejectedGeometry++;continue;}
   for(let k=0;k<n;k++){const b=this.neighbors[k]*3;if(this.distances[k]>1e-8&&Math.abs(p[b+1]-f.a*p[b]-f.b*p[b+2]-f.c)<=c.planeError){pitch=Math.sqrt(this.distances[k]);break;}}
   const choices=Math.min(n,12);
   for(let ia=0;ia<choices;ia++)for(let ib=ia+1;ib<choices;ib++){
    const a=Math.floor(ia*n/choices),b=Math.floor(ib*n/choices);
    const x=this.neighbors[a]*3,z=this.neighbors[b]*3;if(Math.abs(p[x+1]-f.a*p[x]-f.b*p[x+2]-f.c)>c.planeError||Math.abs(p[z+1]-f.a*p[z]-f.b*p[z+2]-f.c)>c.planeError)continue;
    const dx=p[x]-p[j],dz=p[x+2]-p[j+2],ex=p[z]-p[j],ez=p[z+2]-p[j+2],area=Math.abs(dx*ez-dz*ex);
    if(Math.max(dx*dx+dz*dz,ex*ex+ez*ez,(dx-ex)**2+(dz-ez)**2)>c.maxTriangleEdge**2||area<=best)continue;
    if(!this.continuousEdge(p[j],p[j+2],p[x],p[x+2],pitch,f,n)||!this.continuousEdge(p[j],p[j+2],p[z],p[z+2],pitch,f,n)||!this.continuousEdge(p[x],p[x+2],p[z],p[z+2],pitch,f,n)||!this.supported2D((p[j]+p[x]+p[z])/3,(p[j+2]+p[x+2]+p[z+2])/3,f,n,pitch*.8))continue;
    best=area;bi=x;ci=z;
   }
   if(best<.002){this.pointCandidate(p[j],p[j+1],p[j+2],f);this.rejectedGeometry++;continue;}
   if(!this.triangle(p[j],p[j+2],p[bi],p[bi+2],p[ci],p[ci+2],f))this.pointCandidate(p[j],p[j+1],p[j+2],f);this.accepted++;
  }
  // Revalidation is independently bounded and skips expensive work when the frame budget is spent.
  if(camera&&!this.revalidationTurn&&this.now()-started<c.budgetMs)this.revalidate(time,p,valid,camera,started);
  this.updateMs=Math.max(0,this.now()-started);this.interval=this.deferred||this.updateMs>c.budgetMs?Math.min(1000,this.interval*1.5):Math.max(c.intervalMs,this.interval*.9);
  this.state=valid?(this.deferred?'budget-deferred':'observing'):'insufficient-data';return true;
 }
 revalidate(time,points,count,camera,started=this.now()){
  const c=this.config,q=c.cellSize/4;
  let targets=0;for(let k=0;k<c.maxRegions&&targets<16;k++){
   if(k&&this.now()-started>c.budgetMs)break;
   const r=this.regions[this.revalidationCursor++%c.maxRegions];if(!r.active||!r.confirmedMask)continue;
   let aged=false;for(let b=0;b<16;b++)if(r.confirmedMask&(1<<b)&&time-r.seen[b]>=c.holdMs)aged=true;if(!aged)continue;targets++;
   let votes=0,observedRays=0,veto=0,n=0;
   for(let i=0;i<count*3;i+=3){
    const dx=points[i]-camera[0],dy=points[i+1]-camera[1],dz=points[i+2]-camera[2],den=dy-r.a*dx-r.b*dz;
    if(Math.abs(den)<1e-8)continue;const a=(r.a*camera[0]+r.b*camera[2]+r.c-camera[1])/den;
    if(a<=0)continue;
    const x=camera[0]+a*dx-this.origin[0]-r.ix*c.cellSize,z=camera[2]+a*dz-this.origin[2]-r.iz*c.cellSize;
    if(x< -q||z< -q||x>c.cellSize+q||z>c.cellSize+q)continue;
    const inRegion=x>=0&&z>=0&&x<c.cellSize&&z<c.cellSize,b=Math.max(0,Math.min(3,Math.floor(x/q)))+4*Math.max(0,Math.min(3,Math.floor(z/q)));
    if(a>=1||Math.hypot(dx,dy,dz)*(1-a)<.06){if(inRegion)veto|=1<<b;continue;}
    observedRays|=1<<b;this.rays[n*2]=x;this.rays[n*2+1]=z;n++;
   }
   // At least three different observed subregions must be traversed in this acquisition.
   // A repeated pixel/identical ray cannot manufacture a free observation.
   if(popcount(observedRays)>=3){
    const hullCount=this.rayHull(n);
    for(let b=0;b<16;b++)if(r.confirmedMask&(1<<b)&&time-r.seen[b]>=c.holdMs&&!(veto&(1<<b))){
     const x=b%4*q,z=Math.floor(b/4)*q;
     if(this.inRayHull(x,z,hullCount)&&this.inRayHull(x+q,z,hullCount)&&this.inRayHull(x,z+q,hullCount)&&this.inRayHull(x+q,z+q,hullCount))votes|=1<<b;
    }
   }
   for(let b=0;b<16;b++)if(votes&(1<<b)){
    if(time-r.freeLast[b]>5000){r.free[b]=0;r.freeFirst[b]=time;}
    if(time-r.freeLast[b]>=c.independentMs){r.free[b]++;r.freeLast[b]=time;}
    if(r.free[b]>=c.freeVotes&&time-r.freeFirst[b]>=c.freeSpan){r.mask&=~(1<<b);r.confirmedMask&=~(1<<b);r.hits[b]=0;this.invalidated++;}
   }else if(veto&(1<<b)||time-r.freeLast[b]>5000)r.free[b]=0;
   if(!r.confirmedMask)this.invalidatedRegions++;if(!r.mask)r.active=false;
  }
 }
 rayHull(n){
  const p=this.rays,o=this.rayOrder,h=this.hull;
  for(let i=0;i<n;i++){let j=i;while(j>0&&(p[o[j-1]*2]>p[i*2]||p[o[j-1]*2]===p[i*2]&&p[o[j-1]*2+1]>p[i*2+1])){o[j]=o[j-1];j--;}o[j]=i;}
  const cross=(a,b,c)=>(p[b*2]-p[a*2])*(p[c*2+1]-p[a*2+1])-(p[b*2+1]-p[a*2+1])*(p[c*2]-p[a*2]);
  let count=0;for(let i=0;i<n;i++){while(count>=2&&cross(h[count-2],h[count-1],o[i])<=0)count--;h[count++]=o[i];}
  const lower=count+1;for(let i=n-2;i>=0;i--){while(count>=lower&&cross(h[count-2],h[count-1],o[i])<=0)count--;h[count++]=o[i];}
  return count>1?count-1:count;
 }
 inRayHull(x,z,n){if(n<3)return false;const p=this.rays,h=this.hull;
  for(let i=0;i<n;i++){const a=h[i]*2,b=h[(i+1)%n]*2;if((p[b]-p[a])*(z-p[a+1])-(p[b+1]-p[a+1])*(x-p[a])< -1e-8)return false;}return true;
 }
 relativeHeight(x,y,z){const o=this.origin,n=this.normal;return (x-o[0])*n[0]+(y-o[1])*n[1]+(z-o[2])*n[2];}
 regionState(r,time=this.time){if(!r.confirmedMask)return 'candidate';for(let b=0;b<16;b++)if(r.confirmedMask&(1<<b)&&(time-r.seen[b]>=this.config.revalidateAfter||r.free[b]>0))return 'revalidating';return 'confirmed';}
 regionAge(r,time=this.time){let age=r.pointOnly?time-r.lastSeen:0;for(let b=0;b<16;b++)if(r.mask&(1<<b))age=Math.max(age,time-r.seen[b]);return Math.max(0,age);}
 kind(r){const height=this.relativeHeight(r.x,r.height,r.z),n=this.normal;return Math.abs(height)<=.025&&r.nx*n[0]+r.ny*n[1]+r.nz*n[2]>.995?'reference-floor':r.tilt>8?'inclined':height>0?'elevated':'lower';}
 // IDs describe connected observed regions only. Equal height alone never joins gaps.
 components(){
  const a=this.regions,p=this.parent;for(let i=0;i<a.length;i++)p[i]=i;
  const root=i=>{while(p[i]!==i){p[i]=p[p[i]];i=p[i];}return i;};
  for(let i=0;i<a.length;i++){const r=a[i];if(!r.active)continue;
   for(let j=0;j<i;j++){const s=a[j];if(!s.active||Math.abs(r.ix-s.ix)+Math.abs(r.iz-s.iz)!==1||r.nx*s.nx+r.ny*s.ny+r.nz*s.nz<.995)continue;
    const x=(r.x+s.x)/2,z=(r.z+s.z)/2;if(Math.abs(r.a*x+r.b*z+r.c-(s.a*x+s.b*z+s.c))>.015)continue;
    let touch=false;for(let b=0;b<16;b++)if(r.mask&(1<<b)){
     const gx=r.ix*4+b%4,gz=r.iz*4+Math.floor(b/4);for(let k=0;k<16;k++)if(s.mask&(1<<k)&&Math.abs(gx-(s.ix*4+k%4))+Math.abs(gz-(s.iz*4+Math.floor(k/4)))===1)touch=true;
    }
    if(touch)p[root(i)]=root(j);
   }
  }
  for(let i=0;i<a.length;i++)p[i]=root(i);
 }
 query({x,z,radius=0,time=this.time,includeCandidates=false,below=Infinity,above=-Infinity,descending=false}={}){
  const started=this.now(),c=this.config;if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||radius<0||radius>.5||typeof below!=='number'||Number.isNaN(below)||typeof above!=='number'||Number.isNaN(above))throw Error('Support query requires finite X/Z, radius 0..0.5 m and valid height limits');
  this.maintain(time);this.components();const results=[],q=c.cellSize/4,o=this.origin,cx=Math.floor((x-o[0])/q),cz=Math.floor((z-o[2])/q);let total=0;
  if(!radius)total=1;else for(let a=Math.floor((x-radius-o[0])/q);a<=Math.floor((x+radius-o[0])/q);a++)for(let b=Math.floor((z-radius-o[2])/q);b<=Math.floor((z+radius-o[2])/q);b++)if(intersectsDisk(x,z,radius,o[0]+a*q,o[2]+b*q,q))total++;
  for(let i=0;i<this.regions.length;i++){
   const r=this.regions[i];if(!r.active||!includeCandidates&&!r.confirmedMask)continue;const height=r.a*x+r.b*z+r.c;if(height>below||height<above)continue;
   let knownMask=0,centerObserved=false;const allMask=includeCandidates?r.mask:r.confirmedMask;
   for(let b=0;b<16;b++)if(allMask&(1<<b)){
    const gx=r.ix*4+b%4,gz=r.iz*4+Math.floor(b/4),px=o[0]+gx*q,pz=o[2]+gz*q;
    if(radius?intersectsDisk(x,z,radius,px,pz,q):gx===cx&&gz===cz)knownMask|=1<<b;
    if(gx===cx&&gz===cz)centerObserved=true;
   }
   const pointNearby=r.pointOnly&&includeCandidates&&Math.hypot(x-r.pinX,z-r.pinZ)<=Math.max(.001,radius);
   if(!knownMask&&!pointNearby)continue;const id=this.regions[this.parent[i]].id;let out=results.find(v=>v.id===id);
   if(!out){out={id,generation:this.generation,height,relativeHeight:this.relativeHeight(x,height,z),normal:[r.nx,r.ny,r.nz],inclination:r.tilt,state:this.regionState(r,time),kind:this.kind(r),evidence:'geometric-only; not calibrated probability or walkability',coverageBasis:'all observed 3cm tiles intersecting requested disk; conservative at rim',known:0,total,members:[],centerObserved:false,observedArea:0,regions:0,ageMs:this.regionAge(r,time),boundary:'coverage-limit; physical edge unproven'};results.push(out);}
   let member=out.members.find(v=>v.ix===r.ix&&v.iz===r.iz);if(!member){member={ix:r.ix,iz:r.iz,mask:0};out.members.push(member);}
   out.known+=popcount(knownMask&~member.mask);out.centerObserved||=centerObserved;out.observedArea+=popcount(allMask&~member.mask)*q*q;member.mask|=allMask;out.regions++;out.ageMs=Math.max(out.ageMs,this.regionAge(r,time));if(this.regionState(r,time)==='revalidating')out.state='revalidating';
   out.observedBounds??={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
   if(pointNearby){out.pointOnly=true;out.observedBounds={minX:r.pinX,maxX:r.pinX,minY:r.pinY,maxY:r.pinY,minZ:r.pinZ,maxZ:r.pinZ};}
   for(let bit=0;bit<16;bit++)if((includeCandidates?r.mask:r.confirmedMask)&(1<<bit))for(let corner=0;corner<4;corner++){
    const px=this.origin[0]+(r.ix+(bit%4+(corner&1?1:0))/4)*c.cellSize,pz=this.origin[2]+(r.iz+(Math.floor(bit/4)+(corner&2?1:0))/4)*c.cellSize,py=r.a*px+r.b*pz+r.c,bounds=out.observedBounds;
    bounds.minX=Math.min(bounds.minX,px);bounds.maxX=Math.max(bounds.maxX,px);bounds.minY=Math.min(bounds.minY,py);bounds.maxY=Math.max(bounds.maxY,py);bounds.minZ=Math.min(bounds.minZ,pz);bounds.maxZ=Math.max(bounds.maxZ,pz);
   }
  }
  for(const r of results){r.coverage=Math.min(1,r.known/r.total);r.unknownFraction=1-r.coverage;r.fullyObserved=r.coverage===1;delete r.known;delete r.total;delete r.members;}
  results.sort((a,b)=>descending?b.height-a.height:a.height-b.height);const limited=results.length>c.maxQueryResults;for(const r of results)r.moreAvailable=limited;this.queryMs=Math.max(0,this.now()-started);return results.slice(0,c.maxQueryResults);
 }
 boundaries({x,z,radius=.15,time=this.time}={}){
  if(!Number.isFinite(x+z+radius)||radius<0||radius>.5)throw Error('Invalid support boundary region');
  this.maintain(time);const c=this.config,q=c.cellSize/4,out=[];
  for(const r of this.regions){if(!r.active||!r.confirmedMask)continue;
   for(let b=0;b<16;b++){if(!(r.confirmedMask&(1<<b)))continue;const px=this.origin[0]+r.ix*c.cellSize+(b%4+.5)*q,pz=this.origin[2]+r.iz*c.cellSize+(Math.floor(b/4)+.5)*q;
    if(Math.hypot(px-x,pz-z)>radius+q)continue;
    for(let side=0;side<4;side++){
     const dx=side===0?-1:side===1?1:0,dz=side===2?-1:side===3?1:0,ex=px+dx*q/2,ez=pz+dz*q/2,height=r.a*ex+r.b*ez+r.c;
     if(this.observedAt(ex+dx*q*.1,ez+dz*q*.1,height,time))continue;
     let distinct=0,h1=Infinity,h2=Infinity,sideX=0,sideZ=0;
     if(time-this.lastUpdate<500&&time-r.seen[b]<500)for(let i=0;i<(this.sampleCount||0)*3;i+=3){const y=this.points[i+1];
      if(height-y<.04||height-y>.6||Math.hypot(this.points[i]-ex,this.points[i+2]-ez)>.045)continue;
      if(!distinct){h1=y;distinct=1;sideX=this.points[i];sideZ=this.points[i+2];}else if(Math.abs(y-h1)>.015&&distinct===1){h2=y;distinct=2;sideX+=this.points[i];sideZ+=this.points[i+2];}else if(distinct===2&&Math.abs(y-h1)>.015&&Math.abs(y-h2)>.015){distinct=3;sideX+=this.points[i];sideZ+=this.points[i+2];break;}
     }
     const priority=distinct===3?-1:Math.hypot(ex-x,ez-z);
     if(out.length<16||priority<out.at(-1).priority){const item={regionId:r.id,x:distinct===3?sideX/3:ex,z:distinct===3?sideZ/3:ez,coverageX:ex,coverageZ:ez,height,kind:distinct===3?'possible-vertical-drop':'coverage-limit',uncertaintyRadius:distinct===3?.045:null,evidence:distinct===3?'three current distinct lower side heights; connection to coverage edge remains unobserved':'no physical edge inference from missing samples',priority};if(out.length<16)out.push(item);else out[out.length-1]=item;out.sort((a,b)=>a.priority-b.priority);}
    }
   }
  }
  return out;
 }
 observedAt(x,z,height,time=this.time){
  const c=this.config,q=c.cellSize/4,ix=Math.floor((x-this.origin[0])/c.cellSize),iz=Math.floor((z-this.origin[2])/c.cellSize);
  for(const r of this.regions)if(r.active&&r.ix===ix&&r.iz===iz&&Math.abs(r.a*x+r.b*z+r.c-height)<=c.mergeHeight){
   const b=Math.floor((x-this.origin[0]-ix*c.cellSize)/q)+4*Math.floor((z-this.origin[2]-iz*c.cellSize)/q);
   if(r.confirmedMask&(1<<b)&&time-r.seen[b]<c.retentionMs)return true;
  }
  return false;
 }
 below(x,z,height,radius=0,time=this.time){return this.query({x,z,radius,time,below:height,descending:true});}
 above(x,z,height,radius=0,time=this.time){return this.query({x,z,radius,time,above:height});}
 snapshot(time=this.time){
  this.maintain(time);this.components();let candidates=0,confirmed=0,revalidating=0,regions=0;const list=[];
  for(let i=0;i<this.regions.length;i++){const r=this.regions[i];if(!r.active)continue;regions++;const state=this.regionState(r,time);if(state==='candidate')candidates++;else if(state==='confirmed')confirmed++;else revalidating++;
   const id=this.regions[this.parent[i]].id;let v=list.find(s=>s.id===id);if(!v){v={id,generation:this.generation,state,pointOnly:!!r.pointOnly,kind:this.kind(r),relativeHeight:this.relativeHeight(r.x,r.height,r.z),inclination:r.tilt,observedArea:0,ageMs:this.regionAge(r,time),independent:r.observations,samples:r.samples,residual:r.residual,quality:r.pointOnly?'insufficient area; uncalibrated plane evidence only':'uncalibrated geometric evidence',boundary:'coverage-limit'};list.push(v);}
   v.observedArea+=popcount(r.mask)*(this.config.cellSize/4)**2;v.confirmedArea=(v.confirmedArea||0)+popcount(r.confirmedMask)*(this.config.cellSize/4)**2;v.independent=Math.min(v.independent,r.observations);v.ageMs=Math.max(v.ageMs,this.regionAge(r,time));if(state==='revalidating')v.state=state;
  }
  list.sort((a,b)=>b.observedArea-a.observedArea);const summaries=[];
  for(const v of list)if(summaries.length<this.config.maxExport&&!summaries.some(s=>Math.abs(s.relativeHeight-v.relativeHeight)<.03&&s.kind===v.kind))summaries.push(v);
  for(const v of list)if(summaries.length<this.config.maxExport&&!summaries.includes(v))summaries.push(v);
  return {state:this.state,generation:this.generation,updates:this.updates,samples:this.sampleCount||0,processed:this.processed,accepted:this.accepted,candidateRegions:candidates,confirmedRegions:confirmed,revalidatingRegions:revalidating,regions,surfaces:list.length,invalidated:this.invalidated,invalidatedTiles:this.invalidated,invalidatedRegions:this.invalidatedRegions,expired:this.expired,rejectedVertical:this.rejectedVertical,rejectedGeometry:this.rejectedGeometry,rejectedCurved:this.rejectedCurved,saturated:this.saturated,deferred:this.deferred,intervalMs:this.interval,updateMs:this.updateMs,queryMs:this.queryMs,typedBytes:this.typedBytes,maxRegions:this.config.maxRegions,exportLimit:this.config.maxExport,summaries};
 }
}
