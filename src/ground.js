// Ground evidence derived only from the existing reconstruction, never extra depth reads.
// A plane must connect to the selected support, span both horizontal axes, and survive
// independent acquisitions. A uniform elevated plane without that anchor is ambiguous.
export class GroundEvidence {
  constructor(map,now=()=>performance.now()) {this.map=map;this.now=now;this.labels=new Uint8Array(432);this.keys=new Float64Array(1024);this.clear();}
  clear(){
    this.labels.fill(0);this.keys.fill(-1);this.a=this.b=this.c=0;this.valid=this.certified=false;
    this.observations=0;this.lastIndependent=this.time=this.queryTime=-Infinity;
    this.floorPoints=this.obstaclePoints=this.uncertainPoints=this.seeds=this.inliers=0;this.offset=this.observedDelta=this.residual=null;this.costMs=null;
    this.minX=this.maxX=this.minZ=this.maxZ=0;
  }
  height(x,y,z){const o=this.map.origin,n=this.map.normal;return (x-o[0])*n[0]+(y-o[1])*n[1]+(z-o[2])*n[2];}
  error(x,y,z){const o=this.map.origin;return this.height(x,y,z)-this.a*(x-o[0])-this.b*(z-o[2])-this.c;}
  slot(x,z,insert=false){
    const m=this.map,s=m.config.cellSize,ix=Math.floor((x-m.origin[0])/s),iz=Math.floor((z-m.origin[2])/s),key=m.key(ix,0,iz);
    if(key<0)return false;let j=((ix*73856093)^(iz*19349663))&1023;
    for(let k=0;k<1024;k++,j=(j+1)&1023){if(this.keys[j]===key)return true;if(this.keys[j]===-1){if(insert)this.keys[j]=key;return insert;}}
    return false;
  }
  isFloor(x,y,z){return this.certified&&this.queryTime-this.time<this.map.config.candidateTtl&&Math.abs(this.error(x,y,z))<=this.map.config.pointMargin&&this.slot(x,z);}
  isMeasuredFloor(x,y,z){const o=this.map.origin;return this.certified&&this.queryTime-this.time<this.map.config.candidateTtl&&x-o[0]>=this.minX&&x-o[0]<=this.maxX&&z-o[2]>=this.minZ&&z-o[2]<=this.maxZ&&Math.abs(this.error(x,y,z))<=this.map.config.pointMargin;}
  boundsAreFloor(cell){
    if(!this.certified)return false;
    for(let k=0;k<8;k++)if(Math.abs(this.error(k&1?cell.maxX:cell.minX,k&2?cell.maxY:cell.minY,k&4?cell.maxZ:cell.minZ))>this.map.config.pointMargin)return false;
    return true;
  }
  update(time,points,count){
    const started=this.now(),m=this.map,c=m.config,o=m.origin,n=m.normal;
    this.time=this.queryTime=time;this.labels.fill(0);this.keys.fill(-1);
    let total=0,sx=0,sz=0,sh=0,sxx=0,szz=0,sxz=0,sxh=0,szh=0,nearCount=0,nearHeight=0,nearLow=Infinity,nearHigh=-Infinity;
    // Seeds are close to the hit-test anchor and already compatible with its tolerance.
    for(let i=0;i<count*3;i+=3){
      const x=points[i]-o[0],z=points[i+2]-o[2],h=this.height(points[i],points[i+1],points[i+2]);
      if(x*x+z*z>(c.cellSize*3)**2)continue;
      if(Math.abs(h)<=.5){nearCount++;nearHeight+=h;nearLow=Math.min(nearLow,h);nearHigh=Math.max(nearHigh,h);}
      if(Math.abs(h)>c.floorTolerance)continue;
      total++;sx+=x;sz+=z;sh+=h;sxx+=x*x;szz+=z*z;sxz+=x*z;sxh+=x*h;szh+=z*h;
    }
    this.seeds=total;
    let fit=false,a=0,b=0,d=0,residual=0,inliers=0,eligible=0,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    if(total>=6){
      const xx=sxx-sx*sx/total,zz=szz-sz*sz/total,xz=sxz-sx*sz/total,xh=sxh-sx*sh/total,zh=szh-sz*sh/total,det=xx*zz-xz*xz;
      if(det>1e-7){
        a=(xh*zz-zh*xz)/det;b=(zh*xx-xh*xz)/det;d=(sh-a*sx-b*sz)/total;
        const length=Math.hypot(n[0]-a,n[1],n[2]-b),alignment=((n[0]-a)*n[0]+n[1]*n[1]+(n[2]-b)*n[2])/length;
        if(Math.abs(d)<=c.pointMargin&&alignment>=.95){
          total=sx=sz=sh=sxx=szz=sxz=sxh=szh=0;
          for(let i=0;i<count*3;i+=3){
            const x=points[i]-o[0],z=points[i+2]-o[2],h=this.height(points[i],points[i+1],points[i+2]);
            if(x*x+z*z>c.radius*c.radius||Math.abs(h)>.5)continue;eligible++;
            const error=Math.abs(h-a*x-b*z-d);if(error>c.pointMargin)continue;
            inliers++;residual+=error;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
            total++;sx+=x;sz+=z;sh+=h;sxx+=x*x;szz+=z*z;sxz+=x*z;sxh+=x*h;szh+=z*h;
          }
          fit=inliers>=24&&inliers>=eligible*.65&&maxX-minX>=c.cellSize*5&&maxZ-minZ>=c.cellSize*5;
          // One bounded refinement over seed-compatible inliers reduces pixel quantisation
          // bias in the reduced 16x12 budget; it cannot recruit a separate elevated top.
          if(!fit&&inliers>=24&&maxX-minX>=c.cellSize*5&&maxZ-minZ>=c.cellSize*5){
            const xx=sxx-sx*sx/total,zz=szz-sz*sz/total,xz=sxz-sx*sz/total,xh=sxh-sx*sh/total,zh=szh-sz*sh/total,det=xx*zz-xz*xz;
            if(det>1e-7){
              const ra=(xh*zz-zh*xz)/det,rb=(zh*xx-xh*xz)/det,rd=(sh-ra*sx-rb*sz)/total,length=Math.hypot(n[0]-ra,n[1],n[2]-rb);
              if(Math.abs(rd)<=c.pointMargin&&((n[0]-ra)*n[0]+n[1]*n[1]+(n[2]-rb)*n[2])/length>=.95){
                a=ra;b=rb;d=rd;inliers=residual=eligible=0;minX=minZ=Infinity;maxX=maxZ=-Infinity;
                for(let i=0;i<count*3;i+=3){const x=points[i]-o[0],z=points[i+2]-o[2],h=this.height(points[i],points[i+1],points[i+2]);if(x*x+z*z>c.radius*c.radius||Math.abs(h)>.5)continue;eligible++;const error=Math.abs(h-a*x-b*z-d);if(error>c.pointMargin)continue;inliers++;residual+=error;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
                fit=inliers>=24&&inliers>=eligible*.65&&maxX-minX>=c.cellSize*5&&maxZ-minZ>=c.cellSize*5;
              }
            }
          }
        }
      }
    }
    const stable=fit&&this.valid&&Math.abs(d-this.c)+c.radius*(Math.abs(a-this.a)+Math.abs(b-this.b))<=c.pointMargin;
    if(!fit){this.observations=0;this.lastIndependent=-Infinity;}
    else if(!stable){this.observations=1;this.lastIndependent=time;}
    else if(time-this.lastIndependent>=c.independentInterval){this.observations=Math.min(c.confirmations,this.observations+1);this.lastIndependent=time;}
    this.a=a;this.b=b;this.c=d;this.valid=fit;this.certified=fit&&this.observations>=c.confirmations;
    this.minX=minX;this.maxX=maxX;this.minZ=minZ;this.maxZ=maxZ;
    this.offset=fit?d:null;this.observedDelta=nearCount?nearHeight/nearCount:null;this.inliers=inliers;this.residual=inliers?residual/inliers:null;
    const ambiguousRaised=!fit&&nearCount>=6&&nearHigh-nearLow<=c.pointMargin&&nearLow>c.floorTolerance;
    this.floorPoints=this.obstaclePoints=this.uncertainPoints=0;
    for(let i=0;i<count;i++){
      const j=i*3,x=points[j],y=points[j+1],z=points[j+2],h=this.height(x,y,z),compatible=fit&&Math.abs(h-a*(x-o[0])-b*(z-o[2])-d)<=c.pointMargin;
      let label=Math.abs(h)<=c.floorTolerance?1:compatible?(this.certified?1:0):ambiguousRaised&&Math.abs(h-this.observedDelta)<=c.pointMargin?0:h>c.floorTolerance?2:0;
      this.labels[i]=label;
      if(label===1){this.floorPoints++;if(this.certified&&compatible)this.slot(x,z,true);}
      else if(label===2)this.obstaclePoints++;else this.uncertainPoints++;
    }
    this.costMs=Math.max(0,this.now()-started);
  }
  snapshot(){return {confidence:this.certified?(this.queryTime-this.time<this.map.config.candidateTtl?'anchored-temporal':'stale'):this.valid?'pending-temporal':'uncertain',observations:this.observations,supportSeeds:this.seeds,inliers:this.inliers,supportOffset:this.offset,observedSupportDelta:this.observedDelta,meanResidual:this.residual,floorPoints:this.floorPoints,obstaclePoints:this.obstaclePoints,uncertainPoints:this.uncertainPoints,ageMs:Number.isFinite(this.time)?Math.max(0,this.queryTime-this.time):null,classificationMs:this.costMs,bytes:this.labels.byteLength+this.keys.byteLength};}
}
