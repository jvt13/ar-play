import {clamp} from './math.js';
import {DepthProjector, SpatialMap} from './spatial-map.js';
import {MovementProbe} from './movement-probe.js';

// Envelopes derived from the unchanged procedural sphere transforms across walking/dancing.
// Unit scale, all headings; 0.025 model-unit margin, verified against dense model samples in tests.
export const MODEL_BOUNDS = Object.freeze({
  bip: Object.freeze({radius: .771, height: 1.685}),
  nori: Object.freeze({radius: .871, height: 1.509}),
  luma: Object.freeze({radius: .773, height: 1.665}),
});
export function characterVolume(id, scale, ground, out = {}) {
  const bounds = MODEL_BOUNDS[id];
  if (!bounds || !Number.isFinite(scale) || !Number.isFinite(ground)) throw new Error('Invalid character volume');
  const size = .42 * clamp(scale, .4, 1.8); // Same root scale as spatial AR rendering.
  out.radius = bounds.radius * size; out.height = bounds.height * size; out.ground = ground;
  return out;
}

export class CollisionResolver {
  constructor({skin = .015, maxSubsteps = 256} = {}) {
    this.skin = skin; this.maxSubsteps = maxSubsteps;
    this.result = {x: 0, z: 0, blocked: false, direction: '', steps: 0, coverage: 0};
  }
  exitDistance(map, x, z, dx, dz, volume, time, limit = 2) {
    const length = Math.hypot(dx, dz); if (!length) return Infinity;
    const step = map.config.cellSize / 2;
    for (let distance = step; distance <= limit; distance += step) {
      if (!map.collides(x + dx / length * distance, z + dz / length * distance, volume, time, this.skin)) return distance;
    }
    return Infinity;
  }
  escapeAllowed(map, x, z, dx, dz, volume, time) {
    const desired = this.exitDistance(map, x, z, dx, dz, volume, time);
    if (!Number.isFinite(desired)) return 0;
    const limit = desired - map.config.cellSize * .5 - 1e-8, heading = Math.atan2(dz, dx) + Math.PI;
    // A single materially nearer exit suffices to reject a route through the obstacle.
    // Search the reverse direction first and stop there, rather than tracing eight full 2 m rays.
    for (let i = 0; i < 8; i++) {
      const angle = heading + i * Math.PI / 4;
      if (Number.isFinite(this.exitDistance(map, x, z, Math.cos(angle), Math.sin(angle), volume, time, limit))) return 0;
    }
    return desired + map.config.cellSize;
  }
  canEnter(map, x, z, volume, time, limit) {
    if (map.penetration(x, z, volume, time, this.skin) <= limit) return true;
    this.blockedBits |= map.contactBits ?? 1;
    this.confirmationTime = Math.max(this.confirmationTime, map.contactTime ?? -Infinity);
    return false;
  }
  move(map, position, dx, dz, volume, time) {
    this.blockedBits = 0; this.confirmationTime = -Infinity;
    const out = this.result, startX = position[0], startZ = position[2];
    let x = startX, z = startZ, escape = 0, escapeAttempted = false;
    const wantedX = dx, wantedZ = dz;
    if (!Number.isFinite(dx + dz)) dx = dz = 0;
    const length = Math.hypot(dx, dz), step = Math.min(map.config.cellSize / 4, volume.radius / 4);
    const steps = Math.min(this.maxSubsteps, Math.max(1, Math.ceil(length / step)));
    const fraction = length > steps * step ? steps * step / length : 1;
    const sx = dx * fraction / steps, sz = dz * fraction / steps;
    for (let i = 0; i < steps; i++) {
      const overlap = map.penetration(x, z, volume, time, this.skin);
      // Existing overlap must not globally freeze input: allow escape and tangent movement
      // while forbidding increased penetration. Never displace an idle character.
      const limit = overlap > 0 ? overlap + 1e-8 : 0;
      if (!overlap) escape = 0;
      const allowed = this.canEnter(map, x + sx, z + sz, volume, time, limit);
      // Only pay for the bounded deep-overlap exit search when local relief fails.
      if (!allowed && overlap > 0 && !escapeAttempted) {
        escape = this.escapeAllowed(map, x, z, dx, dz, volume, time); escapeAttempted = true;
      }
      if ((overlap > 0 && escape > 0) || allowed) {
        x += sx; z += sz; escape -= Math.hypot(sx, sz); continue;
      }
      // Axis projection permits retreat and tangential sliding; never move without input.
      if (Math.abs(sx) >= Math.abs(sz)) {
        if (sx && this.canEnter(map, x + sx, z, volume, time, limit)) x += sx;
        if (sz && this.canEnter(map, x, z + sz, volume, time, Math.max(0, map.penetration(x, z, volume, time, this.skin) + (overlap ? 1e-8 : 0)))) z += sz;
      } else {
        if (sz && this.canEnter(map, x, z + sz, volume, time, limit)) z += sz;
        if (sx && this.canEnter(map, x + sx, z, volume, time, Math.max(0, map.penetration(x, z, volume, time, this.skin) + (overlap ? 1e-8 : 0)))) x += sx;
      }
    }
    const blockedX = Math.abs(x - startX - wantedX) > 1e-5, blockedZ = Math.abs(z - startZ - wantedZ) > 1e-5;
    out.x = x; out.z = z; out.blocked = blockedX || blockedZ; out.steps = steps;
    out.direction = (blockedX ? (wantedX > 0 ? 'X+' : 'X−') : '') + (blockedX && blockedZ ? '/' : '') + (blockedZ ? (wantedZ > 0 ? 'Z+' : 'Z−') : '');
    out.coverage = map.coverage(x, z, volume, time);
    out.sourceBits = this.blockedBits; out.confirmationTime = this.confirmationTime;
    return out;
  }
}

const STATES = {
  mapping: 'Mapeando ambiente', active: 'Colisões ativas', blocked: 'Obstáculo detectado',
  limited: 'Cobertura limitada', unavailable: 'Profundidade indisponível',
};

export class ARCollisions {
  constructor(elements = {}, config = {}, now = () => performance.now()) {
    this.elements = elements; this.now = now;
    this.map = new SpatialMap(config); this.projector = new DepthProjector(); this.resolver = new CollisionResolver();
    this.probe = new MovementProbe(this.map.config);
    // A shared collision field lets the same swept/slide solver consult either source.
    this.field = {
      config: this.map.config,
      coverage: (x, z, volume, time) => this.map.coverage(x, z, volume, time),
      collides: (x, z, volume, time, skin) => this.field.penetration(x, z, volume, time, skin) > 0,
      penetration: (x, z, volume, time, skin) => {
        const map = this.map.penetration(x, z, volume, time, skin);
        const probe = this.probe.penetration(x, z, volume, time, skin);
        this.field.contactBits = (map > 0 ? 1 : 0) | (probe > 0 ? 2 : 0);
        this.field.contactTime = Math.max(this.map.contactTime, this.probe.contactTime);
        return Math.max(map, probe);
      },
    };
    this.depths = new Float32Array(432); this.points = new Float32Array(432 * 3);
    this.point = new Float64Array(3); this.position = new Float64Array(3); this.anchor = new Float64Array(3);
    this.normal = new Float64Array(3);
    this.volume = characterVolume('bip', 1, 0); this.result = {x: 0, z: 0};
    this.stop();
    if (elements.toggle) elements.toggle.onchange = () => this.setEnabled(!!elements.toggle.checked);
    if (elements.visualToggle) elements.visualToggle.onchange = () => { this.visual = !!elements.visualToggle.checked && this.enabled; this.lastDraw = -Infinity; };
  }
  start(capability) { this.stop(); this.sessionActive = true; this.available = capability === 'waiting'; }
  setCharacter(id, scale, position) { characterVolume(id, scale, position[1], this.volume); this.position.set(position); }
  place(position, support = 1) {
    this.clearProbe();
    this.anchor.set(position); this.position.set(position); this.anchored = true;
    this.normal[0] = typeof support === 'number' ? 0 : support[4];
    this.normal[1] = typeof support === 'number' ? support : support[5];
    this.normal[2] = typeof support === 'number' ? 0 : support[6];
    const length = Math.hypot(...this.normal);
    this.supportValid = length > 0 && (typeof support === 'number' ? support : this.normal[1] / length) >= .95;
    if (length) for (let i = 0; i < 3; i++) this.normal[i] /= length;
    this.map.clear(this.supportValid ? this.anchor : null, this.normal);
    this.lastSample = this.lastData = -Infinity; this.updates = 0; this.coverage = 0;
    this.depthState = 'waiting'; this.used = this.sampled = 0; this.hz = 0;
    this.reconstructionMs = this.queryMs = null; this.blocked = false; this.direction = '';
    this.projector.clear(); this.depths.fill(0); this.points.fill(0); this.point.fill(0);
  }
  clearReference() {
    this.clearProbe();
    this.anchored = false; this.supportValid = false; this.map.clear(); this.projector.clear();
    this.depths.fill(0); this.points.fill(0); this.used = this.sampled = this.updates = 0;
    this.lastData = this.lastSample = -Infinity; this.coverage = 0; this.blocked = false; this.direction = '';
    this.anchor.fill(0); this.position.fill(0); this.point.fill(0); this.volume.ground = 0;
    this.normal.fill(0); this.normal[1] = 1;
    this.depthState = 'waiting'; this.hz = 0; this.reconstructionMs = this.queryMs = null;
  }
  setEnabled(enabled) {
    this.clearProbe();
    this.enabled = !!enabled && this.sessionActive;
    this.map.clear(this.anchored && this.supportValid ? this.anchor : null, this.normal);
    this.projector.clear(); this.point.fill(0);
    this.depths.fill(0); this.points.fill(0);
    this.interval = 125; this.columns = 24; this.rows = 18;
    this.fastUpdates = 0;
    this.lastSample = this.lastData = this.lastRender = -Infinity; this.updates = 0; this.coverage = 0;
    this.enabledAt = NaN;
    this.blocked = false; this.direction = ''; this.depthState = 'waiting'; this.used = this.sampled = 0;
    this.visual = false; if (this.elements.visualToggle) this.elements.visualToggle.checked = false;
    if (this.elements.canvas) this.elements.canvas.hidden = true;
    this.context?.clearRect(0, 0, 128, 128);
    if (this.elements.toggle) this.elements.toggle.checked = this.enabled;
  }
  frame(time, poseValid) {
    if (!this.enabled) return;
    this.time = time; if (!Number.isFinite(this.enabledAt)) this.enabledAt = time;
    this.blocked = false; this.direction = ''; this.blockSource = '';
    if (!poseValid && this.tracking) {
      this.clearProbe();
      this.map.clear(this.anchored && this.supportValid ? this.anchor : null, this.normal);
      this.projector.clear(); this.depths.fill(0); this.points.fill(0);
      this.coverage = 0; this.lastData = -Infinity; this.updates = 0;
      this.used = this.sampled = 0; this.point.fill(0);
      this.hz = 0;
    }
    this.tracking = !!poseValid;
    if (time - this.lastPurge >= 250) {
      this.map.expire(time); this.lastPurge = time;
      this.coverage = this.map.coverage(this.position[0], this.position[2], this.volume, time);
    }
  }
  wantsDepth(time) {
    return this.enabled && this.available && this.anchored && this.supportValid && this.tracking &&
      (time - this.lastSample >= this.interval || (time - this.intentTime < 150 && time - this.probe.lastUpdate >= this.probeInterval));
  }
  missing(time, reason) {
    this.lastSample = time; this.probe.lastUpdate = time; this.depthState = reason; this.used = this.sampled = 0; this.hz = 0;
    this.depths.fill(0); this.points.fill(0); this.point.fill(0);
  }
  accept(time, reader, info, view) {
    if (!this.projector.configure(info, view)) { this.missing(time, 'geometry'); return; }
    const mapDue = time - this.lastSample >= this.interval;
    this.map.centerX = this.position[0]; this.map.centerZ = this.position[2]; this.map.height = this.volume.height;
    if (time - this.intentTime < 150 && time - this.probe.lastUpdate >= this.probeInterval) {
      const probeStarted = this.now();
      this.probe.update(time, reader, this.projector, view.projectionMatrix, this.position, this.volume, this.intentX, this.intentZ, this.map);
      this.probe.costMs = Math.max(0, this.now() - probeStarted);
      this.probeInterval = this.probe.costMs > 2 ? 125 : 66;
    }
    if (!mapDue) return;
    this.lastSample = time;
    const mapStarted = this.now();
    const columns = this.columns, rows = this.rows, n = columns * rows;
    this.depths.fill(0); this.sampled = n;
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const d = reader.at((x + .5) / columns, (y + .5) / rows, true);
      if (d !== null && d >= .15 && d <= 6) this.depths[y * columns + x] = d;
    }
    let count = 0;
    this.map.begin(time, this.position, this.volume.height);
    // Dense local evidence also fills gaps in the persistent map, with the same temporal votes.
    // Only observations actually acquired this frame may vote; cached contacts never refresh it.
    if (this.probe.lastUpdate === time) for (let i = 0; i < this.probe.sampleCount; i++) {
      if (this.probe.coherent[i]) this.map.observe(this.probe.samples[i * 3], this.probe.samples[i * 3 + 1], this.probe.samples[i * 3 + 2]);
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const i = y * columns + x, d = this.depths[i]; if (!d) continue;
      const tolerance = Math.max(.08, d * .04);
      let neighbors = 0;
      if (x && this.depths[i - 1] && Math.abs(this.depths[i - 1] - d) <= tolerance) neighbors++;
      if (x + 1 < columns && this.depths[i + 1] && Math.abs(this.depths[i + 1] - d) <= tolerance) neighbors++;
      if (y && this.depths[i - columns] && Math.abs(this.depths[i - columns] - d) <= tolerance) neighbors++;
      if (y + 1 < rows && this.depths[i + columns] && Math.abs(this.depths[i + columns] - d) <= tolerance) neighbors++;
      if (neighbors < 2 || !this.projector.point((x + .5) / columns, (y + .5) / rows, d, this.point)) continue;
      const offset = count++ * 3;
      this.points[offset] = this.point[0]; this.points[offset + 1] = this.point[1]; this.points[offset + 2] = this.point[2];
      this.map.observe(this.point[0], this.point[1], this.point[2]);
    }
    const pose = this.projector.pose;
    // Endpoints first, then conservative ray carving; current surfaces are never cleared.
    for (let i = 0; i < count * 3; i += 3) this.map.traceFree(pose[12], pose[13], pose[14], this.points[i], this.points[i + 1], this.points[i + 2]);
    const currentProbe = this.probe.lastUpdate === time && this.probe.used > 0;
    this.used = count; this.depthState = count || currentProbe ? 'available' : 'waiting';
    if (count || currentProbe) {
      if (Number.isFinite(this.lastData) && time > this.lastData) this.hz = 1000 / (time - this.lastData);
      this.lastData = time; this.updates++;
    }
    this.coverage = this.map.coverage(this.position[0], this.position[2], this.volume, time);
    this.reconstructionMs = Math.max(0, this.now() - mapStarted);
    if (this.reconstructionMs > 4) {
      this.interval = Math.min(500, this.interval * 1.5); this.columns = 16; this.rows = 12; this.fastUpdates = 0;
    } else if (this.reconstructionMs < 2) {
      this.fastUpdates++;
      if (this.fastUpdates >= 16 && this.interval > 125) { this.interval = Math.max(125, this.interval * .8); this.fastUpdates = 0; }
      else if (this.fastUpdates >= 32 && this.interval === 125) { this.columns = 24; this.rows = 18; this.fastUpdates = 0; }
    } else this.fastUpdates = 0;
  }
  move(position, dx, dz, time) {
    if (this.enabled && Math.hypot(dx, dz) > 1e-8) {
      this.intentX = dx; this.intentZ = dz; this.intentTime = time;
    }
    this.result.x = position[0] + dx; this.result.z = position[2] + dz;
    this.blocked = false; this.direction = ''; this.blockSource = '';
    if (this.enabled && this.anchored && this.supportValid && (this.map.occupiedCount > 0 || this.probe.count > 0)) {
      const started = this.now(), solved = this.resolver.move(this.field, position, dx, dz, this.volume, time);
      this.result.x = solved.x; this.result.z = solved.z; this.blocked = solved.blocked; this.direction = solved.direction;
      this.coverage = solved.coverage; this.queryMs = Math.max(0, this.now() - started);
      if (this.blocked) {
        this.blockSource = solved.sourceBits === 3 ? 'ambos' : solved.sourceBits === 2 ? 'sonda imediata' : solved.sourceBits === 1 ? 'mapa persistente' : 'limite de deslocamento';
        this.blockConfirmation = solved.confirmationTime;
        this.lastBlockedTime = time; this.lastBlockedDirection = this.direction;
      }
    } else if (this.enabled && this.anchored && this.supportValid) {
      this.coverage = this.map.coverage(this.result.x, this.result.z, this.volume, time);
    }
    this.position[0] = this.result.x; this.position[2] = this.result.z;
    return this.result;
  }
  phase() {
    if (this.blocked) return 'blocked';
    if (!this.available) return 'unavailable';
    if (!this.anchored) return 'mapping';
    if (!this.supportValid || this.depthState === 'geometry' || !this.tracking) return 'limited';
    if (this.depthState !== 'available' && !this.map.occupiedCount && this.time - this.lastData >= 1500 && this.updates) return 'unavailable';
    if (!this.updates) return this.depthState === 'waiting' && this.time - this.enabledAt < 1500 ? 'mapping' : 'unavailable';
    if (this.depthState !== 'available' || this.map.saturated || this.coverage < .6) return 'limited';
    return 'active';
  }
  snapshot() {
    return {enabled: this.enabled, phase: this.phase(), used: this.used, sampled: this.sampled,
      occupied: this.map.occupiedCount, cells: this.map.cells.size, freeCells: this.map.free.size,
      hz: this.hz, reconstructionMs: this.reconstructionMs, queryMs: this.queryMs,
      coverage: this.coverage, direction: this.direction, blocked: this.blocked,
      interval: this.interval, radius: this.volume.radius, height: this.volume.height, depthState: this.depthState,
      blockSource: this.blockSource, probeSamples: this.probe.used, probeTested: this.probe.tested,
      probeSupport: this.probe.support, probeMs: this.probe.costMs,
      confirmationAgeMs: this.blocked && Number.isFinite(this.blockConfirmation) ? Math.max(0, this.time - this.blockConfirmation) : null,
      coverageInsufficient: this.coverage < .6 || this.depthState !== 'available',
      lastBlockedDirection: this.time - this.lastBlockedTime < 900 ? this.lastBlockedDirection : ''};
  }
  render(time, diagnosticOpen) {
    if (time - this.lastRender < 250) return;
    this.lastRender = time;
    const {status, readout, canvas, visualToggle} = this.elements;
    if (status) { status.hidden = !this.enabled; status.textContent = STATES[this.phase()]; }
    if (visualToggle) visualToggle.disabled = !this.enabled;
    if (readout) readout.textContent = this.enabled && diagnosticOpen ?
      `Pontos úteis: ${this.used}/${this.sampled}\nCélulas ocupadas: ${this.map.occupiedCount} (limite ${this.map.config.maxCells})\nAtualização espacial: ${this.hz ? this.hz.toFixed(1) + ' Hz' : '—'}\nReconstrução: ${this.reconstructionMs === null ? '—' : this.reconstructionMs.toFixed(2) + ' ms'}\nConsulta: ${this.queryMs === null ? '—' : this.queryMs.toFixed(2) + ' ms'}\nCobertura amostrada: ${Math.round(this.coverage * 100)}% (${STATES[this.phase()]})\nDireção bloqueada (XR): ${this.direction || '—'}\nOrigem do bloqueio: ${this.blockSource || 'sem bloqueio atual'}\nSonda: ${this.probe.used}/${this.probe.tested} amostras; apoio local ${this.probe.support} (não é precisão)\nCusto da sonda: ${this.probe.costMs === null ? '—' : this.probe.costMs.toFixed(2) + ' ms'}\nConfirmação do bloqueio: ${this.blocked && Number.isFinite(this.blockConfirmation) ? Math.max(0, time - this.blockConfirmation).toFixed(0) + ' ms atrás' : '—'}\nCobertura: ${this.coverage < .6 || this.depthState !== 'available' ? 'insuficiente; desconhecido não comprova livre' : 'amostrada; não garante espaço livre'}` : '';
    if (!canvas) return;
    canvas.hidden = !this.enabled || !this.visual || !diagnosticOpen;
    if (canvas.hidden || time - this.lastDraw < 500) return;
    this.lastDraw = time;
    this.context ||= canvas.getContext('2d'); if (!this.context) return;
    const c = this.context, scale = 128 / (this.map.config.radius * 2), s = this.map.config.cellSize, o = this.map.origin;
    c.fillStyle = '#101522'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#fa7373';
    let drawn = 0;
    for (const cell of this.map.cells.values()) {
      if (!cell.confirmed || time - cell.time >= this.map.config.ttl || cell.minY >= this.volume.ground + this.volume.height) continue;
      if (drawn++ >= 512) break;
      const x = o[0] + cell.ix * s, z = o[2] + cell.iz * s;
      c.fillRect(64 + (x - this.position[0]) * scale, 64 + (z - this.position[2]) * scale, Math.max(1, s * scale), Math.max(1, s * scale));
    }
    c.strokeStyle = '#b7f36e'; c.lineWidth = 1; c.beginPath(); c.arc(64, 64, this.volume.radius * scale, 0, 2 * Math.PI); c.stroke();
  }
  stop() {
    this.clearProbe();
    this.sessionActive = false; this.available = false; this.enabled = false; this.visual = false;
    this.anchored = false; this.supportValid = false; this.tracking = true;
    this.map.clear(); this.projector.clear(); this.depths.fill(0); this.points.fill(0);
    this.position.fill(0); this.anchor.fill(0);
    this.point.fill(0); this.volume.ground = 0;
    this.normal.fill(0); this.normal[1] = 1;
    this.interval = 125; this.columns = 24; this.rows = 18; this.used = this.sampled = this.updates = 0;
    this.fastUpdates = 0;
    this.hz = 0; this.reconstructionMs = this.queryMs = null; this.coverage = 0;
    this.lastSample = this.lastData = this.lastRender = this.lastDraw = this.lastPurge = -Infinity;
    this.depthState = 'waiting'; this.blocked = false; this.direction = '';
    this.time = 0; this.enabledAt = NaN;
    this.context?.clearRect(0, 0, 128, 128); this.context = null;
    if (this.elements.toggle) this.elements.toggle.checked = false;
    if (this.elements.visualToggle) this.elements.visualToggle.checked = false;
    if (this.elements.status) this.elements.status.hidden = true;
    if (this.elements.readout) this.elements.readout.textContent = '';
    if (this.elements.canvas) this.elements.canvas.hidden = true;
  }
  clearProbe() {
    this.probe.clear(); this.intentX = this.intentZ = 0; this.intentTime = -Infinity;
    this.probeInterval = 66; this.blockSource = ''; this.blockConfirmation = -Infinity;
    this.lastBlockedTime = -Infinity; this.lastBlockedDirection = '';
  }
}
