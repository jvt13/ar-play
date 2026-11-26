import {PROFILES,configurePose} from './volume.js';
import {clamp} from './math.js';
import {DepthProjector, SpatialMap} from './spatial-map.js';
import {MovementProbe} from './movement-probe.js';
import {SpatialRevalidator} from './revalidation.js';
import {DiagnosticArchive} from './diagnostics.js';

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
  out.profile = PROFILES[id]; out.size = size; out.radius = bounds.radius * size; out.height = bounds.height * size; out.ground = ground;
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
  canEnter(map, x, z, volume, time, limit, fromX=x, fromZ=z, escape=false) {
    const depth=map.penetration(x,z,volume,time,this.skin);
    if (escape ? map.allowsMove(fromX,fromZ,x,z,volume,time,this.skin,true) : depth<=limit && (!limit || map.allowsMove(fromX,fromZ,x,z,volume,time,this.skin))) return true;
    this.failureSource=map.rejectedSource||'field-envelope';this.failureCellId=map.rejectedCellId??null;this.failureStage=this.stage||'sweep';this.failureDx=x-fromX;this.failureDz=z-fromZ;this.failureFromX=fromX;this.failureFromZ=fromZ;this.failureToX=x;this.failureToZ=z;this.failureEscape=escape;
    if(x!==this.lastNoteX||z!==this.lastNoteZ){map.noteBlocked?.(x,z,volume,time,this.skin);this.lastNoteX=x;this.lastNoteZ=z;}
    this.reason=map.rejectedReason||'contact-worsening';this.before=map.rejectedBefore??limit;this.after=map.rejectedAfter??depth;this.distance=map.rejectedDistance??null;
    this.mapConfirmationTime=Math.max(this.mapConfirmationTime,map.mapContactTime??-Infinity);this.probeConfirmationTime=Math.max(this.probeConfirmationTime,map.probeContactTime??-Infinity);
    this.evidenceBits |= map.contactEvidence??0;this.blockedBits |= map.contactBits ?? 1;
    this.confirmationTime = Math.max(this.confirmationTime, map.contactTime ?? -Infinity);
    return false;
  }
  move(map, position, dx, dz, volume, time) {
    this.lastNoteX=this.lastNoteZ=NaN;this.mapConfirmationTime=this.probeConfirmationTime=-Infinity;this.evidenceBits=0;this.blockedBits = 0; this.confirmationTime = -Infinity; this.usedPartial=false;this.failureSource=this.failureCellId=this.failureStage=null;this.failureDx=this.failureDz=0;this.reason=''; this.before=this.after=this.distance=null;
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
      this.stage='sweep';const allowed = this.canEnter(map, x + sx, z + sz, volume, time, limit, x, z);
      // Only pay for the bounded deep-overlap exit search when local relief fails.
      if (!allowed && overlap > 0 && !escapeAttempted) {
        escape = !map.collides(startX+dx,startZ+dz,volume,time,this.skin) ? this.escapeAllowed(map,x,z,dx,dz,volume,time) : 0; escapeAttempted = true;
      }
      if ((overlap > 0 && escape > 0 && this.canEnter(map,x+sx,z+sz,volume,time,limit,startX,startZ,true)) || allowed) {
        x += sx; z += sz; escape -= Math.hypot(sx, sz); continue;
      }
      const ax=sx,az=sz,axisStartX=x,axisStartZ=z;
      this.stage='axis-projection';
      // Axis projection permits retreat and tangential sliding; never move without input.
      if (Math.abs(ax) >= Math.abs(az)) {
        if (ax && this.canEnter(map, x + ax, z, volume, time, limit, x,z)) x += ax;
        if (az && this.canEnter(map, x, z + az, volume, time, Math.max(0, map.penetration(x, z, volume, time, this.skin) + (overlap ? 1e-8 : 0)),x,z)) z += az;
      } else {
        if (az && this.canEnter(map, x, z + az, volume, time, limit,x,z)) z += az;
        if (ax && this.canEnter(map, x + ax, z, volume, time, Math.max(0, map.penetration(x, z, volume, time, this.skin) + (overlap ? 1e-8 : 0)),x,z)) x += ax;
      }
      // A wedge can reject both axes although a finite diagonal portion is free.
      // Preserve the established tangent projection first: do not step into gaps
      // between samples if a full lateral component already provides valid sliding.
      const stepLength=Math.hypot(sx,sz);
      if(!overlap&&sx&&sz&&x===axisStartX&&z===axisStartZ&&!map.collides(x+sx/stepLength*1e-6,z+sz/stepLength*1e-6,volume,time,this.skin)){
        let low=0,high=1;for(let k=0;k<16;k++){const f=(low+high)/2;if(map.collides(x+sx*f,z+sz*f,volume,time,this.skin))high=f;else low=f;}
        x+=sx*low;z+=sz*low;if(low>0)this.usedPartial=true;
      }
    }
    // Finish within one numerical substep of the actual boundary, without shrinking any volume.
    // Only free starts are refined; existing-overlap guards above remain authoritative.
    if(!map.collides(x,z,volume,time,this.skin))for(let axis=0;axis<2;axis++){
      const remaining=axis?wantedZ-(z-startZ):wantedX-(x-startX);
      if(Math.abs(remaining)<1e-5)continue;
      const direction=Math.sign(remaining);
      // Repeated pushes at a boundary need only a fresh numerical proximity check.
      // This is not a physical sensor tolerance or a cached obstacle assumption.
      if(map.collides(x+(axis?0:direction*1e-6),z+(axis?direction*1e-6:0),volume,time,this.skin))continue;
      const delta=direction*Math.min(step,Math.abs(remaining));let low=0,high=1;
      for(let i=0;i<16;i++){const f=(low+high)/2;if(map.collides(x+(axis?0:delta*f),z+(axis?delta*f:0),volume,time,this.skin))high=f;else low=f;}
      if(axis)z+=delta*low;else x+=delta*low;
    }
    const blockedX = Math.abs(x - startX - wantedX) > 1e-5, blockedZ = Math.abs(z - startZ - wantedZ) > 1e-5;
    out.x = x; out.z = z; out.blocked = blockedX || blockedZ; out.steps = steps;
    out.direction = (blockedX ? (wantedX > 0 ? 'X+' : 'X−') : '') + (blockedX && blockedZ ? '/' : '') + (blockedZ ? (wantedZ > 0 ? 'Z+' : 'Z−') : '');
    // Describe the final rejected subquery once per movement, rather than doubling
    // every failed broad/narrow query in continuous joystick pressure.
    if(out.blocked&&this.failureStage&&!map.allowsMove(this.failureFromX,this.failureFromZ,this.failureToX,this.failureToZ,volume,time,this.skin,this.failureEscape)){
      this.failureSource=map.rejectedSource||'map';this.failureCellId=map.rejectedCellId??map.motionCellId??null;
      this.reason=map.rejectedReason??map.motionReason??this.reason;this.before=map.rejectedBefore??map.motionBefore??this.before;this.after=map.rejectedAfter??map.motionAfter??this.after;this.distance=map.rejectedDistance??map.motionDistance??this.distance;
    }
    out.coverage = map.coverage(x, z, volume, time);
    out.usedPartial=this.usedPartial;out.failureSource=this.failureSource;out.failureCellId=this.failureCellId;out.failureStage=this.failureStage;out.failureDx=this.failureDx;out.failureDz=this.failureDz;out.reason=out.blocked?(this.reason||'movement-budget'):null;out.distance=this.distance;out.before=this.before;out.after=this.after;out.mapConfirmationTime=this.mapConfirmationTime;out.probeConfirmationTime=this.probeConfirmationTime;out.evidenceBits=this.evidenceBits;out.sourceBits = this.blockedBits; out.confirmationTime = this.confirmationTime;
    return out;
  }
}

const STATES = {
  mapping: 'Mapeando ambiente', active: 'Colisões ativas', blocked: 'Obstáculo detectado',
  limited: 'Cobertura limitada', unavailable: 'Profundidade indisponível',
};

export class ARCollisions {
  constructor(elements = {}, config = {}, now = () => performance.now()) {
    this.elements = elements; this.now = now;this.archive=elements.archive||new DiagnosticArchive(now);this.sessionId=null;this.sessionOrigin=0;
    const {orientedVolume=false,...mapConfig}=config;this.orientedEnabled=!!orientedVolume;this.poseYaw=0;this.poseDance=false;this.posePending=false;this.poseDesiredYaw=0;this.poseAttemptAt=-Infinity;this.volumeUpdateMs=null;
    this.lifeEvents=Array.from({length:16},()=>({}));this.lifeCount=this.lifeCursor=0;
    this.map = new SpatialMap(mapConfig); this.projector = new DepthProjector(); this.resolver = new CollisionResolver();
    this.probe = new MovementProbe(this.map.config);
    this.revalidator=new SpatialRevalidator(now);
    this.map.onRelease=cell=>this.probe.invalidateCell(cell,this.map.origin,this.map.config.cellSize);
    // A shared collision field lets the same swept/slide solver consult either source.
    this.field = {
      config: this.map.config,
      noteBlocked:(x,z,volume,time,skin)=>this.map.noteBlocked(x,z,volume,time,skin),
      coverage: (x, z, volume, time) => this.map.coverage(x, z, volume, time),
      collides: (x, z, volume, time, skin) => this.field.penetration(x, z, volume, time, skin) > 0,
      allowsMove: (x,z,nx,nz,volume,time,skin,escape=false)=>{
        const a=this.map.allowsMove(x,z,nx,nz,volume,time,skin,escape), b=this.probe.allowsMove(x,z,nx,nz,volume,time,skin,escape);
        const failed=!a?this.map:!b?this.probe:null;
        this.field.rejectedSource=!a?'map':!b?'probe':null;this.field.rejectedCellId=!a?this.map.motionCellId??null:null;this.field.rejectedReason=failed?.motionReason??null;this.field.rejectedBefore=failed?.motionBefore??null;this.field.rejectedAfter=failed?.motionAfter??null;this.field.rejectedDistance=failed?.motionDistance??null;
        this.field.mapContactTime=!a?this.map.contactTime:-Infinity;this.field.probeContactTime=!b?this.probe.contactTime:-Infinity;this.field.contactEvidence=(!a?(time-this.map.contactTime>750?2:1):0)|(!b?1:0);this.field.contactBits=(!a?1:0)|(!b?2:0);this.field.contactTime=Math.max(this.map.contactTime,this.probe.contactTime);return a&&b;
      },
      penetration: (x, z, volume, time, skin) => {
        this.field.rejectedSource=this.field.rejectedCellId=null;this.field.rejectedReason=this.field.rejectedBefore=this.field.rejectedAfter=this.field.rejectedDistance=null;
        const map = this.map.penetration(x, z, volume, time, skin);
        const probe = this.probe.penetration(x, z, volume, time, skin);
        this.field.mapContactTime=map>0?this.map.contactTime:-Infinity;this.field.probeContactTime=probe>0?this.probe.contactTime:-Infinity;
        this.field.contactEvidence=(map>0?(time-this.map.contactTime>750?2:1):0)|(probe>0?1:0);
        this.field.contactBits = (map > 0 ? 1 : 0) | (probe > 0 ? 2 : 0);
        this.field.contactTime = Math.max(this.map.contactTime, this.probe.contactTime);
        return Math.max(map, probe);
      },
    };
    this.rayTags=new Uint32Array(432);this.rayStamp=0;this.rayCursor=0;this.depths = new Float32Array(432); this.points = new Float32Array(432 * 3);
    this.point = new Float64Array(3); this.position = new Float64Array(3); this.anchor = new Float64Array(3);
    this.normal = new Float64Array(3);
    this.candidateVolume=characterVolume('bip',1,0);this.volume = characterVolume('bip', 1, 0); this.result = {x: 0, z: 0};
    this.stop();
    if(elements.copyButton)elements.copyButton.onclick=async()=>{const result=await this.archive.copy(this.exportText('manual-copy'));elements.copyButton.textContent=result.ok?'Copiado':'Falha na cópia';if(elements.feedback)elements.feedback.textContent=result.message;};
    if(elements.exportButton)elements.exportButton.onclick=()=>elements.onExport?.(this.exportText('manual-export'));
    if(elements.clearButton)elements.clearButton.onclick=()=>{this.clearEvents();this.archive.clear();if(elements.feedback)elements.feedback.textContent='Histórico textual limpo. Geometria ativa preservada.';};
    if(elements.debugToggle) elements.debugToggle.onchange=()=>{this.debug3D=!!elements.debugToggle.checked&&this.enabled;};
    if(elements.mappingButton)elements.mappingButton.onclick=()=>this.setGuided(!this.guided);
    if (elements.toggle) elements.toggle.onchange = () => this.setEnabled(!!elements.toggle.checked);
    if (elements.visualToggle) elements.visualToggle.onchange = () => { this.visual = !!elements.visualToggle.checked && this.enabled; this.lastDraw = -Infinity; };
  }
  setGuided(value) {
    this.guided=!!value&&this.enabled&&this.anchored&&this.available&&this.tracking;
    if(this.guided){this.guidedBaseline=this.map.createdCount;this.intentX=this.intentZ=0;this.intentTime=-Infinity;}
    this.lastRender=-Infinity;
  }
  setInput(x,z){this.rawX=x;this.rawZ=z;}
  supportAt(x,z){return this.anchored&&Math.abs(this.normal[1])>1e-8?this.anchor[1]-((x-this.anchor[0])*this.normal[0]+(z-this.anchor[2])*this.normal[2])/this.normal[1]:null;}
  noteRendered(base,shadow,jump){this.renderedBase=Number.isFinite(base)?base:null;this.shadowY=shadow;this.jumpY=jump;if(this.eventCount){const e=this.events[(this.eventCursor+31)%32];if(e.time===this.time){e.renderedBase=this.renderedBase;e.supportDifference=this.renderedBase===null?null:this.renderedBase-this.volume.ground;e.shadowY=shadow;e.visualJump=jump;}}if(this.lastBlockAvailable&&this.lastBlock.time===this.time){this.lastBlock.renderedBase=this.renderedBase;this.lastBlock.supportDifference=this.renderedBase==null?null:this.renderedBase-this.volume.ground;this.lastBlock.shadowY=shadow;this.lastBlock.visualJump=jump;}}
  setIntent(x, z, time) { this.controlX=x;this.controlZ=z;const n=Math.hypot(x,z),old=Math.hypot(this.intentX,this.intentZ); if(n>1e-8 && (!old || (x*this.intentX+z*this.intentZ)/(n*old)<.5)) this.probe.lastUpdate=-Infinity; this.intentX=x; this.intentZ=z; this.intentTime=n>1e-8 ? time : -Infinity; }
  probeState(time = this.time) {
    if (time-this.intentTime>=150) return 'inativa: sem movimento';
    if (!this.tracking) return 'aguardando pose';
    if (this.probe.lastUpdate<this.intentTime && time-this.probe.lastUpdate>this.probeInterval) return 'aguardando aquisicao';
    return this.probe.inactiveReason;
  }
  exportText(reason='manual-export') {
    const events=[];for(let i=0;i<this.eventCount;i++)events.push(this.events[(this.eventCursor-this.eventCount+i+32)%32]);
    this.archive.capture(this.sessionId,this.sessionOrigin,reason,events,this.lastBlockAvailable?this.lastBlock:null,this.snapshot());return this.archive.text();
  }
  diagnosticText() {
    return JSON.stringify({version:'1.1.6',session:this.sessionId,lastMapClearReason:this.lastMapClearReason,lastBlock:this.lastBlockAvailable?{...this.lastBlock,ageMs:Math.max(0,this.time-this.lastBlock.time)}:null,state:this.snapshot(),events:Array.from({length:this.eventCount},(_,i)=>this.events[(this.eventCursor-this.eventCount+i+32)%32])},null,2);
  }
  lifecycle(kind,detail=''){
    if(!this.sessionId)return;
    const e=this.lifeEvents[this.lifeCursor];e.atMs=Math.max(0,this.now()-this.sessionOrigin);e.kind=kind;e.detail=detail;e.mapGeneration=this.mapGeneration??0;
    this.lifeCursor=(this.lifeCursor+1)%16;this.lifeCount=Math.min(16,this.lifeCount+1);
  }
  lifecycleSnapshot(){const out=[];for(let i=0;i<this.lifeCount;i++)out.push({...this.lifeEvents[(this.lifeCursor-this.lifeCount+i+16)%16]});return out;}
  start(capability) { this.stop('new-session');this.sessionId=this.archive.begin();this.sessionOrigin=this.now();this.mapGeneration=0;this.lifeCount=this.lifeCursor=0;this.poseYaw=0;this.poseDance=false;this.posePending=false;this.poseDesiredYaw=0;this.suspended=false; this.sessionActive = true; this.available = capability === 'waiting';this.lifecycle('session-start'); }
  setCharacter(id, scale, position) {
    const started=this.now();const changed=this.characterId!==id||this.characterScale!==scale;
    this.characterId=id;this.characterScale=scale;characterVolume(id,scale,position[1],this.volume);this.position.set(position);
    if(this.orientedEnabled)configurePose(this.volume,id,this.poseYaw,this.poseDance);
    if(changed&&this.anchored){this.placementPending=true;this.lifecycle('body-change','validar eventual sobreposição; sem deslocamento automático');}
    this.characterVolumeMs=Math.max(0,this.now()-started);
  }
  requestPose(yaw,dance,time=this.time){
    if(!this.orientedEnabled)return true;
    const started=this.now();this.poseDesiredYaw=yaw;
    if(yaw===this.poseYaw&&!!dance===this.poseDance){this.posePending=false;this.volumeUpdateMs=(this.characterVolumeMs||0)+Math.max(0,this.now()-started);return true;}
    if(this.posePending&&time-this.poseAttemptAt<125&&this.position[0]===this.poseAttemptX&&this.position[2]===this.poseAttemptZ&&!!dance===this.poseAttemptDance&&yaw===this.poseAttemptYaw){this.volumeUpdateMs=(this.characterVolumeMs||0)+Math.max(0,this.now()-started);return false;}
    const v=configurePose(characterVolume(this.characterId||'bip',this.characterScale||1,this.volume.ground,this.candidateVolume),this.characterId||'bip',yaw,dance);
    this.poseAttemptAt=time;this.poseAttemptYaw=yaw;this.poseAttemptX=this.position[0];this.poseAttemptZ=this.position[2];this.poseAttemptDance=!!dance;
    // Leaving the all-animation circle is a subset for any heading. Rotating it is invariant.
    const shrinking=this.poseDance,needsCheck=!shrinking&&(!dance||!this.poseDance);
    if(needsCheck&&this.enabled&&this.anchored&&this.supportValid&&this.field.collides(this.position[0],this.position[2],v,time,this.resolver.skin)){
      this.posePending=true;this.volumeUpdateMs=(this.characterVolumeMs||0)+Math.max(0,this.now()-started);return false;
    }
    this.poseYaw=yaw;this.poseDance=!!dance;this.posePending=false;configurePose(this.volume,this.characterId||'bip',yaw,dance);this.volumeUpdateMs=(this.characterVolumeMs||0)+Math.max(0,this.now()-started);return true;
  }
  validatePlacement(time){
    if(!this.enabled||!this.anchored||!this.supportValid||(!this.placementPending&&this.placementState!=='occupied'))return;
    if(!this.map.occupiedCount&&!this.probe.count)return;
    this.placementPenetration=this.field.penetration(this.position[0],this.position[2],this.volume,time,this.resolver.skin);
    const state=this.placementPenetration>0?'occupied':'no-known-overlap';
    if(state!==this.placementState)this.lifecycle('placement-check',state);
    this.placementState=state;this.placementPending=false;
  }
  place(position, support = 1) {
    this.clearProbe('reposition');
    this.anchor.set(position); this.position.set(position);this.volume.ground=position[1]; this.anchored = true;
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
    this.placementState='waiting-for-data';this.placementPending=true;this.placementPenetration=null;this.lifecycle('positioned','apoio adotado; aguardar evidência antes de classificar');
  }
  clearReference() {
    this.clearProbe('reference-reset');
    this.anchored = false; this.supportValid = false; this.map.clear(); this.projector.clear();
    this.depths.fill(0); this.points.fill(0); this.used = this.sampled = this.updates = 0;
    this.lastData = this.lastSample = -Infinity; this.coverage = 0; this.blocked = false; this.direction = '';
    this.anchor.fill(0); this.position.fill(0); this.point.fill(0); this.volume.ground = 0;
    this.normal.fill(0); this.normal[1] = 1;
    this.depthState = 'waiting'; this.hz = 0; this.reconstructionMs = this.queryMs = null;
  }
  setEnabled(enabled) {
    this.clearProbe(enabled?'collisions-enabled':'collisions-disabled');
    this.enabled = !!enabled && this.sessionActive;
    this.map.clear(this.anchored && this.supportValid ? this.anchor : null, this.normal);
    this.projector.clear(); this.point.fill(0);
    this.depths.fill(0); this.points.fill(0);
    this.interval = 125; this.columns = 24; this.rows = 18;
    this.fastUpdates = 0;
    this.lastSample = this.lastData = this.lastRender = -Infinity; this.updates = 0; this.coverage = 0;
    this.enabledAt = NaN;this.placementPending=this.anchored;this.placementState=this.anchored?'waiting-for-data':'not-placed';
    this.blocked = false; this.direction = ''; this.depthState = 'waiting'; this.used = this.sampled = 0;
    this.visual = false; if (this.elements.visualToggle) this.elements.visualToggle.checked = false;
    if (this.elements.canvas) this.elements.canvas.hidden = true;
    this.context?.clearRect(0, 0, 128, 128);
    if (this.elements.toggle) this.elements.toggle.checked = this.enabled;
  }
  setVisibility(state){const next=state!=='visible';if(next!==this.suspended)this.lifecycle(next?'suspended':'resumed',state);this.suspended=next;this.visibilityState=state;this.previousFrame=NaN;}
  frame(time, poseValid) {
    if (!this.enabled||this.suspended) return;
    this.time = time; this.frameDt = Number.isFinite(this.previousFrame) ? Math.max(0, time - this.previousFrame) / 1000 : .05; this.previousFrame = time; if (!Number.isFinite(this.enabledAt)) this.enabledAt = time;
    this.blocked = false; this.direction = ''; this.blockSource = '';
    if (!poseValid && this.tracking) {
      this.clearProbe('tracking-invalid');
      this.map.clear(this.anchored && this.supportValid ? this.anchor : null, this.normal);
      this.projector.clear(); this.depths.fill(0); this.points.fill(0);
      this.coverage = 0; this.lastData = -Infinity; this.updates = 0;
      this.used = this.sampled = 0; this.point.fill(0);
      this.hz = 0;
    }
    this.tracking = !!poseValid;
    if (time - this.lastPurge >= 250) {
      this.map.maintain(time); this.lastPurge = time;
      this.coverage = this.map.coverage(this.position[0], this.position[2], this.volume, time);
    }
  }
  wantsDepth(time) {
    return !this.suspended && this.enabled && this.available && this.anchored && this.supportValid && this.tracking &&
      (time - this.lastSample >= this.interval || (time - this.intentTime < 150 && time - this.probe.lastUpdate >= this.probeInterval));
  }
  missing(time, reason) {
    this.probe.inactiveReason = 'aguardando dados: '+reason;
    this.lastSample = time; this.probe.lastUpdate = time; this.depthState = reason; this.used = this.sampled = 0; this.hz = 0;
    this.depths.fill(0); this.points.fill(0); this.point.fill(0);
  }
  accept(time, reader, info, view) {
    const projectionStart=this.now();
    if (!this.projector.configure(info, view)) { this.missing(time, 'geometry'); return; }
    this.projectionMs=Math.max(0,this.now()-projectionStart);
    const mapDue = time - this.lastSample >= this.interval;
    this.map.centerX = this.position[0]; this.map.centerZ = this.position[2]; this.map.height = this.volume.height;
    if (time - this.intentTime < 150 && time - this.probe.lastUpdate >= this.probeInterval) {
      const probeStarted = this.now();
      this.probe.update(time, reader, this.projector, view.projectionMatrix, this.position, this.volume, this.intentX, this.intentZ, this.map);
      this.probe.costMs = Math.max(0, this.now() - probeStarted);this.probeInterval = this.probe.costMs > 2 ? 125 : 66;
    }
    if (!mapDue) return;
    this.lastSample = time;const mapStarted=this.now(),columns=this.columns,rows=this.rows;
    this.depths.fill(0);this.sampled=columns*rows;
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const d=reader.at((x+.5)/columns,(y+.5)/rows,true);if(d!==null&&d>=.15&&d<=6)this.depths[y*columns+x]=d;
    }
    this.gridReadMs=Math.max(0,this.now()-mapStarted);const pointStarted=this.now();let count=0;
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const i=y*columns+x,d=this.depths[i];if(!d)continue;
      const tolerance=Math.max(.08,d*.04);let neighbors=0;
      if(x&&this.depths[i-1]&&Math.abs(this.depths[i-1]-d)<=tolerance)neighbors++;
      if(x+1<columns&&this.depths[i+1]&&Math.abs(this.depths[i+1]-d)<=tolerance)neighbors++;
      if(y&&this.depths[i-columns]&&Math.abs(this.depths[i-columns]-d)<=tolerance)neighbors++;
      if(y+1<rows&&this.depths[i+columns]&&Math.abs(this.depths[i+columns]-d)<=tolerance)neighbors++;
      if(neighbors<2||!this.projector.point((x+.5)/columns,(y+.5)/rows,d,this.point))continue;
      const j=count++*3;this.points[j]=this.point[0];this.points[j+1]=this.point[1];this.points[j+2]=this.point[2];
    }
    this.pointReconstructionMs=Math.max(0,this.now()-pointStarted);const updateStarted=this.now();
    this.map.begin(time,this.position,this.volume.height,this.projector.pose);
    if(this.probe.lastUpdate===time)for(let i=0;i<this.probe.sampleCount;i++)if(this.probe.coherent[i])this.map.observe(this.probe.samples[i*3],this.probe.samples[i*3+1],this.probe.samples[i*3+2]);
    for(let i=0;i<count*3;i+=3)this.map.observe(this.points[i],this.points[i+1],this.points[i+2]);
    this.mapUpdateMs=Math.max(0,this.now()-updateStarted);const geometryStarted=this.now();this.map.finishGeometry();this.contactGeometryMs=Math.max(0,this.now()-geometryStarted);
    const freeStarted=this.now(),pose=this.projector.pose;this.freeRayCount=0;this.rayStamp++;
    // Keep every reconstructed occupied endpoint. Bound only redundant free-space rays,
    // with nearby geometry first and a rotating distributed remainder over the same samples.
    for(let i=0;i<count&&this.freeRayCount<32;i++){
      const j=i*3,dx=this.points[j]-this.position[0],dz=this.points[j+2]-this.position[2];
      if(dx*dx+dz*dz>1)continue;
      this.map.traceFree(pose[12],pose[13],pose[14],this.points[j],this.points[j+1],this.points[j+2]);this.rayTags[i]=this.rayStamp;this.freeRayCount++;
    }
    const stride=Math.max(1,Math.floor(count/96));
    for(let k=0;k<count&&this.freeRayCount<96;k++){
      const i=(this.rayCursor+k*stride)%count;if(this.rayTags[i]===this.rayStamp)continue;const j=i*3;
      this.map.traceFree(pose[12],pose[13],pose[14],this.points[j],this.points[j+1],this.points[j+2]);this.rayTags[i]=this.rayStamp;this.freeRayCount++;
    }
    if(count)this.rayCursor=(this.rayCursor+1)%count;
    this.freeRayMs=Math.max(0,this.now()-freeStarted);
    const currentProbe=this.probe.lastUpdate===time&&this.probe.used>0;
    this.used=count;this.depthState=count||currentProbe?'available':'waiting';
    if(count||currentProbe){if(Number.isFinite(this.lastData)&&time>this.lastData)this.hz=1000/(time-this.lastData);this.lastData=time;this.updates++;}
    this.coverage=this.map.coverage(this.position[0],this.position[2],this.volume,time);
    this.reconstructionMs=Math.max(0,this.now()-mapStarted);
    this.revalidator.update(time,reader,this.projector,view.projectionMatrix,this.map,this.position,this.volume,this.intentX,this.intentZ);
    this.map.finishGeometry();this.validatePlacement(time);this.adaptSpatial(this.reconstructionMs+(this.revalidator.costMs||0));
  }
  adaptSpatial(cost) {
    if(cost>4){this.interval=Math.min(500,this.interval*1.5);this.columns=16;this.rows=12;this.fastUpdates=0;this.adaptiveReason='custo espacial >4 ms';this.lastReduction=this.time;}
    else if(cost<3.2){
      this.fastUpdates++;const needed=cost<2?8:16;
      this.adaptiveReason=cost<2?'recuperação: custo <2 ms':'recuperação com 20% de folga no orçamento de 4 ms';
      if(this.fastUpdates>=needed&&this.interval>125){this.interval=Math.max(125,this.interval*.8);this.fastUpdates=0;}
      else if(this.fastUpdates>=16&&this.interval===125){this.columns=24;this.rows=18;this.fastUpdates=0;}
    }else{this.fastUpdates=0;this.adaptiveReason='custo entre 3,2 e 4 ms; aguardando folga';}
  }
  move(position, dx, dz, time) {
    const moveStarted=this.now();this.map.currentBlockCount=0;this.map.currentBlockCells.fill(null);this.contact=null;
    if(this.enabled&&(this.guided||this.suspended)){this.result.x=position[0];this.result.z=position[2];return this.result;}
    if (this.enabled && Math.hypot(dx, dz) > 1e-8) {
      this.intentX = dx; this.intentZ = dz; this.intentTime = time;
    }
    this.penetrationBefore=this.penetrationTarget=null;
    if(this.enabled && this.anchored && this.supportValid){this.penetrationBefore=this.field.penetration(position[0],position[2],this.volume,time,this.resolver.skin);this.penetrationTarget=this.field.penetration(position[0]+dx,position[2]+dz,this.volume,time,this.resolver.skin);}
    this.result.x = position[0] + dx; this.result.z = position[2] + dz;
    this.blocked = false; this.direction = ''; this.blockSource = '';
    if (this.enabled && this.anchored && this.supportValid && (this.map.occupiedCount > 0 || this.probe.count > 0)) {
      const solved = this.resolver.move(this.field, position, dx, dz, this.volume, time);
      this.result.x = solved.x; this.result.z = solved.z; this.blocked = solved.blocked; this.direction = solved.direction;
      this.coverage = solved.coverage; this.queryMs = Math.max(0, this.now() - moveStarted);
      if (this.blocked) {
        this.blockSource = solved.sourceBits === 3 ? 'ambos' : solved.sourceBits === 2 ? 'sonda imediata' : solved.sourceBits === 1 ? 'mapa persistente' : 'limite de deslocamento';
        this.blockEvidence=solved.evidenceBits===3?'evidência atual e memória espacial':solved.evidenceBits===2?'memória espacial':solved.evidenceBits===1?'evidência atual':null;
        this.contact=this.map.commitBlock(solved.x,solved.z,this.volume,time,this.resolver.skin)||this.probe.contactAt(solved.x,solved.z,this.volume,time,this.resolver.skin);
        this.blockConfirmation = solved.confirmationTime;
        this.lastBlockedTime = time; this.lastBlockedDirection = this.direction;
      }
    } else if (this.enabled && this.anchored && this.supportValid) {
      this.coverage = this.map.coverage(this.result.x, this.result.z, this.volume, time);
    }
    if(this.enabled)this.queryMs=Math.max(0,this.now()-moveStarted);
    if (this.enabled && Math.hypot(dx,dz)>1e-8) {
      if(time-this.lastSlotTime>=250){this.eventCursor=(this.eventCursor+1)%32;this.eventCount=Math.min(32,this.eventCount+1);this.lastSlotTime=time;}
      const event=this.events[(this.eventCursor+31)%32];
      event.contactSupportRadius=this.contact?.volumeRadius??null;event.radiusMeaning='conservative-search-envelope';event.sourceMeaning='rejected-attempts-in-this-move';event.volumeMode=this.volume.poseMode||'legacy';event.volumeYaw=this.poseYaw;event.volumeUpdateMs=this.volumeUpdateMs;event.posePending=this.posePending;event.placementState=this.placementState;event.partialAdvance=!!this.resolver.result.usedPartial;
      event.mapGeneration=this.mapGeneration;event.rawX=this.rawX;event.rawZ=this.rawZ;event.transformedX=this.controlX;event.transformedZ=this.controlZ;
      event.probeDirectionX=this.probe.directionX;event.probeDirectionZ=this.probe.directionZ;event.probeTime=Number.isFinite(this.probe.acquiredTime)?this.probe.acquiredTime:null;
      event.previousX=position[0];event.previousY=position[1];event.previousZ=position[2];event.wantedY=event.finalY=position[1];event.wantedX=position[0]+dx;event.wantedZ=position[2]+dz;event.finalX=this.result.x;event.finalZ=this.result.z;
      event.penetrationBefore=this.penetrationBefore;event.penetrationTarget=this.penetrationTarget;event.contactBefore=this.blocked?this.resolver.result.before:null;event.contactTarget=this.blocked?this.resolver.result.after:null;event.rejection=this.blocked?this.resolver.result.reason:null;
      event.surfaceDistance=this.contact?.surfaceDistance??null;event.contactClearance=this.contact?.clearance??null;event.contactMargin=this.map.config.pointMargin;event.contactSkin=this.resolver.skin;event.contactCellId=this.contact?.cellId??null;
      event.failureSource=this.blocked?this.resolver.result.failureSource:null;event.failureCellId=this.blocked?this.resolver.result.failureCellId:null;event.failureStage=this.blocked?this.resolver.result.failureStage:null;event.rejectedStepDx=this.blocked?this.resolver.result.failureDx:null;event.rejectedStepDz=this.blocked?this.resolver.result.failureDz:null;event.contactMeasurement='representative-final-position';event.rejectionMeasurement='last-rejected-subquery';
      event.contactDistance=this.blocked?this.resolver.result.distance:null;event.evidenceAge=this.blocked&&Number.isFinite(this.blockConfirmation)?Math.max(0,time-this.blockConfirmation):null;
      event.supportPlaneYAtCharacter=this.supportAt(this.result.x,this.result.z);event.supportY=this.volume.ground;event.supportNormalX=this.normal[0];event.supportNormalY=this.normal[1];event.supportNormalZ=this.normal[2];event.renderedBase=this.renderedBase;event.supportDifference=this.renderedBase==null?null:this.renderedBase-this.volume.ground;event.shadowY=this.shadowY;event.visualJump=this.jumpY;
      event.time=time;event.dx=dx;event.dz=dz;event.actualX=this.result.x-position[0];event.actualZ=this.result.z-position[2];
      event.memorySource=this.blocked?this.blockEvidence:null;event.revalidationMs=this.revalidator.costMs;event.memoryAgeMs=this.blocked&&Number.isFinite(this.resolver.result.mapConfirmationTime)?Math.max(0,time-this.resolver.result.mapConfirmationTime):null;event.probeEvidenceAgeMs=this.blocked&&Number.isFinite(this.resolver.result.probeConfirmationTime)?Math.max(0,time-this.resolver.result.probeConfirmationTime):null;
      event.source=this.blockSource;event.coverage=this.coverage;event.probe=this.probeState(time);event.samples=this.probe.used;
      event.projected=this.probe.projected;event.invalid=this.probe.rejectDepth;event.duplicates=this.probe.rejectDuplicate;event.geometry=this.probe.rejectGeometry;
      event.interval=this.interval;event.hz=this.hz;event.radius=this.volume.radius;event.height=this.volume.height;event.scale=this.characterScale;event.character=this.characterId;
      event.reconstruction=this.reconstructionMs;event.query=this.queryMs;event.probeMs=this.probe.costMs;event.fps=this.frameDt>0?1/this.frameDt:null;event.depth=this.depthState;
      const memory=this.map.stats(time);event.confirmedCells=memory.confirmed;event.consolidatedCells=memory.consolidated;event.awaitingCells=memory.awaiting;event.releasedCells=memory.released;
      this.lastEvent=time;if(this.blocked){Object.assign(this.lastBlock,event);this.lastBlockAvailable=true;}
    }
    this.position[0] = this.result.x; this.position[2] = this.result.z;this.validatePlacement(time);
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
    const planeY=this.supportAt(this.position[0],this.position[2]);
    return {character:this.characterId??null,scale:this.characterScale??null,lifecycle:this.lifecycleSnapshot(),volumeMode:this.volume.poseMode||'legacy',volumeYaw:this.poseYaw,posePending:this.posePending,requestedYaw:this.poseDesiredYaw,volumeUpdateMs:this.volumeUpdateMs,placementState:this.placementState,placementPenetration:this.placementPenetration??null,mapGeneration:this.mapGeneration??0,contact:this.contact?{...this.contact}:null,blockedCells:this.map.blockedDetails(this.time),acquisitionMs:this.acquisitionMs,nativeReadMs:this.nativeReadMs,readerMs:this.readerMs,projectionMs:this.projectionMs,gridReadMs:this.gridReadMs,pointReconstructionMs:this.pointReconstructionMs,mapUpdateMs:this.mapUpdateMs,contactGeometryMs:this.contactGeometryMs,freeRayMs:this.freeRayMs,freeRayCount:this.freeRayCount,adaptiveReason:this.adaptiveReason,lastReduction:this.lastReduction,session:this.sessionId,suspended:!!this.suspended,lastMapClearReason:this.lastMapClearReason??null,guided:this.guided, guidedNewCells:this.guided?this.map.createdCount-this.guidedBaseline:0, memory:this.map.stats(this.time), revalidationMs:this.revalidator.costMs, revalidationChecks:this.revalidator.checks, revalidationQueries:this.revalidator.queries, memoryEvidence:this.blocked?this.blockEvidence:null, enabled: this.enabled, phase: this.phase(), used: this.used, sampled: this.sampled,
      occupied: this.map.occupiedCount, cells: this.map.cells.size, freeCells: this.map.free.size,
      hz: this.hz, reconstructionMs: this.reconstructionMs, queryMs: this.queryMs,
      coverage: this.coverage, direction: this.direction, blocked: this.blocked,
      interval: this.interval, radius: this.volume.radius, height: this.volume.height, depthState: this.depthState,
      blockSource: this.blockSource, probeSamples: this.probe.used, probeTested: this.probe.tested,
      probeSupport: this.probe.support, probeMs: this.probe.costMs, probeState:this.probeState(), eventCount:this.eventCount, lastEventAge:Number.isFinite(this.lastEvent)?Math.max(0,this.time-this.lastEvent):null, configuredHz:1000/this.interval, probeProjected:this.probe.projected, rejectDepth:this.probe.rejectDepth, rejectDuplicate:this.probe.rejectDuplicate, rejectGeometry:this.probe.rejectGeometry, probeValid: this.probe.valid, probeDistinct: this.probe.distinct, probeInRegion: this.probe.inRegionCount, probeRejectDepth: this.probe.rejectDepth, probeRejectDuplicate: this.probe.rejectDuplicate, probeRejectGeometry: this.probe.rejectGeometry,
      confirmationAgeMs: this.blocked && Number.isFinite(this.blockConfirmation) ? Math.max(0, this.time - this.blockConfirmation) : null,
      coverageInsufficient: this.coverage < .6 || this.depthState !== 'available',
      debug3D:this.debug3D, debugVertices:this.debugStats?.count||0, debugBuildMs:this.debugStats?.buildMs??null, debugDrawMs:this.debugStats?.drawMs??null, diagnosticMs:this.diagnosticMs??null, diagnosticTime:Number.isFinite(this.lastRender)?this.lastRender:null,
      supportPlaneYAtCharacter:planeY,baseVsSupportPlane:this.renderedBase==null||planeY===null?null:this.renderedBase-planeY,supportY:this.anchored?this.volume.ground:null, renderedBase:this.renderedBase??null, supportDifference:this.renderedBase==null?null:this.renderedBase-this.volume.ground,shadowY:this.shadowY??null,visualJump:this.jumpY??null,lastBlockAge:this.lastBlockAvailable?Math.max(0,this.time-this.lastBlock.time):null,
      lastBlockedDirection: this.time - this.lastBlockedTime < 900 ? this.lastBlockedDirection : ''};
  }
  render(time, diagnosticOpen) {
    if (time - this.lastRender < 250) return;
    const diagnosticStarted=this.now();this.lastRender = time;
    const {status, readout, canvas, visualToggle} = this.elements;
    if (status) { status.hidden = !this.enabled; status.textContent = this.placementState==='occupied'&&!this.blocked?'Posição sobreposta: afaste-se ou reposicione':STATES[this.phase()]; }
    if(this.elements.mappingButton){this.elements.mappingButton.disabled=!this.enabled||!this.anchored||!this.available||!this.tracking;this.elements.mappingButton.textContent=this.guided?'Concluir mapeamento':'Mapear ambiente';this.elements.mappingButton.setAttribute('aria-pressed',String(this.guided));}
    if(this.elements.mappingReadout){this.elements.mappingReadout.hidden=!this.guided;this.elements.mappingReadout.textContent=this.guided?'Mova lentamente a câmera. Personagem parado. Novas células candidatas: '+(this.map.createdCount-this.guidedBaseline)+'. Conclua para mover.':'';}
    if (visualToggle) visualToggle.disabled = !this.enabled;
    if (readout) readout.textContent = this.enabled && diagnosticOpen ?
      `Pontos úteis: ${this.used}/${this.sampled}\nCélulas ocupadas: ${this.map.occupiedCount} (limite ${this.map.config.maxCells})\nAtualização espacial: ${this.hz ? this.hz.toFixed(1) + ' Hz' : '—'}\nReconstrução: ${this.reconstructionMs === null ? '—' : this.reconstructionMs.toFixed(2) + ' ms'}\nConsulta: ${this.queryMs === null ? '—' : this.queryMs.toFixed(2) + ' ms'}\nCobertura amostrada: ${Math.round(this.coverage * 100)}% (${STATES[this.phase()]})\nDireção bloqueada (XR): ${this.direction || '—'}\nOrigem do bloqueio: ${this.blockSource || 'sem bloqueio atual'}\nSonda: ${this.probe.used}/${this.probe.tested} amostras; apoio local ${this.probe.support} (não é precisão)\nCusto da sonda: ${this.probe.costMs === null ? '—' : this.probe.costMs.toFixed(2) + ' ms'}\nConfirmação do bloqueio: ${this.blocked && Number.isFinite(this.blockConfirmation) ? Math.max(0, time - this.blockConfirmation).toFixed(0) + ' ms atrás' : '—'}\nCobertura: ${this.coverage < .6 || this.depthState !== 'available' ? 'insuficiente; desconhecido não comprova livre' : 'amostrada; não garante espaço livre'}` : '';
    if (readout && this.enabled && diagnosticOpen) readout.textContent += '\nSonda: '+this.probeState(time)+'\nEventos: '+this.eventCount+'; idade: '+(Number.isFinite(this.lastEvent)?(time-this.lastEvent).toFixed(0):'--')+' ms\nAquisicao: '+this.depthState+'\nHz configurado: '+(1000/this.interval).toFixed(1)+'\nProjetados / invalidos / repetidos / geometria: '+[this.probe.projected,this.probe.rejectDepth,this.probe.rejectDuplicate,this.probe.rejectGeometry].join(' / ');
    if (readout && this.enabled && diagnosticOpen && this.eventCount) { const e=this.events[(this.eventCursor+31)%32]; readout.textContent+='\nUltimo movimento: '+[e.dx,e.dz].map(v=>v.toFixed(3)).join(',')+' m; efetivo: '+[e.actualX,e.actualZ].map(v=>v.toFixed(3)).join(',')+' m; origem: '+(e.source||'sem bloqueio'); }
    if(this.elements.debugToggle)this.elements.debugToggle.disabled=!this.enabled;
    if(readout&&this.enabled&&diagnosticOpen)readout.textContent+='\nApoio Y: '+this.volume.ground.toFixed(3)+' m; base renderizada: '+(this.renderedBase==null?'indisponível':this.renderedBase.toFixed(3)+' m')+'\nÚltimo bloqueio preservado: '+(this.lastBlockAvailable?Math.max(0,time-this.lastBlock.time).toFixed(0)+' ms; '+this.lastBlock.source:'indisponível');
    if(readout&&this.enabled&&diagnosticOpen)readout.textContent+='\nPlano no personagem: '+(this.supportAt(this.position[0],this.position[2])?.toFixed(3)??'indisponível')+' m';
    if(readout&&this.enabled&&diagnosticOpen){readout.textContent+='\nÚltima limpeza: '+(this.lastMapClearReason||'indisponível')+'\nAdaptação: '+(this.adaptiveReason||'aguardando')+'\nAquisição / grade / pontos / mapa / raios / revalidação (ms): '+[this.acquisitionMs,this.gridReadMs,this.pointReconstructionMs,this.mapUpdateMs,this.freeRayMs,this.revalidator.costMs].map(v=>v==null?'—':v.toFixed(2)).join(' / ')+'\nRaios livres: '+this.freeRayCount+' (máximo 96)';if(this.contact)readout.textContent+='\nContato estimado: centro→superfície '+this.contact.surfaceDistance.toFixed(3)+' m; folga do volume '+this.contact.clearance.toFixed(3)+' m; margem/pele '+this.map.config.pointMargin+'/'+this.resolver.skin+' m; célula '+this.contact.cellId+'; '+this.contact.state+'; evidências livres '+this.contact.freeEvidence;}
    if(readout&&this.enabled&&diagnosticOpen){const m=this.map.stats(time);readout.textContent+='\nMemória: '+m.candidates+' candidatas; '+m.confirmed+' confirmadas totais; '+m.consolidated+' consolidadas; '+m.awaiting+' aguardando revalidação\nIdade máxima: '+(m.oldestAgeMs===null?'indisponível':(m.oldestAgeMs/1000).toFixed(1)+' s')+'\nRevalidadas / liberadas / expiradas: '+[m.revalidated,m.released,m.expired].join(' / ')+'\nOclusas preservadas: '+m.occluded+'; observações oclusas: '+m.occlusionObservations+'\nSaturação / descartes / recusas: '+[m.saturated,m.evicted,m.rejected].join(' / ')+'\nRevalidação: '+(this.revalidator.costMs===null?'indisponível':this.revalidator.costMs.toFixed(2)+' ms')+'; consultas '+this.revalidator.queries+'\nManutenção: '+(m.maintenanceMs===null?'indisponível':m.maintenanceMs.toFixed(2)+' ms')+'\nMapeamento guiado: '+(this.guided?'ativo':'desativado')+'\nBloqueio temporal: '+(this.blocked?this.blockEvidence:'sem bloqueio atual');}
    if(readout&&this.enabled&&diagnosticOpen)readout.textContent+='\nVolume: '+(this.volume.poseMode||'legacy')+'; yaw '+this.poseYaw.toFixed(3)+'; '+(this.posePending?'orientação aguardando espaço':'pose ativa')+'\nAtualização do volume: '+(this.volumeUpdateMs==null?'—':this.volumeUpdateMs.toFixed(3)+' ms')+'\nPosicionamento: '+this.placementState+'\nEtapa rejeitada: '+(this.lastBlockAvailable?this.lastBlock.failureStage||'—':'—')+'; fonte da consulta: '+(this.lastBlockAvailable?this.lastBlock.failureSource||'—':'—');
    this.diagnosticMs=Math.max(0,this.now()-diagnosticStarted);
    if (!canvas) return;
    canvas.hidden = !this.enabled || !this.visual || !diagnosticOpen;
    if (canvas.hidden || time - this.lastDraw < 500) return;
    this.lastDraw = time;
    this.context ||= canvas.getContext('2d'); if (!this.context) return;
    const c = this.context, scale = 128 / (this.map.config.radius * 2), s = this.map.config.cellSize, o = this.map.origin;
    c.fillStyle = '#101522'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#fa7373';
    let drawn = 0;
    for (const cell of this.map.cells.values()) {
      if (!cell.confirmed || !this.map.valid(cell,time) || cell.minY >= this.volume.ground + this.volume.height) continue;
      if (drawn++ >= 512) break;
      const x = o[0] + cell.ix * s, z = o[2] + cell.iz * s;
      c.fillRect(64 + (x - this.position[0]) * scale, 64 + (z - this.position[2]) * scale, Math.max(1, s * scale), Math.max(1, s * scale));
    }
    c.strokeStyle = '#b7f36e'; c.lineWidth = 1; c.beginPath(); c.arc(64, 64, this.volume.radius * scale, 0, 2 * Math.PI); c.stroke();this.diagnosticMs=Math.max(0,this.now()-diagnosticStarted);
  }
  stop(reason='session-end') {
    this.clearProbe(reason);this.suspended=false;
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
    this.time = 0; this.frameDt = .05; this.previousFrame = NaN; this.enabledAt = NaN;
    this.context?.clearRect(0, 0, 128, 128); this.context = null;
    if (this.elements.toggle) this.elements.toggle.checked = false;
    if (this.elements.visualToggle) this.elements.visualToggle.checked = false;
    if (this.elements.status) this.elements.status.hidden = true;
    if (this.elements.readout) this.elements.readout.textContent = '';
    if (this.elements.canvas) this.elements.canvas.hidden = true;
  }
  clearEvents() {
    this.map.lastBlockCells.fill(null);this.map.blockCellCount=0;this.map.lastMapBlockTime=-Infinity;
    this.lastBlock ||= {};for(const key of Object.keys(this.lastBlock))delete this.lastBlock[key];this.lastBlockAvailable=false;
    this.events ||= Array.from({length:32},()=>({}));for(const event of this.events)for(const key of Object.keys(event))delete event[key];this.eventCount=this.eventCursor=0;this.lastEvent=this.lastSlotTime=-Infinity;
  }
  clearProbe(reason='map-clear') {
    if(this.sessionActive){this.lifecycle(reason);this.time=Math.max(this.time||0,this.now());const events=[];for(let i=0;i<this.eventCount;i++)events.push(this.events[(this.eventCursor-this.eventCount+i+32)%32]);this.archive.capture(this.sessionId,this.sessionOrigin,reason,events,this.lastBlockAvailable?this.lastBlock:null,this.snapshot());}
    if(this.elements.copyButton)this.elements.copyButton.textContent='Copiar diagnóstico textual';if(this.elements.feedback)this.elements.feedback.textContent='';
    this.posePending=false;this.poseDesiredYaw=this.poseYaw||0;this.poseAttemptAt=-Infinity;this.placementState='not-placed';this.placementPending=false;this.placementPenetration=null;
    this.contact=null;this.lastRender=-Infinity;if(this.elements.status){this.elements.status.hidden=true;this.elements.status.textContent='';}
    this.lastMapClearReason=reason;this.mapGeneration=(this.mapGeneration||0)+1;
    this.acquisitionMs=this.nativeReadMs=this.readerMs=this.projectionMs=this.gridReadMs=this.pointReconstructionMs=this.mapUpdateMs=this.contactGeometryMs=this.freeRayMs=null;this.freeRayCount=0;this.adaptiveReason=null;this.lastReduction=null;this.rayTags.fill(0);this.rayStamp=this.rayCursor=0;
    this.revalidator.clear();this.guided=false;this.guidedBaseline=0;
    if(this.elements.mappingButton){this.elements.mappingButton.disabled=true;this.elements.mappingButton.textContent='Mapear ambiente';this.elements.mappingButton.setAttribute('aria-pressed','false');}
    if(this.elements.mappingReadout){this.elements.mappingReadout.hidden=true;this.elements.mappingReadout.textContent='';}
    this.clearEvents();
    this.rawX=this.rawZ=this.controlX=this.controlZ=null;this.renderedBase=this.shadowY=this.jumpY=null;
    this.debug3D=false;if(this.elements.debugToggle)this.elements.debugToggle.checked=false;
    this.probe.clear(); this.intentX = this.intentZ = 0; this.intentTime = -Infinity;
    this.probeInterval = 66; this.blockEvidence=null;this.blockSource = ''; this.blockConfirmation = -Infinity;
    this.lastBlockedTime = -Infinity; this.lastBlockedDirection = '';
  }
}
