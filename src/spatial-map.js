import {radiusAt} from './volume.js';
import {invert4} from './math.js';

export const SPATIAL_CONFIG = Object.freeze({
  cellSize: .12, radius: 3, floorTolerance: .06, ttl: 5000, candidateTtl: 1000,
  freeTtl: 1500, confirmations: 3, freeConfirmations: 4, occupiedHold: 750, pointMargin: .025, maxCells: 4096,
  maxFreeCells: 8192, maxRaySteps: 96, surfaceMargin: .18,
  consolidatedTtl: 45000, consolidationUpdates: 8, consolidationSpan: 1500,
  independentInterval: 80, revalidateAfter: 5000, freeSpan: 300, contraryWindow: 2000,
});
const finiteMatrix = m => m?.length === 16 && m.every(Number.isFinite);
const median3=(x,y,z)=>x+y+z-Math.min(x,y,z)-Math.max(x,y,z);
const matches = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);

export class DepthProjector {
  constructor() {
    this.inverse = new Float64Array(16);
    this.pose = new Float64Array(16);
    this.scratch = new Float64Array(32);
  }
  configure(info, view) {
    this.valid = false;
    const projection = view?.projectionMatrix, pose = view?.transform?.matrix;
    if (!finiteMatrix(projection) || !finiteMatrix(pose)) return false;
    // Current CPU view-aligned contract; never guess geometry for an unaligned sensor.
    const geometry = info.view || info;
    const ownProjection = geometry.projectionMatrix, ownPose = geometry.transform?.matrix;
    if (('view' in info || 'projectionMatrix' in info || 'transform' in info) && (!finiteMatrix(ownProjection) || !finiteMatrix(ownPose) ||
        !matches(ownProjection, projection) || !matches(ownPose, pose))) return false;
    if (Math.abs(projection[3]) > 1e-6 || Math.abs(projection[7]) > 1e-6 ||
        Math.abs(projection[15]) > 1e-6 || projection[11] >= 0) return false;
    if (Math.abs(pose[3]) + Math.abs(pose[7]) + Math.abs(pose[11]) > 1e-5 || Math.abs(pose[15] - 1) > 1e-5) return false;
    for (let c = 0; c < 3; c++) {
      if (Math.abs(Math.hypot(pose[c * 4], pose[c * 4 + 1], pose[c * 4 + 2]) - 1) > .01) return false;
      for (let d = 0; d < c; d++) if (Math.abs(pose[c * 4] * pose[d * 4] + pose[c * 4 + 1] * pose[d * 4 + 1] + pose[c * 4 + 2] * pose[d * 4 + 2]) > .01) return false;
    }
    const determinant = pose[0] * (pose[5] * pose[10] - pose[9] * pose[6]) - pose[4] * (pose[1] * pose[10] - pose[9] * pose[2]) + pose[8] * (pose[1] * pose[6] - pose[5] * pose[2]);
    if (Math.abs(determinant - 1) > .01) return false;
    if (!invert4(this.inverse, projection, this.scratch)) return false;
    this.pose.set(pose); // Numeric copies, never retain XR objects or native buffers.
    this.valid = true;
    return true;
  }
  point(u, v, axialMeters, out) {
    if (!this.valid || !Number.isFinite(axialMeters) || axialMeters <= 0 || u < 0 || u > 1 || v < 0 || v > 1) return false;
    const m = this.inverse, nx = 2 * u - 1, ny = 1 - 2 * v;
    const x = m[0] * nx + m[4] * ny + m[12], y = m[1] * nx + m[5] * ny + m[13];
    const z = m[2] * nx + m[6] * ny + m[14], w = m[3] * nx + m[7] * ny + m[15];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-10 || z / w >= -1e-8) return false;
    // WebXR depth is axial (-camera Z), not the Euclidean length of a unit ray.
    const cx = -axialMeters * x / z, cy = -axialMeters * y / z, cz = -axialMeters, p = this.pose;
    out[0] = p[0] * cx + p[4] * cy + p[8] * cz + p[12];
    out[1] = p[1] * cx + p[5] * cy + p[9] * cz + p[13];
    out[2] = p[2] * cx + p[6] * cy + p[10] * cz + p[14];
    return Number.isFinite(out[0]) && Number.isFinite(out[1]) && Number.isFinite(out[2]);
  }
  clear() { this.valid = false; this.inverse.fill(0); this.pose.fill(0); }
}

export class SpatialMap {
  constructor(config = {}) {
    this.config = {...SPATIAL_CONFIG, ...config};
    const c = this.config;
    if (!(c.cellSize >= .05 && c.cellSize <= .5 && c.radius > 0 && c.radius <= 10 && c.ttl > 0 && c.ttl <= 10000 &&
      Number.isInteger(c.maxCells) && c.maxCells > 0 && c.maxCells <= 16384 &&
      Number.isInteger(c.maxFreeCells) && c.maxFreeCells > 0 && c.maxFreeCells <= 32768 &&
      Number.isInteger(c.maxRaySteps) && c.maxRaySteps > 0 && c.maxRaySteps <= 256 &&
      Number.isInteger(c.confirmations) && c.confirmations >= 2 && Number.isInteger(c.freeConfirmations) && c.freeConfirmations >= 2 &&
      c.floorTolerance >= 0 && c.floorTolerance < .25 && c.candidateTtl > 0 && c.freeTtl > 0 &&
      c.consolidatedTtl >= c.ttl && c.consolidatedTtl <= 60000 &&
      Number.isInteger(c.consolidationUpdates) && c.consolidationUpdates >= 4 && c.consolidationSpan >= 500 &&
      c.independentInterval >= 50 && c.revalidateAfter > 0 && c.freeSpan >= 200 && c.contraryWindow >= c.freeSpan &&
      c.occupiedHold >= 0 && c.occupiedHold <= c.ttl && c.pointMargin >= 0 && c.pointMargin <= .06)) throw new Error('Invalid spatial limits');
    this.cells = new Map(); this.free = new Map(); this.origin = new Float64Array(3); this.normal = new Float64Array(3);
    this.released = new Float64Array(32*5);this.dirty=new Array(512);this.currentBlockCells=new Array(8);this.contactPoint=new Float64Array(3);this.contactSummary={};
    this.clear();
  }
  clear(origin = null, normal = null) {
    this.dirty.fill(null);this.dirtyCount=0;this.geometryMs=null;this.lastBlockCells ||= new Array(8);this.lastBlockCells.fill(null);this.blockCellCount=0;this.currentBlockCells.fill(null);this.currentBlockCount=0;this.lastMapBlockTime=-Infinity;this.lastContactCell=null;this.contactPoint.fill(0);
    this.cells.clear(); this.free.clear(); this.occupiedCount = 0;
    this.origin.fill(0); if (origin) this.origin.set(origin);
    this.normal.fill(0); this.normal[1] = 1; if (normal) this.normal.set(normal);
    this.ready = !!origin; this.batch = 0; this.saturated = false;
    this.cellCursor=this.freeCursor=this.evictionCursor=null;this.lastMaintenance=-Infinity;
    this.expiredCount=this.releasedCount=this.evictedCount=this.rejectedCount=this.occludedCount=this.revalidatedCount=0;
    this.createdCount=0;this.evictionChecks=0;this.releaseCursor=this.releaseCount=0;this.released.fill(0);this.maintenanceMs=null;
    this.statsAt=-Infinity;this.statsCache=null;this.camera=null;
    this.ground?.clear();
  }
  key(ix, iy, iz) {
    if (ix < -32768 || ix > 32767 || iz < -32768 || iz > 32767 || iy < -128 || iy > 127) return -1;
    return (ix + 32768) * 16777216 + (iz + 32768) * 256 + iy + 128;
  }
  begin(time, position, height, camera = null) {
    this.finishGeometry();this.time = time; this.batch++; this.centerX = position[0]; this.centerZ = position[2]; this.height = height;
    this.evictionChecks=0;this.saturated = false; this.camera=camera; this.maintain(time);
  }
  retention(cell) { return cell.confirmed ? cell.consolidated ? this.config.consolidatedTtl : this.config.ttl : this.config.candidateTtl; }
  valid(cell,time) { return !!cell && time-cell.time<this.retention(cell); }
  memoryState(cell,time) {
    if(!this.valid(cell,time))return 'unknown';
    if(!cell.confirmed)return 'candidate';
    if(cell.freeHits || cell.consolidated&&time-cell.time>=this.config.revalidateAfter)return 'revalidating';
    return cell.consolidated?'consolidated':'confirmed';
  }
  remove(cell,reason) {
    if(!this.cells.delete(cell.key))return;cell.removalReason=reason;
    if(cell.confirmed)this.occupiedCount--;
    this.statsAt=-Infinity;
    if(reason==='free') {
      this.releasedCount++;
      const j=this.releaseCursor*5;
      this.released[j]=(cell.minX+cell.maxX)/2;this.released[j+1]=(cell.minY+cell.maxY)/2;this.released[j+2]=(cell.minZ+cell.maxZ)/2;this.released[j+3]=this.time;this.released[j+4]=cell.key;
      this.releaseCursor=(this.releaseCursor+1)%32;this.releaseCount=Math.min(32,this.releaseCount+1);
      this.onRelease?.(cell);
    } else {this.free.delete(cell.key);if(reason==='expired')this.expiredCount++;else this.evictedCount++;}
  }
  expire(time,limit=Infinity) {
    const n=Math.min(this.cells.size,limit);
    for(let i=0;i<n;i++){
      this.cellCursor ||= this.cells.values();let next=this.cellCursor.next();
      if(next.done){this.cellCursor=this.cells.values();next=this.cellCursor.next();}
      const cell=next.value;if(!cell)break;
      if(!this.valid(cell,time))this.remove(cell,'expired');
    }
    const k=Math.min(this.free.size,limit===Infinity?Infinity:limit*2);
    for(let i=0;i<k;i++){
      this.freeCursor ||= this.free.values();let next=this.freeCursor.next();
      if(next.done){this.freeCursor=this.free.values();next=this.freeCursor.next();}
      if(!next.value)break;
      if(time-next.value.time>=this.config.freeTtl)this.free.delete(next.value.key);
    }
  }
  maintain(time) {
    if(time-this.lastMaintenance<125)return;
    const started=performance.now();this.lastMaintenance=time;this.expire(time,128);this.maintenanceMs=performance.now()-started;
  }
  makeRoom() {
    if(this.cells.size<this.config.maxCells)return true;
    this.saturated=true;let victim=null,lowest=1;
    for(let i=0,n=Math.min(64,this.cells.size,256-this.evictionChecks);i<n;i++){
      this.evictionChecks++;
      this.evictionCursor ||= this.cells.values();let next=this.evictionCursor.next();
      if(next.done){this.evictionCursor=this.cells.values();next=this.evictionCursor.next();}
      const cell=next.value;if(!cell)break;if(cell.batch===this.batch)continue;
      const distance=Math.hypot((cell.minX+cell.maxX)/2-this.centerX,(cell.minZ+cell.maxZ)/2-this.centerZ);
      const age=Math.max(0,this.time-cell.time),score=!this.valid(cell,this.time)?-10:distance>this.config.radius?-2+(cell.consolidated?.2:0):(cell.consolidated?4:cell.confirmed?2:0)+1-distance/this.config.radius-age/this.retention(cell);
      if(score<lowest){lowest=score;victim=cell;}
    }
    if(victim){this.remove(victim,'capacity');return true;}
    this.rejectedCount++;return false;
  }
  stats(time) {
    if(this.statsCache&&time-this.statsAt<250)return this.statsCache;
    const out=this.statsCache ||= {};let candidates=0,confirmed=0,consolidated=0,awaiting=0,occluded=0,oldest=0,maxViewpointSpan=0;
    for(const cell of this.cells.values()){
      if(!this.valid(cell,time))continue;
      if(!cell.confirmed){candidates++;continue;}
      confirmed++;maxViewpointSpan=Math.max(maxViewpointSpan,cell.viewpointSpan);if(cell.consolidated)consolidated++;if(this.memoryState(cell,time)==='revalidating')awaiting++;
      if(cell.visibility==='occluded')occluded++;oldest=Math.max(oldest,time-cell.time);
    }
    Object.assign(out,{candidates,confirmed,consolidated,awaiting,occluded,maxViewpointSpan,oldestAgeMs:confirmed?oldest:null,revalidated:this.revalidatedCount,released:this.releasedCount,expired:this.expiredCount,evicted:this.evictedCount,rejected:this.rejectedCount,occlusionObservations:this.occludedCount,saturated:this.saturated,maintenanceMs:this.maintenanceMs});
    this.statsAt=time;return out;
  }
  inRegion(x, y, z) {
    return this.ready && (x - this.centerX) ** 2 + (z - this.centerZ) ** 2 <= this.config.radius ** 2 &&
      y > this.origin[1] && y <= this.origin[1] + this.height &&
      (x - this.origin[0]) * this.normal[0] + (y - this.origin[1]) * this.normal[1] + (z - this.origin[2]) * this.normal[2] > this.config.floorTolerance && !this.ground?.isMeasuredFloor(x,y,z);
  }
  observeGround(x,y,z){
    if(!this.ground?.isFloor(x,y,z))return;
    const s=this.config.cellSize,o=this.origin,ix=Math.floor((x-o[0])/s),iy=Math.floor((y-o[1])/s),iz=Math.floor((z-o[2])/s),cell=this.cells.get(this.key(ix,iy,iz));
    if(cell&&this.ground.boundsAreFloor(cell)){cell.revalidationReason='current anchored ground observations';this.markFree(ix,iy,iz,'targeted');}
  }
  observe(x, y, z, retained = false, source='surface-depth') {
    if (!Number.isFinite(x + y + z)) return false;
    const s = this.config.cellSize, o = this.origin;
    const ix = Math.floor((x - o[0]) / s), iy = Math.floor((y - o[1]) / s), iz = Math.floor((z - o[2]) / s), key = this.key(ix, iy, iz);
    if (key < 0) return false;
    let cell = this.cells.get(key);
    if(retained&&cell&&this.ground?.boundsAreFloor(cell)&&this.ground.isMeasuredFloor(x,y,z))return false;
    if(!this.inRegion(x,y,z) && !(retained && cell?.confirmed && this.valid(cell,this.time)))return false;
    if(cell&&!this.valid(cell,this.time)){this.remove(cell,'expired');cell=null;}
    if (!cell) {
      if (!this.makeRoom()) return false;
      cell = {id:this.createdCount+1,key, ix, iy, iz, source, firstX:x, firstZ:z, tangentX:0, tangentZ:0, span:0, planar:true, minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z,
        recent:new Float64Array(24),geometrySlot:-1,geometryCount:0,geometryDirty:false,refineAxis:-1,contactMin:0,contactMax:0,lastBlocked:-Infinity,
        hits: 0, time: this.time, firstSeen: this.time, lastIndependent:-Infinity, observations:0, consistentUpdates:0, consolidated:false, viewpointSpan:0, cameraX:this.camera?.[12]??null, cameraY:this.camera?.[13]??null, cameraZ:this.camera?.[14]??null, visibility:null, lastCheck:-Infinity, firstFree:0, lastFree:-Infinity, rayHits:0, directHits:0, directFirst:0, directLast:-Infinity, directBatch:-1, batch: -1, confirmed: false, freeHits: 0, freeBatch: -1};
      this.cells.set(key, cell);this.createdCount++;
    }
    if(cell.source!==source)cell.source='mixed-depth';
    if (cell.batch !== this.batch) {
      if(this.time-cell.time>=this.config.candidateTtl)cell.geometryCount=0;
      cell.geometrySlot=(cell.geometrySlot+1)%3;cell.geometryCount=Math.min(3,cell.geometryCount+1);
      const j=cell.geometrySlot*8;cell.recent[j]=cell.recent[j+3]=x;cell.recent[j+1]=cell.recent[j+4]=y;cell.recent[j+2]=cell.recent[j+5]=z;cell.recent[j+6]=cell.recent[j+7]=0;
      if(!cell.geometryDirty&&this.dirtyCount<512){cell.geometryDirty=true;this.dirty[this.dirtyCount++]=cell;}
      cell.hits = this.time - cell.time < this.config.candidateTtl ? Math.min(this.config.confirmations, cell.hits + 1) : 1;
      if(this.time-cell.lastIndependent>=this.config.independentInterval){
        const gap=Math.hypot(Math.max(cell.minX-x,0,x-cell.maxX),Math.max(cell.minY-y,0,y-cell.maxY),Math.max(cell.minZ-z,0,z-cell.maxZ));
        cell.observations=Math.min(65535,cell.observations+1);cell.consistentUpdates=gap<=this.config.pointMargin?Math.min(65535,cell.consistentUpdates+1):1;cell.lastIndependent=this.time;
      }
      if(cell.confirmed && this.time>cell.time)this.revalidatedCount++;
      cell.batch = this.batch; cell.time = this.time;this.resetContrary(cell);cell.visibility='observed';
      if(this.camera && cell.cameraX!==null)cell.viewpointSpan=Math.max(cell.viewpointSpan,Math.hypot(this.camera[12]-cell.cameraX,this.camera[13]-cell.cameraY,this.camera[14]-cell.cameraZ));
      if(cell.observations>=this.config.consolidationUpdates && cell.consistentUpdates>=6 && this.time-cell.firstSeen>=this.config.consolidationSpan)cell.consolidated=true;
      this.statsAt=-Infinity;
      // Keep the observed envelope across viewpoints until this cell expires/is reliably cleared.
      if (!cell.confirmed && cell.hits >= this.config.confirmations) { cell.confirmed = true; this.occupiedCount++; }
    }
    cell.minX = Math.min(cell.minX, x); cell.maxX = Math.max(cell.maxX, x);
    cell.minY = Math.min(cell.minY, y); cell.maxY = Math.max(cell.maxY, y);
    cell.minZ = Math.min(cell.minZ, z); cell.maxZ = Math.max(cell.maxZ, z);
    const vx=x-cell.firstX,vz=z-cell.firstZ,span=Math.hypot(vx,vz);
    if(cell.span && Math.abs(vx*cell.tangentZ-vz*cell.tangentX)>this.config.pointMargin) cell.planar=false;
    if(span>cell.span){cell.span=span;cell.tangentX=vx/span;cell.tangentZ=vz/span;}
    const j=cell.geometrySlot*8,g=cell.recent;
    g[j]=Math.min(g[j],x);g[j+1]=Math.min(g[j+1],y);g[j+2]=Math.min(g[j+2],z);
    g[j+3]=Math.max(g[j+3],x);g[j+4]=Math.max(g[j+4],y);g[j+5]=Math.max(g[j+5],z);
    g[j+6]|=1<<Math.min(3,Math.max(0,Math.floor(((x-o[0])/s-ix)*4)));
    g[j+7]|=1<<Math.min(3,Math.max(0,Math.floor(((z-o[2])/s-iz)*4)));
    this.free.delete(key);
    return true;
  }
  finishGeometry() {
    if(!this.dirtyCount)return;
    const started=performance.now(),margin=this.config.pointMargin;
    for(let i=0;i<this.dirtyCount;i++){
      const c=this.dirty[i];this.dirty[i]=null;c.geometryDirty=false;
      if(!this.cells.has(c.key))continue;
      const g=c.recent,j=c.geometrySlot*8,axis=c.refineAxis;
      if(axis>=0 && (g[j+axis]<c.contactMin-margin||g[j+axis+3]>c.contactMax+margin))c.refineAxis=-1;
      if(c.geometryCount<3)continue;
      for(let a=0;a<=2;a+=2){
        const mask=a===0?7:6;
        let stable=true,low=Infinity,high=-Infinity;
        for(let k=0;k<24;k+=8){
          if(g[k+mask]!==15||g[k+a+3]-g[k+a]>margin){stable=false;break;}
          low=Math.min(low,(g[k+a]+g[k+a+3])/2);high=Math.max(high,(g[k+a]+g[k+a+3])/2);
        }
        if(!stable||high-low>margin)continue;
        c.refineAxis=a;c.contactMin=median3(g[a],g[8+a],g[16+a]);c.contactMax=median3(g[a+3],g[11+a],g[19+a]);
        break;
      }
    }
    this.dirtyCount=0;this.geometryMs=performance.now()-started;
  }
  commitBlock(x,z,volume,time,skin){
    this.blockCellCount=this.currentBlockCount;this.lastBlockCells.fill(null);this.lastMapBlockTime=time;
    for(let i=0;i<this.blockCellCount;i++)this.lastBlockCells[i]=this.currentBlockCells[i];
    let best=Infinity,chosen=null;
    for(let i=0;i<this.blockCellCount;i++){
      const cell=this.lastBlockCells[i];if(this.cells.get(cell.key)!==cell||!this.valid(cell,time))continue;
      const minX=cell.refineAxis===0?cell.contactMin:cell.minX,maxX=cell.refineAxis===0?cell.contactMax:cell.maxX,minZ=cell.refineAxis===2?cell.contactMin:cell.minZ,maxZ=cell.refineAxis===2?cell.contactMax:cell.maxZ;
      const px=Math.max(minX,Math.min(maxX,x)),pz=Math.max(minZ,Math.min(maxZ,z)),distance=Math.hypot(x-px,z-pz),radius=radiusAt(volume,cell.minY,cell.maxY),gap=distance-radius;
      if(gap<best){best=gap;chosen=cell;Object.assign(this.contactSummary,{cellId:cell.id,surfaceDistance:distance,volumeRadius:radius,clearance:gap,pointMargin:this.config.pointMargin,skin,ageMs:time-cell.time,state:this.memoryState(cell,time),visibility:cell.visibility,freeEvidence:cell.freeHits,reason:cell.revalidationReason??null,refined:cell.refineAxis>=0});this.contactPoint[0]=px;this.contactPoint[1]=(cell.minY+cell.maxY)/2;this.contactPoint[2]=pz;}
    }
    this.lastContactCell=chosen;return chosen?this.contactSummary:null;
  }
  blockedDetails(time){
    const out=[];
    const o=this.origin,n=this.normal;
    for(let i=0;i<this.blockCellCount;i++){const cell=this.lastBlockCells[i];out.push({id:cell.id,source:cell.source??'surface-depth',minHeightAboveSupport:((n[0]>=0?cell.minX:cell.maxX)-o[0])*n[0]+((n[1]>=0?cell.minY:cell.maxY)-o[1])*n[1]+((n[2]>=0?cell.minZ:cell.maxZ)-o[2])*n[2],maxHeightAboveSupport:((n[0]>=0?cell.maxX:cell.minX)-o[0])*n[0]+((n[1]>=0?cell.maxY:cell.minY)-o[1])*n[1]+((n[2]>=0?cell.maxZ:cell.minZ)-o[2])*n[2],lastCheckAgeMs:Number.isFinite(cell.lastCheck)?Math.max(0,time-cell.lastCheck):null,state:this.cells.get(cell.key)===cell?this.memoryState(cell,time):'removed',ageMs:Math.max(0,time-cell.time),freeEvidence:cell.freeHits,reason:cell.removalReason||cell.revalidationReason||cell.visibility||'indisponível',refined:cell.refineAxis>=0});}
    return out;
  }
  noteBlocked(x,z,volume,time,skin) {
    this.captureBlock=true;this.penetration(x,z,volume,time,skin);this.captureBlock=false;
  }
  resetContrary(cell){cell.freeHits=cell.rayHits=cell.directHits=0;cell.lastFree=cell.directLast=-Infinity;}
  markFree(ix, iy, iz, reliable = false) {
    const c = this.config, s = c.cellSize, o = this.origin;
    const key = this.key(ix, iy, iz); if (key < 0) return;
    const cell = this.cells.get(key);
    if (!this.inRegion(o[0] + (ix + .5) * s, o[1] + (iy + .5) * s, o[2] + (iz + .5) * s) && !(reliable==='targeted' && cell?.confirmed && this.valid(cell,this.time))) return;
    if (cell?.batch === this.batch) return;
    let known = this.free.get(key);
    if (!known) {
      if (this.free.size >= c.maxFreeCells) { this.saturated = true;this.free.delete(this.free.keys().next().value);this.evictedCount++; }
      known = {key, time: this.time, batch: -1, hits: 0}; this.free.set(key, known);
    }
    if (known.batch !== this.batch) {
      known.batch = this.batch; known.time = this.time; known.hits = Math.min(c.freeConfirmations, known.hits + 1);
    }
    // A grazing ray is weak evidence: it may cover empty space in an occupied voxel.
    // Only central, unobstructed observations after the hold period can erase occupancy.
    if(cell&&reliable&&this.time-cell.time>=c.occupiedHold){
      if(reliable==='targeted'){
        if(cell.directBatch===this.batch||this.time-cell.directLast<c.independentInterval)return;
        if(this.time-cell.directLast>c.contraryWindow){cell.directHits=0;cell.directFirst=this.time;}
        cell.directHits++;cell.directLast=this.time;cell.directBatch=this.batch;
      }else{
        if(cell.freeBatch===this.batch||this.time-cell.lastFree<c.independentInterval)return;
        if(this.time-cell.lastFree>c.contraryWindow||cell.freeBatch!==this.batch-1){cell.rayHits=0;cell.firstFree=this.time;}
        cell.rayHits++;cell.lastFree=this.time;cell.freeBatch=this.batch;
      }
      cell.freeHits=Math.max(cell.rayHits,cell.directHits);cell.visibility='contradictory';this.statsAt=-Infinity;
      const cleared=cell.rayHits>=c.freeConfirmations&&this.time-cell.firstFree>=c.freeSpan||cell.directHits>=c.freeConfirmations&&this.time-cell.directFirst>=c.freeSpan;
      if(cleared)this.remove(cell,'free');
    }
  }

  traceFree(cx, cy, cz, x, y, z) {
    const s = this.config.cellSize, o = this.origin;
    const length = Math.hypot(x - cx, y - cy, z - cz), limit = length - this.config.surfaceMargin;
    if (!(limit > 0)) return;
    const dx = (x - cx) / length, dy = (y - cy) / length, dz = (z - cz) / length;
    let ix = Math.floor((cx - o[0]) / s), iy = Math.floor((cy - o[1]) / s), iz = Math.floor((cz - o[2]) / s);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    let tx = sx ? (o[0] + (ix + (sx > 0 ? 1 : 0)) * s - cx) / dx : Infinity;
    let ty = sy ? (o[1] + (iy + (sy > 0 ? 1 : 0)) * s - cy) / dy : Infinity;
    let tz = sz ? (o[2] + (iz + (sz > 0 ? 1 : 0)) * s - cz) / dz : Infinity;
    const ax = sx ? s / Math.abs(dx) : Infinity, ay = sy ? s / Math.abs(dy) : Infinity, az = sz ? s / Math.abs(dz) : Infinity;
    for (let steps = 0, distance = 0; steps < this.config.maxRaySteps && distance < limit; steps++) {
      const cell = this.cells.get(this.key(ix, iy, iz));
      let reliable = false;
      if (cell) {
        const px = (cell.minX + cell.maxX) / 2, py = (cell.minY + cell.maxY) / 2, pz = (cell.minZ + cell.maxZ) / 2;
        const along = (px - cx) * dx + (py - cy) * dy + (pz - cz) * dz;
        const error = (px - cx - along * dx) ** 2 + (py - cy - along * dy) ** 2 + (pz - cz - along * dz) ** 2;
        reliable = along > 0 && along < limit && error <= .035 ** 2;
      }
      this.markFree(ix, iy, iz, reliable);
      if (tx <= ty && tx <= tz) { distance = tx; tx += ax; ix += sx; }
      else if (ty <= tz) { distance = ty; ty += ay; iy += sy; }
      else { distance = tz; tz += az; iz += sz; }
    }
  }
  stateAt(x, y, z, time) {
    const s = this.config.cellSize, o = this.origin;
    const key = this.key(Math.floor((x - o[0]) / s), Math.floor((y - o[1]) / s), Math.floor((z - o[2]) / s));
    const cell = this.cells.get(key);
    if (cell?.confirmed && this.valid(cell,time)) return 'occupied';
    const free = this.free.get(key);
    return free && free.hits >= this.config.freeConfirmations && time - free.time < this.config.freeTtl && !cell ? 'free' : 'unknown';
  }
  coverage(x, z, volume, time) {
    let known = 0;
    for (let level = 0; level < 3; level++) for (let side = 0; side < 5; side++) {
      const px = x + (side === 1 ? volume.radius * .6 : side === 2 ? -volume.radius * .6 : 0);
      const pz = z + (side === 3 ? volume.radius * .6 : side === 4 ? -volume.radius * .6 : 0);
      const y = volume.ground + this.config.floorTolerance + (volume.height - this.config.floorTolerance) * (level + .5) / 3;
      if (this.stateAt(px, y, pz, time) !== 'unknown') known++;
    }
    return known / 15;
  }
  collides(x, z, volume, time, skin = .015) { return this.penetration(x, z, volume, time, skin) > 0; }
  allowsMove(x,z,nx,nz,volume,time,skin,escape=false) {
    this.motion=true;this.fromX=x;this.fromZ=z;this.escape=escape;this.interiorEscape=escape&&this.interiorAt(x,z,volume,time);this.motionAllowed=true;this.motionReason=null;this.motionBefore=this.motionAfter=this.motionDistance=null;
    this.penetration(nx,nz,volume,time,skin);this.motion=false;return this.motionAllowed;
  }
  interiorAt(x,z,volume,time){
    const c=this.config,s=c.cellSize,o=this.origin,ix=Math.floor((x-o[0])/s),iz=Math.floor((z-o[2])/s);
    for(let a=ix-1;a<=ix+1;a++)for(let b=iz-1;b<=iz+1;b++)for(let y=Math.floor((volume.ground+c.floorTolerance-o[1])/s);y<=Math.floor((volume.ground+volume.height-o[1])/s);y++){
      const cell=this.cells.get(this.key(a,y,b));
      if(cell?.confirmed&&!cell.planar&&this.valid(cell,time)&&cell.maxX-cell.minX>1e-6&&cell.maxZ-cell.minZ>1e-6&&x>=cell.minX-1e-8&&x<=cell.maxX+1e-8&&z>=cell.minZ-1e-8&&z<=cell.maxZ+1e-8)return true;
    }
    return false;
  }
  penetration(x, z, volume, time, skin = .015) {
    this.finishGeometry();this.contactTime = -Infinity;
    if (!this.ready) return 0;
    const c = this.config, s = c.cellSize, o = this.origin, r = volume.radius + skin;
    let overlap = 0;
    const minX = Math.floor((x - r - c.pointMargin - o[0]) / s), maxX = Math.floor((x + r + c.pointMargin - o[0]) / s);
    const minZ = Math.floor((z - r - c.pointMargin - o[2]) / s), maxZ = Math.floor((z + r + c.pointMargin - o[2]) / s);
    const minY = Math.floor((volume.ground + c.floorTolerance - o[1]) / s), maxY = Math.floor((volume.ground + volume.height - o[1]) / s);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const lowX = o[0] + ix * s, lowZ = o[2] + iz * s;
      const dx = Math.max(lowX - c.pointMargin - x, 0, x - lowX - s - c.pointMargin), dz = Math.max(lowZ - c.pointMargin - z, 0, z - lowZ - s - c.pointMargin);
      if (dx * dx + dz * dz >= r * r - 1e-10) continue;
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.cells.get(this.key(ix, iy, iz));
        if (cell?.confirmed && this.valid(cell,time) && cell.minY < volume.ground + volume.height && cell.maxY > volume.ground + c.floorTolerance) {
          // Refine the broad-phase voxel with measured extents, avoiding up to 12 cm of artificial wall thickness.
          const minX=cell.refineAxis===0?cell.contactMin:cell.minX,maxX=cell.refineAxis===0?cell.contactMax:cell.maxX,minZ=cell.refineAxis===2?cell.contactMin:cell.minZ,maxZ=cell.refineAxis===2?cell.contactMax:cell.maxZ;
          const ax = minX - c.pointMargin, bx = maxX + c.pointMargin;
          const az = minZ - c.pointMargin, bz = maxZ + c.pointMargin;
          const ex = Math.max(ax - x, 0, x - bx), ez = Math.max(az - z, 0, z - bz);
          const distance = Math.hypot(ex, ez);
          const inside = !distance ? Math.min(x - ax, bx - x, z - az, bz - z) : 0;
          const depth = radiusAt(volume,cell.minY,cell.maxY) + skin - distance + inside;
          if(this.captureBlock && depth>0){
            cell.lastBlocked=time;
            let found=false;for(let k=0;k<this.currentBlockCount;k++)if(this.currentBlockCells[k]===cell)found=true;
            if(!found&&this.currentBlockCount<8)this.currentBlockCells[this.currentBlockCount++]=cell;
            this.lastSurfaceDistance=Math.hypot(Math.max(minX-x,0,x-maxX),Math.max(minZ-z,0,z-maxZ));this.lastVolumeRadius=radiusAt(volume,cell.minY,cell.maxY);this.lastClearance=this.lastSurfaceDistance-this.lastVolumeRadius;this.lastContactCell=cell;
          }
          if(this.motion && depth>0) {
            const ex0=Math.max(ax-this.fromX,0,this.fromX-bx),ez0=Math.max(az-this.fromZ,0,this.fromZ-bz);
            const distance0=Math.hypot(ex0,ez0),inside0=!distance0?Math.min(this.fromX-ax,bx-this.fromX,this.fromZ-az,bz-this.fromZ):0;
            let before=radiusAt(volume,cell.minY,cell.maxY)+skin-distance0+inside0,after=depth;
            let crossing=false;
            if(cell.refineAxis>=0 || cell.planar && cell.span>1e-6) {
              // Signed distance to the measured local surface, allowing its tangent even
              // when the footprint starts overlapping several adjacent samples.
              const r0=radiusAt(volume,cell.minY,cell.maxY)+skin+c.pointMargin;
              const fx=cell.refineAxis===0?(cell.contactMin+cell.contactMax)/2:cell.firstX,fz=cell.refineAxis===2?(cell.contactMin+cell.contactMax)/2:cell.firstZ,tx=cell.refineAxis===2?1:cell.refineAxis===0?0:cell.tangentX,tz=cell.refineAxis===0?1:cell.refineAxis===2?0:cell.tangentZ;
              const fromSide=(this.fromX-fx)*tz-(this.fromZ-fz)*tx,toSide=(x-fx)*tz-(z-fz)*tx;
              crossing=Math.abs(fromSide)>1e-8&&fromSide*toSide<0;
              if(!this.escape){before=r0-Math.abs(fromSide);after=r0-Math.abs(toSide);}
            }
            const gx=this.fromX-Math.max(cell.minX,Math.min(cell.maxX,this.fromX)),gz=this.fromZ-Math.max(cell.minZ,Math.min(cell.maxZ,this.fromZ));
            const closing=(cell.refineAxis<0&&(!cell.planar||cell.span<=1e-6))&&(gx*(x-this.fromX)+gz*(z-this.fromZ)) < -1e-10;
            if(((crossing||closing)&&!this.interiorEscape) || (this.escape ? before<=0 : after>Math.max(0,before)+1e-8)){this.motionAllowed=false;this.motionReason=crossing?'crossed-contact-plane':closing?'closing-measured-contact':this.escape?'new-contact-during-escape':'contact-worsening';this.motionBefore=before;this.motionAfter=after;this.motionDistance=distance;}
          }
          overlap = Math.max(overlap, depth);
          if (depth > 0) this.contactTime = Math.max(this.contactTime, cell.time);
        }
      }
    }
    return Math.max(0, overlap);
  }
}
