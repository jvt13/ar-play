import {radiusAt} from './volume.js';
// Bounded, movement-directed depth evidence. Only derived world points survive XRFrame.
// Evidence strength counts supporting samples; it is NOT a sensor confidence/precision score.
export function projectWorld(x,y,z,pose,projection,out) {
    const dx = x - pose[12], dy = y - pose[13], dz = z - pose[14];
    const cx = pose[0] * dx + pose[1] * dy + pose[2] * dz;
    const cy = pose[4] * dx + pose[5] * dy + pose[6] * dz;
    const cz = pose[8] * dx + pose[9] * dy + pose[10] * dz;
    const w = projection[3] * cx + projection[7] * cy + projection[11] * cz + projection[15];
    if (cz >= -.15 || w <= 0) return false;
    out[0] = ((projection[0] * cx + projection[4] * cy + projection[8] * cz + projection[12]) / w + 1) / 2;
    out[1] = (1 - (projection[1] * cx + projection[5] * cy + projection[9] * cz + projection[13]) / w) / 2;
    out[2]=-cz;
    return out[0] >= 0 && out[0] <= 1 && out[1] >= 0 && out[1] <= 1;
}

export class MovementProbe {
  constructor(config) {
    this.config = config;
    this.samples = new Float64Array(75 * 3); this.ids = new Int32Array(75);
    this.coherent = new Uint8Array(75);
    this.history = new Float64Array(128 * 7); this.point = new Float64Array(3);
    this.contactPoint=new Float64Array(3);this.contactSummary={};this.clear();
  }
  clear() {
    this.contactPoint.fill(0);this.lastBlockTime=-Infinity;
    this.samples.fill(0); this.ids.fill(-1); this.history.fill(0); this.point.fill(0);
    this.coherent.fill(0); this.sampleCount = 0;
    this.count = this.used = this.tested = this.valid = this.support = 0;
    this.projected = this.withDepth = this.distinct = this.inRegionCount = 0;
    this.rejectDepth = this.rejectDuplicate = this.rejectGeometry = 0;
    this.inactiveReason = 'inativa'; this.outOfView = false;
    this.acquiredTime = this.lastUpdate = this.lastConfirmation = -Infinity; this.costMs = null;
    this.contactTime = -Infinity;this.directionX=this.directionZ=null;
  }
  // Rigid inverse pose, followed by the actual (possibly asymmetric) view projection.
  project(x, y, z, pose, projection, out) {
    return projectWorld(x,y,z,pose,projection,out);
  }
  update(time, reader, projector, projection, position, volume, dx, dz, map) {
    this.acquiredTime = this.lastUpdate = time; this.used = this.tested = this.valid = this.support = 0;
    this.coherent.fill(0); this.sampleCount = 0;
    this.projected = this.withDepth = this.distinct = this.inRegionCount = 0;
    this.rejectDepth = this.rejectDuplicate = this.rejectGeometry = 0; this.outOfView = false;
    const length = Math.hypot(dx, dz); if (length < 1e-8 || !projector.valid) { this.inactiveReason = 'inativa'; return; }
    this.inactiveReason = '';
    dx /= length; dz /= length;this.directionX=dx;this.directionZ=dz;
    let count = 0;
    const radius = volume.radius, reach = radius + .85, low = map.config.floorTolerance;
    // Five transverse tracks include both cylinder edges and its centre; three heights
    // cover low furniture and the body while remaining below the existing vertical envelope.
    for (let forward = 0; forward < 5; forward++) for (let side = 0; side < 5; side++) for (let level = 0; level < 3; level++) {
      this.tested++;
      const along = .08 + forward * (reach - .08) / 4;
      const across = (side - 2) * radius * .5;
      const wx = position[0] + dx * along - dz * across, wz = position[2] + dz * along + dx * across;
      const wy = volume.ground + low + (volume.height - low) * (.10 + level * .34);
      if (!this.project(wx, wy, wz, projector.pose, projection, this.point)) { this.outOfView = true; continue; }
      this.projected++;
      const u = this.point[0], v = this.point[1], depth = reader.at(u, v, true), id = reader.lastIndex;
      if (!(depth >= .15 && depth <= 6)) { this.rejectDepth++; continue; }
      this.valid++;
      this.withDepth++;
      // Repeated queries of one native pixel cannot manufacture independent evidence.
      let duplicate = false;
      for (let i = 0; i < count; i++) if (this.ids[i] === id) { duplicate = true; break; }
      if (duplicate) { this.rejectDuplicate++; continue; }
      this.distinct++;
      if (!projector.point(u, v, depth, this.point)) { this.rejectGeometry++; continue; }
      const x = this.point[0], y = this.point[1], z = this.point[2];
      const px = x - position[0], pz = z - position[2], a = px * dx + pz * dz, b = -px * dz + pz * dx;
      if (a < -radius * .2 || a > reach || Math.abs(b) > radius + .04 || !map.inRegion(x, y, z)) { this.rejectGeometry++; continue; }
      this.inRegionCount++;
      this.ids[count] = id; this.samples.set(this.point, count * 3); count++;
    }
    this.sampleCount = count;
    // A spatially coherent cluster of at least three distinct native pixels is immediate evidence.
    // No historical voxel confirmations are required, but isolated returns never block movement.
    for (let i = 0; i < count; i++) {
      const a = i * 3, x = this.samples[a], y = this.samples[a + 1], z = this.samples[a + 2];
      let neighbors = 0, tangent = -1, longest = 0;
      for (let j = 0; j < count; j++) {
        const b = j * 3, distance = Math.hypot(x - this.samples[b], y - this.samples[b + 1], z - this.samples[b + 2]);
        if (distance <= .26) neighbors++;
        const horizontal = Math.hypot(x - this.samples[b], z - this.samples[b + 2]);
        if (distance <= .26 && Math.abs(y - this.samples[b + 1]) < .12 && horizontal > longest) {
          longest = horizontal; tangent = b;
        }
      }
      if (neighbors < 3) continue;
      this.coherent[i] = 1;
      this.support = Math.max(this.support, neighbors); this.used++;
      // Join measured neighbors into a short surface segment. Point discs alone produce
      // a scalloped wall and can falsely resist tangential escape from initial overlap.
      const px = tangent >= 0 ? (x + this.samples[tangent]) / 2 : x;
      const pz = tangent >= 0 ? (z + this.samples[tangent + 2]) / 2 : z;
      let slot = -1, oldest = Infinity, oldestSlot = 0;
      for (let j = 0; j < this.count; j++) {
        const b = j * 7;
        if (Math.hypot(px - this.history[b], y - this.history[b + 1], pz - this.history[b + 2]) < .06) { slot = j; break; }
        if (this.history[b + 3] < oldest) { oldest = this.history[b + 3]; oldestSlot = j; }
      }
      if (slot < 0) slot = this.count < 128 ? this.count++ : oldestSlot;
      const b = slot * 7;
      this.history[b] = px; this.history[b + 1] = y; this.history[b + 2] = pz; this.history[b + 3] = time;
      this.history[b + 4] = longest ? (x - this.samples[tangent]) / longest : 0;
      this.history[b + 5] = longest ? (z - this.samples[tangent + 2]) / longest : 0;
      this.history[b + 6] = longest / 2;
      this.lastConfirmation = time;
    }
    this.inactiveReason = this.used ? 'evidencia' : !this.projected ? 'fora da vista' : !this.valid ? 'dados inválidos' : this.inRegionCount < 3 ? 'rejeição geométrica' : 'evidência insuficiente';
  }
  invalidateCell(cell,origin,size) {
    // Only derived contacts whose centre belongs to the released voxel are obsolete.
    // Other independently observed contacts, including neighbours, remain untouched.
    for(let i=this.count-1;i>=0;i--){
      const j=i*7;
      if(Math.floor((this.history[j]-origin[0])/size)!==cell.ix || Math.floor((this.history[j+1]-origin[1])/size)!==cell.iy || Math.floor((this.history[j+2]-origin[2])/size)!==cell.iz)continue;
      this.count--;if(i!==this.count)this.history.copyWithin(j,this.count*7,this.count*7+7);this.history.fill(0,this.count*7,this.count*7+7);
    }
  }
  contactAt(x,z,volume,time,skin){
    let best=Infinity,found=false;
    for(let i=0;i<this.count;i++){
      const j=i*7,h=this.history;if(time-h[j+3]>=900||h[j+1]<=volume.ground+this.config.floorTolerance||h[j+1]>=volume.ground+volume.height)continue;
      const a=Math.max(-h[j+6],Math.min(h[j+6],(x-h[j])*h[j+4]+(z-h[j+2])*h[j+5])),px=h[j]+a*h[j+4],pz=h[j+2]+a*h[j+5],distance=Math.hypot(x-px,z-pz),radius=radiusAt(volume,h[j+1]),gap=distance-radius;
      if(gap<best&&gap<=skin+this.config.pointMargin+1e-6){best=gap;found=true;this.contactPoint[0]=px;this.contactPoint[1]=h[j+1];this.contactPoint[2]=pz;Object.assign(this.contactSummary,{kind:'sonda',cellId:null,surfaceDistance:distance,volumeRadius:radius,clearance:gap,pointMargin:this.config.pointMargin,skin,ageMs:time-h[j+3],state:'evidência imediata',freeEvidence:0,reason:null,refined:false});}
    }
    if(found)this.lastBlockTime=time;return found?this.contactSummary:null;
  }
  allowsMove(x,z,nx,nz,volume,time,skin,escape=false) {
    this.motion=true;this.fromX=x;this.fromZ=z;this.escape=escape;this.motionAllowed=true;this.motionReason=null;this.motionBefore=this.motionAfter=this.motionDistance=null;
    this.penetration(nx,nz,volume,time,skin);this.motion=false;return this.motionAllowed;
  }
  penetration(x, z, volume, time, skin) {
    this.contactTime = -Infinity;
    let overlap = 0;
    for (let i = 0; i < this.count; i++) {
      const b = i * 7;
      // Short geometric contact memory supplies release hysteresis, without a global direction lock.
      if (time - this.history[b + 3] >= 900 || this.history[b + 1] <= volume.ground + this.config.floorTolerance || this.history[b + 1] >= volume.ground + volume.height) continue;
      const dx = x - this.history[b], dz = z - this.history[b + 2];
      const along = Math.max(-this.history[b + 6], Math.min(this.history[b + 6], dx * this.history[b + 4] + dz * this.history[b + 5]));
      const depth = radiusAt(volume,this.history[b+1]) + skin + this.config.pointMargin - Math.hypot(dx - along * this.history[b + 4], dz - along * this.history[b + 5]);
      if(this.motion && depth>0) {
        const dx0=this.fromX-this.history[b],dz0=this.fromZ-this.history[b+2],tx=this.history[b+4],tz=this.history[b+5],half=this.history[b+6];
        const r0=radiusAt(volume,this.history[b+1])+skin+this.config.pointMargin;
        const a0=Math.max(-half,Math.min(half,dx0*tx+dz0*tz));
        let before=r0-Math.hypot(dx0-a0*tx,dz0-a0*tz),after=depth;
        const fromSide=dx0*tz-dz0*tx,toSide=dx*tz-dz*tx,crossing=half>0&&Math.abs(fromSide)>1e-8&&fromSide*toSide<0;
        if(!this.escape && half>0){before=r0-Math.abs(fromSide);after=r0-Math.abs(toSide);}
        const closingPoint=half===0&&(dx0*(x-this.fromX)+dz0*(z-this.fromZ)) < -1e-10;
        if(crossing || closingPoint || (this.escape ? before<=0 : after>Math.max(0,before)+1e-8)){this.motionAllowed=false;this.motionReason=crossing?'crossed-contact-plane':closingPoint?'closing-point-contact':this.escape?'new-contact-during-escape':'contact-worsening';this.motionBefore=before;this.motionAfter=after;this.motionDistance=Math.hypot(dx-along*tx,dz-along*tz);}
      }
      overlap = Math.max(overlap, depth);
      if (depth > 0) this.contactTime = Math.max(this.contactTime, this.history[b + 3]);
    }
    return Math.max(0, overlap);
  }
}
