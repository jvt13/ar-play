import {radiusAt,supportAt,orientedDepth} from './volume.js';

// World-space data derived by the algorithm, never native XR resources.
// A single interleaved position/normal buffer uses the Engine's existing VP/shaders.
export class SpatialDebug {
  constructor(engine, now=()=>performance.now()) {
    this.engine=engine;this.now=now;this.data=new Float32Array(6000*6);
    for(let i=0;i<6000;i++)this.data[i*6+4]=1;
    this.groups=[
      {color:[.1,1,.2,1],points:true}, {color:[1,.9,.1,1],points:true},
      {color:[1,.1,.1,1]}, {color:[1,.45,.05,1]},
      {color:[.15,.5,1,1]}, {color:[.5,.7,.8,1]},
      {color:[.9,.1,1,1],overlay:true}, {color:[.1,1,1,1],overlay:true},
      {color:[.55,.55,.55,1],points:true},
      {color:[.7,.2,1,1]}, {color:[1,.3,.7,1]}, {color:[.5,1,.75,1],points:true},
      {color:[1,1,1,1]}, {color:[1,1,1,1],points:true},
    ];
    this.clear();
  }
  clear() {
    this.engine?.releaseDebug?.();this.data.fill(0);
    for(let i=0;i<6000;i++)this.data[i*6+4]=1;
    this.count=0;this.enabled=false;this.buildMs=this.drawMs=null;
    this.groundCount=this.candidateCount=this.cellCount=this.contactCount=this.outsideCount=0;
    for(const group of this.groups){group.first=group.count=0;}
  }
  vertex(x,y,z) {
    if(this.count>=6000 || !Number.isFinite(x+y+z))return;
    const i=this.count++*6;this.data[i]=x;this.data[i+1]=y;this.data[i+2]=z;
  }
  line(x,y,z,a,b,c){this.vertex(x,y,z);this.vertex(a,b,c);}
  begin(index){this.group=this.groups[index];this.group.first=this.count;}
  end(){this.group.count=this.count-this.group.first;}
  box(ax,ay,az,bx,by,bz){
    for(let h=0;h<2;h++){
      const y=h?by:ay;
      this.line(ax,y,az,bx,y,az);this.line(bx,y,az,bx,y,bz);
      this.line(bx,y,bz,ax,y,bz);this.line(ax,y,bz,ax,y,az);
    }
    this.line(ax,ay,az,ax,by,az);this.line(bx,ay,az,bx,by,az);
    this.line(ax,ay,bz,ax,by,bz);this.line(bx,ay,bz,bx,by,bz);
  }
  prepare(s,time) {
    if(!s.enabled || !s.debug3D || !s.anchored || !s.tracking) {if(this.enabled)this.clear();return;}
    const started=this.now();this.enabled=true;this.count=0;
    this.groundCount=this.candidateCount=this.cellCount=this.contactCount=this.outsideCount=0;
    const m=s.map,c=m.config,o=m.origin,v=s.volume,p=s.position,n=s.normal;
    this.begin(0);
    // Only the actual reconstructed samples, bounded by the existing 432-point array.
    for(let i=0;i<s.used*3 && i<s.points.length;i+=3){
      const x=s.points[i],y=s.points[i+1],z=s.points[i+2];
      const h=(x-o[0])*n[0]+(y-o[1])*n[1]+(z-o[2])*n[2];
      if(Math.abs(h)<=c.floorTolerance){this.vertex(x,y,z);this.groundCount++;}
    }
    this.end();this.begin(1);
    for(let i=0;i<s.used*3 && i<s.points.length;i+=3){
      const x=s.points[i],y=s.points[i+1],z=s.points[i+2];
      if(m.inRegion(x,y,z)){this.vertex(x,y,z);this.candidateCount++;}
    }
    this.end();this.begin(2);
    let inspected=0;
    for(const cell of m.cells.values()){
      if(inspected++>=256)break;
      if(m.memoryState(cell,time)!=='confirmed' || cell.minY>=v.ground+v.height || cell.maxY<=v.ground+c.floorTolerance)continue;
      if(this.cellCount++>=64){this.cellCount=64;break;}
      this.box((cell.refineAxis===0?cell.contactMin:cell.minX)-c.pointMargin,cell.minY,(cell.refineAxis===2?cell.contactMin:cell.minZ)-c.pointMargin,(cell.refineAxis===0?cell.contactMax:cell.maxX)+c.pointMargin,cell.maxY,(cell.refineAxis===2?cell.contactMax:cell.maxZ)+c.pointMargin);
    }
    this.end();this.begin(3);
    const h=s.probe.history;
    for(let i=0;i<s.probe.count;i++){
      const j=i*7;if(time-h[j+3]>=900 || h[j+1]<=v.ground+c.floorTolerance || h[j+1]>=v.ground+v.height)continue;
      const dx=p[0]-h[j],dz=p[2]-h[j+2],along=Math.max(-h[j+6],Math.min(h[j+6],dx*h[j+4]+dz*h[j+5]));
      if(v.bodyBounds?orientedDepth(v,h[j+1],h[j+1],p[0],p[2],h[j],h[j+2],0,0,s.resolver.skin+c.pointMargin,h[j+4],h[j+5],h[j+6])<=0:Math.hypot(dx-along*h[j+4],dz-along*h[j+5])>=radiusAt(v,h[j+1])+s.resolver.skin+c.pointMargin)continue;
      this.line(h[j]-h[j+4]*h[j+6],h[j+1],h[j+2]-h[j+5]*h[j+6],h[j]+h[j+4]*h[j+6],h[j+1],h[j+2]+h[j+5]*h[j+6]);
      this.contactCount++;
    }
    this.end();this.begin(4);
    for(let band=0;band<12;band++){
      const low=v.ground+band*v.height/12,high=v.ground+(band+1)*v.height/12;
      for(let i=0;i<24;i++){
        const a=i*Math.PI/12,b=(i+1)*Math.PI/12,r=radiusAt(v,(low+high)/2)+s.resolver.skin,q=r;
        this.line(p[0]+Math.cos(a)*r,low,p[2]+Math.sin(a)*r,p[0]+Math.cos(b)*q,low,p[2]+Math.sin(b)*q);
        this.line(p[0]+Math.cos(a)*r,high,p[2]+Math.sin(a)*r,p[0]+Math.cos(b)*q,high,p[2]+Math.sin(b)*q);
        if(i%6===0)this.line(p[0]+Math.cos(a)*r,low,p[2]+Math.sin(a)*r,p[0]+Math.cos(a)*r,high,p[2]+Math.sin(a)*r);
      }
      // Blue constraints of the same conservative query: old circle AND the
      // orientation-dependent body box. They are enclosures, not a model mesh.
      if(v.bodyBounds){const b=v.bodyBounds,j=band*4,k=s.resolver.skin;
        for(let edge=0;edge<4;edge++){
          const next=(edge+1)%4,ax=(edge===0||edge===3?b[j]*v.size-k:b[j+1]*v.size+k),az=(edge<2?b[j+2]*v.size-k:b[j+3]*v.size+k),bx=(next===0||next===3?b[j]*v.size-k:b[j+1]*v.size+k),bz=(next<2?b[j+2]*v.size-k:b[j+3]*v.size+k);
          const x=p[0]+v.poseCos*ax+v.poseSin*az,z=p[2]-v.poseSin*ax+v.poseCos*az,a=p[0]+v.poseCos*bx+v.poseSin*bz,c=p[2]-v.poseSin*bx+v.poseCos*bz;
          this.line(x,low,z,a,low,c);this.line(x,high,z,a,high,c);this.line(x,low,z,x,high,z);
        }
      }
    }
    this.end();this.begin(5);
    // Reference grid on the actual support plane, not an invented terrain mesh.
    const length=Math.hypot(n[0],n[1])||1,ux=n[1]/length,uy=-n[0]/length;
    const vx=-n[2]*uy,vy=n[2]*ux,vz=n[0]*uy-n[1]*ux;
    for(let i=-5;i<=5;i++){
      const d=i*.1;
      this.line(o[0]+ux*d-vx*.5,o[1]+uy*d-vy*.5,o[2]-vz*.5,o[0]+ux*d+vx*.5,o[1]+uy*d+vy*.5,o[2]+vz*.5);
      this.line(o[0]+vx*d-ux*.5,o[1]+vy*d-uy*.5,o[2]+vz*d,o[0]+vx*d+ux*.5,o[1]+vy*d+uy*.5,o[2]+vz*d);
    }
    this.end();
    const e=s.eventCount?s.events[(s.eventCursor+31)%32]:null;
    this.begin(6);
    if(e && time-e.time<1000)this.line(e.previousX,e.previousY,e.previousZ,e.wantedX,e.wantedY,e.wantedZ);
    this.end();this.begin(7);
    if(e && time-e.time<1000)this.line(e.previousX,e.previousY,e.previousZ,e.finalX,e.finalY,e.finalZ);
    this.end();this.begin(8);
    // These real reconstructed endpoints also feed free-ray carving, even when outside
    // the character's obstacle band. Show them separately so rejection is diagnosable.
    for(let i=0;i<s.used*3&&i<s.points.length;i+=3){
      const x=s.points[i],y=s.points[i+1],z=s.points[i+2],height=(x-o[0])*n[0]+(y-o[1])*n[1]+(z-o[2])*n[2];
      if(Math.abs(height)>c.floorTolerance&&!m.inRegion(x,y,z)){this.vertex(x,y,z);this.outsideCount++;}
    }
    this.end();
    for(let index=9;index<=10;index++){
      const state=index===9?'consolidated':'revalidating';
      this.begin(index);inspected=0;
      for(const cell of m.cells.values()){
        if(inspected++>=256||this.cellCount>=64)break;
        if(m.memoryState(cell,time)!==state||cell.minY>=v.ground+v.height||cell.maxY<=v.ground+c.floorTolerance)continue;
        this.cellCount++;this.box((cell.refineAxis===0?cell.contactMin:cell.minX)-c.pointMargin,cell.minY,(cell.refineAxis===2?cell.contactMin:cell.minZ)-c.pointMargin,(cell.refineAxis===0?cell.contactMax:cell.maxX)+c.pointMargin,cell.maxY,(cell.refineAxis===2?cell.contactMax:cell.maxZ)+c.pointMargin);
      }
      this.end();
    }
    this.begin(11);
    for(let i=0;i<m.releaseCount;i++){
      const j=i*5,x=m.released[j],y=m.released[j+1],z=m.released[j+2];
      if(time-m.released[j+3]<1500&&m.stateAt(x,y,z,time)==='free')this.vertex(x,y,z);
    }
    this.end();this.begin(12);
    if(time-m.lastMapBlockTime<10000)for(let i=0;i<m.blockCellCount;i++){
      const cell=m.lastBlockCells[i];if(m.cells.get(cell.key)!==cell||!m.valid(cell,time))continue;
      this.box((cell.refineAxis===0?cell.contactMin:cell.minX)-c.pointMargin,cell.minY,(cell.refineAxis===2?cell.contactMin:cell.minZ)-c.pointMargin,(cell.refineAxis===0?cell.contactMax:cell.maxX)+c.pointMargin,cell.maxY,(cell.refineAxis===2?cell.contactMax:cell.maxZ)+c.pointMargin);
    }
    this.end();this.begin(13);
    if(m.lastContactCell&&m.cells.get(m.lastContactCell.key)===m.lastContactCell&&time-m.lastMapBlockTime<10000)this.vertex(m.contactPoint[0],m.contactPoint[1],m.contactPoint[2]);
    else if(time-s.probe.lastBlockTime<900)this.vertex(s.probe.contactPoint[0],s.probe.contactPoint[1],s.probe.contactPoint[2]);
    this.end();this.buildMs=Math.max(0,this.now()-started);
  }
  draw(){if(!this.enabled)return;const started=this.now();this.engine.drawDebug(this.data,this.groups);this.drawMs=Math.max(0,this.now()-started);}
  snapshot(){return {enabled:this.enabled,vertices:this.count,ground:this.groundCount,candidates:this.candidateCount,outside:this.outsideCount,cells:this.cellCount,contacts:this.contactCount,buildMs:this.buildMs,drawMs:this.drawMs,cpuBytes:this.data.byteLength,gpuBytes:this.engine.debugBuffer?this.data.byteLength:0};}
}
