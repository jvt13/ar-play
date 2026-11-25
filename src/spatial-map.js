import {invert4} from './math.js';

export const SPATIAL_CONFIG = Object.freeze({
  cellSize: .12, radius: 3, floorTolerance: .06, ttl: 3000, candidateTtl: 1000,
  freeTtl: 1500, confirmations: 3, freeConfirmations: 3, maxCells: 4096,
  maxFreeCells: 8192, maxRaySteps: 96, surfaceMargin: .18,
});
const finiteMatrix = m => m?.length === 16 && m.every(Number.isFinite);
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
    const ownProjection = info.projectionMatrix, ownPose = info.transform?.matrix;
    if (('projectionMatrix' in info || 'transform' in info) && (!finiteMatrix(ownProjection) || !finiteMatrix(ownPose) ||
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
      c.floorTolerance >= 0 && c.floorTolerance < .25 && c.candidateTtl > 0 && c.freeTtl > 0)) throw new Error('Invalid spatial limits');
    this.cells = new Map(); this.free = new Map(); this.origin = new Float64Array(3); this.normal = new Float64Array(3);
    this.clear();
  }
  clear(origin = null, normal = null) {
    this.cells.clear(); this.free.clear(); this.occupiedCount = 0;
    this.origin.fill(0); if (origin) this.origin.set(origin);
    this.normal.fill(0); this.normal[1] = 1; if (normal) this.normal.set(normal);
    this.ready = !!origin; this.batch = 0; this.saturated = false;
  }
  key(ix, iy, iz) {
    if (ix < -32768 || ix > 32767 || iz < -32768 || iz > 32767 || iy < -128 || iy > 127) return -1;
    return (ix + 32768) * 16777216 + (iz + 32768) * 256 + iy + 128;
  }
  begin(time, position, height) {
    this.time = time; this.batch++; this.centerX = position[0]; this.centerZ = position[2]; this.height = height;
    this.saturated = false; this.expire(time);
  }
  expire(time) {
    const c = this.config;
    for (const cell of this.cells.values()) if (time - cell.time >= (cell.confirmed ? c.ttl : c.candidateTtl)) {
      if (cell.confirmed) this.occupiedCount--;
      this.cells.delete(cell.key);
    }
    for (const cell of this.free.values()) if (time - cell.time >= c.freeTtl) this.free.delete(cell.key);
  }
  inRegion(x, y, z) {
    return this.ready && (x - this.centerX) ** 2 + (z - this.centerZ) ** 2 <= this.config.radius ** 2 &&
      y > this.origin[1] && y <= this.origin[1] + this.height &&
      (x - this.origin[0]) * this.normal[0] + (y - this.origin[1]) * this.normal[1] + (z - this.origin[2]) * this.normal[2] > this.config.floorTolerance;
  }
  observe(x, y, z) {
    if (!Number.isFinite(x + y + z) || !this.inRegion(x, y, z)) return false;
    const s = this.config.cellSize, o = this.origin;
    const ix = Math.floor((x - o[0]) / s), iy = Math.floor((y - o[1]) / s), iz = Math.floor((z - o[2]) / s), key = this.key(ix, iy, iz);
    if (key < 0) return false;
    let cell = this.cells.get(key);
    if (!cell) {
      if (this.cells.size >= this.config.maxCells) { this.saturated = true; return false; }
      cell = {key, ix, iy, iz, minY: y, maxY: y, hits: 0, time: this.time, batch: -1, confirmed: false, freeHits: 0, freeBatch: -1};
      this.cells.set(key, cell);
    }
    if (cell.batch !== this.batch) {
      cell.hits = this.time - cell.time < this.config.candidateTtl ? Math.min(this.config.confirmations, cell.hits + 1) : 1;
      cell.batch = this.batch; cell.time = this.time; cell.freeHits = 0;
      cell.minY = cell.maxY = y;
      if (!cell.confirmed && cell.hits >= this.config.confirmations) { cell.confirmed = true; this.occupiedCount++; }
    }
    cell.minY = Math.min(cell.minY, y); cell.maxY = Math.max(cell.maxY, y);
    this.free.delete(key);
    return true;
  }
  markFree(ix, iy, iz) {
    const c = this.config, s = c.cellSize, o = this.origin;
    if (!this.inRegion(o[0] + (ix + .5) * s, o[1] + (iy + .5) * s, o[2] + (iz + .5) * s)) return;
    const key = this.key(ix, iy, iz); if (key < 0) return;
    const cell = this.cells.get(key);
    if (cell?.batch === this.batch) return;
    let known = this.free.get(key);
    if (!known) {
      if (this.free.size >= c.maxFreeCells) { this.saturated = true; return; }
      known = {key, time: this.time, batch: -1, hits: 0}; this.free.set(key, known);
    }
    if (known.batch === this.batch) return;
    known.batch = this.batch; known.time = this.time; known.hits = Math.min(c.freeConfirmations, known.hits + 1);
    if (cell && cell.freeBatch !== this.batch) {
      cell.freeBatch = this.batch; cell.freeHits++;
      if (cell.freeHits >= c.freeConfirmations) {
        if (cell.confirmed) this.occupiedCount--;
        this.cells.delete(key);
      }
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
      this.markFree(ix, iy, iz);
      if (tx <= ty && tx <= tz) { distance = tx; tx += ax; ix += sx; }
      else if (ty <= tz) { distance = ty; ty += ay; iy += sy; }
      else { distance = tz; tz += az; iz += sz; }
    }
  }
  stateAt(x, y, z, time) {
    const s = this.config.cellSize, o = this.origin;
    const key = this.key(Math.floor((x - o[0]) / s), Math.floor((y - o[1]) / s), Math.floor((z - o[2]) / s));
    const cell = this.cells.get(key);
    if (cell?.confirmed && time - cell.time < this.config.ttl) return 'occupied';
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
  collides(x, z, volume, time, skin = .015) {
    if (!this.ready) return false;
    const c = this.config, s = c.cellSize, o = this.origin, r = volume.radius + skin;
    const minX = Math.floor((x - r - o[0]) / s), maxX = Math.floor((x + r - o[0]) / s);
    const minZ = Math.floor((z - r - o[2]) / s), maxZ = Math.floor((z + r - o[2]) / s);
    const minY = Math.floor((volume.ground + c.floorTolerance - o[1]) / s), maxY = Math.floor((volume.ground + volume.height - o[1]) / s);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const lowX = o[0] + ix * s, lowZ = o[2] + iz * s;
      const dx = Math.max(lowX - x, 0, x - lowX - s), dz = Math.max(lowZ - z, 0, z - lowZ - s);
      if (dx * dx + dz * dz >= r * r - 1e-10) continue;
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.cells.get(this.key(ix, iy, iz));
        if (cell?.confirmed && time - cell.time < c.ttl && cell.minY < volume.ground + volume.height && cell.maxY > volume.ground + c.floorTolerance) return true;
      }
    }
    return false;
  }
}
