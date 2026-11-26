// One bounded, anonymous text record in JS memory only. Never writes browser storage.
const EVENT_FIELDS=['mapGeneration','rawX','rawZ','transformedX','transformedZ','probeDirectionX','probeDirectionZ','dx','dz','actualX','actualZ','source','memorySource','rejection','contactDistance','surfaceDistance','contactCellId','contactClearance','contactMargin','contactSkin','memoryAgeMs','probeEvidenceAgeMs','penetrationBefore','penetrationTarget','contactBefore','contactTarget','coverage','samples','projected','invalid','duplicates','geometry','interval','hz','radius','height','scale','character','reconstruction','query','probeMs','fps','depth','revalidationMs','confirmedCells','consolidatedCells','awaitingCells','releasedCells','supportDifference','visualJump'];
const STATE_FIELDS=['phase','coverage','depthState','hz','interval','reconstructionMs','queryMs','revalidationMs','acquisitionMs','gridReadMs','pointReconstructionMs','mapUpdateMs','freeRayMs','freeRayCount','adaptiveReason','guided','supportDifference','baseVsSupportPlane','diagnosticMs'];
function scalars(source,fields){const out={};for(const key of fields){const value=source?.[key];if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))out[key]=value;else if(typeof value==='string')out[key]=value.slice(0,160);}return out;}
function bounded(record){while(new TextEncoder().encode(JSON.stringify(record,null,2)).length>32000&&record.events.length)record.events.shift();}
export class DiagnosticArchive {
  constructor(now=()=>performance.now()){this.now=now;this.sequence=0;this.last=null;}
  begin(){return 'AR-'+(++this.sequence);}
  capture(session,origin,reason,events,block,state){
    if(!session)return;
    // An empty new session must not erase the last useful failure from another session.
    const manual=String(reason).startsWith('manual-');
    const sameContext=this.last?.session===session&&this.last?.mapGeneration===(state?.mapGeneration??0);
    if(!manual&&!events.length&&!block&&this.last&&!sameContext){if(this.last.session===session){this.last.reasons=this.last.reasons.slice(-7);this.last.reasons.push({atMs:Math.max(0,this.now()-origin),reason:String(reason).slice(0,160),mapGeneration:state?.mapGeneration??0});this.last.reason=String(reason).slice(0,160);bounded(this.last);this.onchange?.();}return;}
    const clean=e=>e?{atMs:Math.max(0,e.time-origin),...scalars(e,EVENT_FIELDS)}:null;
    const same=!manual&&sameContext;
    const reasons=same?this.last.reasons.slice(-7):[];
    reasons.push({atMs:Math.max(0,this.now()-origin),reason:String(reason).slice(0,160)});
    const record={version:'1.1.5',session,mapGeneration:state?.mapGeneration??0,scope:'diagnóstico textual anônimo; sem geometria ou coordenadas absolutas',reason:String(reason).slice(0,160),reasons,lastBlock:clean(block)||(same?this.last.lastBlock:null),events:events.slice(-32).map(clean),state:scalars(state,STATE_FIELDS)};
    if(state?.memory)record.state.memory=scalars(state.memory,['candidates','confirmed','consolidated','awaiting','occluded','oldestAgeMs','revalidated','released','expired','evicted','rejected','saturated','maintenanceMs']);
    if(same&&!record.events.length)record.events=this.last.events;
    bounded(record);
    this.last=record;this.onchange?.();
  }
  text(){return this.last?JSON.stringify(this.last,null,2):'';}
  clear(){this.last=null;this.onchange?.();}
  async copy(text,clipboard=globalThis.navigator?.clipboard){
    try{if(!text)throw Error('empty');if(!clipboard?.writeText)throw Error('clipboard unavailable');await clipboard.writeText(text);return {ok:true,message:'Diagnóstico copiado.'};}
    catch{return {ok:false,message:'Falha na cópia. Use Exportar diagnóstico para salvar o texto localmente.'};}
  }
}
