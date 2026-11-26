import {projectWorld} from './movement-probe.js';

// Bounded scheduling over owned map cells. All depth reads finish in the caller's XRFrame.
// Five distinct native pixels form one observation, never five temporal votes.
export class SpatialRevalidator {
  constructor(now=()=>performance.now()) {
    this.now=now;this.targets=new Array(8);this.scores=new Float64Array(8);
    this.values=new Float64Array(5);this.footprint=new Float64Array(4);this.uv=new Float64Array(3);this.point=new Float64Array(3);this.ids=new Int32Array(5);
    this.clear();
  }
  clear() {
    this.values.fill(0);this.footprint.fill(0);this.targets.fill(null);this.scores.fill(0);this.uv.fill(0);this.point.fill(0);this.ids.fill(-1);
    this.cursor=null;this.count=this.checks=this.queries=this.refreshed=this.freed=this.occluded=this.invalid=this.outside=0;
    this.budget=8;this.fast=0;this.costMs=null;this.stamp=0;
  }
  consider(cell,map,time,position,dx,dz,pose,projection) {
    if(!cell?.confirmed || map.cells.get(cell.key)!==cell || !map.valid(cell,time) || cell.batch===map.batch || time-cell.lastCheck<250 || cell.visit===this.stamp)return;
    cell.visit=this.stamp;
    if(!projectWorld((cell.minX+cell.maxX)/2,(cell.minY+cell.maxY)/2,(cell.minZ+cell.maxZ)/2,pose,projection,this.uv)){cell.lastCheck=time;cell.visibility='outside';cell.revalidationReason='fora da vista';this.outside++;return;}
    const x=(cell.minX+cell.maxX)/2-position[0],z=(cell.minZ+cell.maxZ)/2-position[2];
    const distance=Math.hypot(x,z),n=Math.hypot(dx,dz);
    const score=(time-cell.lastBlocked<2000?20:0)+(cell.freeHits?10:0)+Math.min(5,(time-cell.time)/1000)+3/(1+distance)+(n&&distance?(x*dx+z*dz)/(n*distance):0);
    let i=this.count;
    if(i===this.budget){if(score<=this.scores[i-1])return;i--;}
    else this.count++;
    while(i>0&&score>this.scores[i-1]){this.scores[i]=this.scores[i-1];this.targets[i]=this.targets[i-1];i--;}
    this.scores[i]=score;this.targets[i]=cell;
  }
  update(time,reader,projector,projection,map,position,volume,dx,dz) {
    const started=this.now();this.count=this.checks=this.queries=this.refreshed=this.freed=this.occluded=this.invalid=this.outside=0;this.stamp++;
    // Existing voxel hash supplies nearby/directional candidates without a global search.
    const c=map.config,o=map.origin,s=c.cellSize,n=Math.hypot(dx,dz),px=position[0]+(n?dx/n*.4:0),pz=position[2]+(n?dz/n*.4:0);
    const ix=Math.floor((px-o[0])/s),iz=Math.floor((pz-o[2])/s),low=Math.floor((volume.ground+c.floorTolerance-o[1])/s),high=Math.floor((volume.ground+volume.height-o[1])/s);
    const pose=projector.pose;
    for(let k=0;k<map.blockCellCount;k++)this.consider(map.lastBlockCells[k],map,time,position,dx,dz,pose,projection);
    let scanned=0;
    for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++)for(let y=low;y<=high&&scanned<256;y++){
      scanned++;this.consider(map.cells.get(map.key(ix+a,y,iz+b)),map,time,position,dx,dz,pose,projection);
    }
    // A rotating bounded sweep reaches older cells that have returned to the camera's view.
    for(let i=0,end=Math.min(96,map.cells.size);i<end;i++){
      this.cursor ||= map.cells.values();let next=this.cursor.next();
      if(next.done){this.cursor=map.cells.values();next=this.cursor.next();}
      if(!next.value)break;this.consider(next.value,map,time,position,dx,dz,pose,projection);
    }
    for(let k=0;k<this.count;k++){
      const cell=this.targets[k];this.targets[k]=null;
      if(!map.cells.has(cell.key)||!map.valid(cell,time))continue;
      const x=(cell.minX+cell.maxX)/2,y=(cell.minY+cell.maxY)/2,z=(cell.minZ+cell.maxZ)/2;
      if(!projectWorld(x,y,z,pose,projection,this.uv)){cell.lastCheck=time;cell.visibility='outside';cell.revalidationReason='fora da vista';this.outside++;continue;}
      cell.lastCheck=time;this.checks++;
      const u=this.uv[0],v=this.uv[1],expected=this.uv[2],central=reader.at(u,v,true);this.queries++;
      this.ids.fill(-1);this.ids[0]=reader.lastIndex;this.values[0]=central??0;
      // Conservative projected footprint and furthest axial extent of the actually measured
      // envelope, expanded by the unchanged contact margin. Not a full-voxel surface.
      let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity,far=0,geometry=true;
      for(let a=0;a<8;a++){
        const px=(a&1?cell.maxX:cell.minX)+(a&1?c.pointMargin:-c.pointMargin),py=(a&2?cell.maxY:cell.minY)+(a&2?c.pointMargin:-c.pointMargin),pz=(a&4?cell.maxZ:cell.minZ)+(a&4?c.pointMargin:-c.pointMargin);
        if(!projectWorld(px,py,pz,pose,projection,this.uv)){geometry=false;continue;}
        minU=Math.min(minU,this.uv[0]);maxU=Math.max(maxU,this.uv[0]);minV=Math.min(minV,this.uv[1]);maxV=Math.max(maxV,this.uv[1]);far=Math.max(far,this.uv[2]);
      }
      const du=geometry?Math.max(1/reader.width,(maxU-minU)*.5):1/reader.width,dv=geometry?Math.max(1/reader.height,(maxV-minV)*.5):1/reader.height;
      const exitDepth=far+Math.max(c.pointMargin,expected*.01);
      let beyond=central>exitDepth,legacyFree=central>expected+c.surfaceMargin;
      let valid=central>=.15&&central<=6?1:0,distinct=valid;
      const tolerance=Math.max(.08,(central||expected)*.04);
      for(let i=1;i<5;i++){
        const a=u+(i&1?du:-du),b=v+(i<3?dv:-dv);
        const d=reader.at(a,b,true),id=reader.lastIndex;this.queries++;this.values[i]=d??0;beyond=!!(beyond&&d>exitDepth);legacyFree=!!(legacyFree&&d>expected+c.surfaceMargin);
        let duplicate=false;for(let j=0;j<i;j++)if(this.ids[j]===id)duplicate=true;
        this.ids[i]=id;if(duplicate)continue;distinct++;
        if(d>=.15&&d<=6&&Math.abs(d-central)<=tolerance)valid++;
      }
      cell.footprintVisible=geometry;cell.revalidationSamples=valid;cell.revalidationDistinct=distinct;
      if(!(central>=.15&&central<=6)||valid<3||distinct<3){cell.visibility='invalid';cell.revalidationReason='dados insuficientes';map.resetContrary(cell);this.invalid++;continue;}
      if(central<expected-tolerance){cell.visibility='occluded';cell.revalidationReason='superfície mais próxima';map.resetContrary(cell);map.occludedCount++;this.occluded++;continue;}
      if(!projector.point(u,v,central,this.point)){this.invalid++;continue;}
      if(geometry&&(beyond||legacyFree)){
        cell.revalidationReason=geometry&&beyond?'volume medido atravessado por raios livres':'liberação além da margem legada';
        // This ray passes through the measured centre (not merely an empty corner of its voxel).
        // Query neighbouring pixels above only for coherence; they cannot multiply votes.
        const before=map.cells.has(cell.key);
        map.markFree(cell.ix,cell.iy,cell.iz,'targeted');
        if(before&&!map.cells.has(cell.key))this.freed++;
      } else if(Math.abs(central-expected)<=tolerance){
        cell.revalidationReason='objeto presente ou mudança abaixo da resolução de liberação';
        const before=cell.time;
        map.observe(this.point[0],this.point[1],this.point[2],true);
        if(cell.time===time&&before!==time){this.refreshed++;}
      } else {cell.visibility='ambiguous';cell.revalidationReason=geometry?'evidência contraditória ou liberação parcial':'pegada parcialmente fora da vista';map.resetContrary(cell);}
    }
    this.costMs=Math.max(0,this.now()-started);
    if(this.costMs>2){this.budget=Math.max(2,this.budget-2);this.fast=0;}
    else if(this.costMs<1&&++this.fast>=8){this.budget=Math.min(8,this.budget+1);this.fast=0;}
  }
}
