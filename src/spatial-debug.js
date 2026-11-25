import {radiusAt} from './volume.js';

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
      {color:[.9,.1,1,1]}, {color:[.1,1,1,1]},
      {color:[.55,.55,.55,1],points:true},
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
    for(const cell of m.cells.values()){
      if(!cell.confirmed || time-cell.time>=c.ttl || cell.minY>=v.ground+v.height || cell.maxY<=v.ground+c.floorTolerance)continue;
      if(this.cellCount++>=64){this.cellCount=64;break;}
      this.box(cell.minX-c.pointMargin,cell.minY,cell.minZ-c.pointMargin,cell.maxX+c.pointMargin,cell.maxY,cell.maxZ+c.pointMargin);
    }
    this.end();this.begin(3);
    const h=s.probe.history;
    for(let i=0;i<s.probe.count;i++){
      const j=i*7;if(time-h[j+3]>=900 || h[j+1]<=v.ground+c.floorTolerance || h[j+1]>=v.ground+v.height)continue;
      const dx=p[0]-h[j],dz=p[2]-h[j+2],along=Math.max(-h[j+6],Math.min(h[j+6],dx*h[j+4]+dz*h[j+5]));
      if(Math.hypot(dx-along*h[j+4],dz-along*h[j+5])>=radiusAt(v,h[j+1])+s.resolver.skin+c.pointMargin)continue;
      this.line(h[j]-h[j+4]*h[j+6],h[j+1],h[j+2]-h[j+5]*h[j+6],h[j]+h[j+4]*h[j+6],h[j+1],h[j+2]+h[j+5]*h[j+6]);
      this.contactCount++;
    }
    this.end();this.begin(4);
    for(let band=0;band<12;band++){
      const low=v.ground+band*v.height/12,high=v.ground+(band+1)*v.height/12;
      const r=radiusAt(v,(low+high)/2)+s.resolver.skin;
      for(let i=0;i<24;i++){
        const a=i*Math.PI/12,b=(i+1)*Math.PI/12;
        this.line(p[0]+Math.cos(a)*r,low,p[2]+Math.sin(a)*r,p[0]+Math.cos(b)*r,low,p[2]+Math.sin(b)*r);
        this.line(p[0]+Math.cos(a)*r,high,p[2]+Math.sin(a)*r,p[0]+Math.cos(b)*r,high,p[2]+Math.sin(b)*r);
        if(i%6===0)this.line(p[0]+Math.cos(a)*r,low,p[2]+Math.sin(a)*r,p[0]+Math.cos(a)*r,high,p[2]+Math.sin(a)*r);
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
    if(e && time-e.time<1000)this.line(e.previousX,v.ground+.02,e.previousZ,e.wantedX,v.ground+.02,e.wantedZ);
    this.end();this.begin(7);
    if(e && time-e.time<1000)this.line(e.previousX,v.ground+.02,e.previousZ,e.finalX,v.ground+.02,e.finalZ);
    this.end();this.begin(8);
    // These real reconstructed endpoints also feed free-ray carving, even when outside
    // the character's obstacle band. Show them separately so rejection is diagnosable.
    for(let i=0;i<s.used*3&&i<s.points.length;i+=3){
      const x=s.points[i],y=s.points[i+1],z=s.points[i+2],height=(x-o[0])*n[0]+(y-o[1])*n[1]+(z-o[2])*n[2];
      if(Math.abs(height)>c.floorTolerance&&!m.inRegion(x,y,z)){this.vertex(x,y,z);this.outsideCount++;}
    }
    this.end();this.buildMs=Math.max(0,this.now()-started);
  }
  draw(){if(!this.enabled)return;const started=this.now();this.engine.drawDebug(this.data,this.groups);this.drawMs=Math.max(0,this.now()-started);}
  snapshot(){return {enabled:this.enabled,vertices:this.count,ground:this.groundCount,candidates:this.candidateCount,outside:this.outsideCount,cells:this.cellCount,contacts:this.contactCount,buildMs:this.buildMs,drawMs:this.drawMs,cpuBytes:this.data.byteLength,gpuBytes:this.engine.debugBuffer?this.data.byteLength:0};}
}
