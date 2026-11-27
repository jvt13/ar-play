import {SupportSurfaces} from './support-surfaces.js';
// Application adapter only reads the completed reconstruction. There is no reverse link
// into motion, collision queries, height, ground classification or acquisition scheduling.
export class SupportView{
 constructor(engine,elements={},now=()=>performance.now()){
  this.engine=engine;this.elements=elements;this.now=now;this.layer=new SupportSurfaces(now);this.resource={};this.camera=new Float64Array(3);
  this.data=new Float32Array(512*6*6);this.groups=[[.1,1,.2,.32],[0,.8,1,.38],[1,.85,.1,.35],[.65,.25,1,.35]].map(color=>({color,triangles:true,overlay:true,first:0,count:0}));
  this.groups.push({color:[1,.85,.1,1],points:true,overlay:true,first:0,count:0});
  this.visual=false;this.disabled=false;this.count=this.buildUpdates=0;this.buildMs=this.drawMs=null;this.lastBuild=this.lastReadout=-Infinity;this.lastAcquisition=-Infinity;this.generation=null;this.session=null;
  if(elements.toggle)elements.toggle.onchange=()=>{this.visual=!!elements.toggle.checked;this.lastBuild=-Infinity;if(!this.visual)this.release();};
 }
 release(){this.engine?.releaseDebug?.(this.resource);this.count=0;for(const g of this.groups)g.count=0;this.data.fill(0);}
 reset(){this.layer.reset(0,[0,0,0]);this.camera.fill(0);this.generation=null;this.session=null;this.lastAcquisition=-Infinity;this.lastBuild=this.lastReadout=this.lastMaintenance=-Infinity;this.buildMs=this.drawMs=null;this.buildUpdates=0;this.release();}
 stop(){this.reset();this.disabled=false;this.visual=false;if(this.elements.toggle)this.elements.toggle.checked=false;if(this.elements.readout)this.elements.readout.textContent='';}
 update(source,time,panelOpen=false){
  try{this.consume(source,time,panelOpen);}catch{this.disabled=true;this.layer.state='unavailable';this.release();}
 }
 consume(source,time,panelOpen=false){
  if(this.generation!==source.mapGeneration||this.session!==source.sessionId){
   this.layer.reset(source.mapGeneration??0,source.anchor,source.normal);this.generation=source.mapGeneration;this.session=source.sessionId;this.lastAcquisition=-Infinity;this.lastBuild=-Infinity;this.release();
  }
  if(this.disabled){this.layer.state='unavailable';if(this.count||this.resource.debugBuffer)this.release();this.readout(time,panelOpen);return;}
  if(time-(this.lastMaintenance??-Infinity)>=250){this.layer.maintain(time);this.lastMaintenance=time;}
  if(!source.sessionActive||!source.anchored||source.suspended||!source.tracking||!source.available){this.layer.state=!source.available?'depth-unavailable':'waiting-for-reconstruction';this.release();this.readout(time,panelOpen);return;}
  if(source.lastSample!==this.lastAcquisition&&Number.isFinite(source.lastSample)){
   this.lastAcquisition=source.lastSample;const p=source.projector.pose;this.camera[0]=p[12];this.camera[1]=p[13];this.camera[2]=p[14];
   this.layer.update(time,source.points,source.used,this.camera);
  }else if(!source.enabled)this.layer.state='waiting-for-reconstruction';
  else if(Number.isFinite(this.lastAcquisition)&&time-this.lastAcquisition>=this.layer.config.revalidateAfter)this.layer.state='awaiting-reobservation';
  if(this.visual&&time-this.lastBuild>=250){this.build(time);this.lastBuild=time;}
  this.readout(time,panelOpen);
 }
 readout(time,panelOpen){
  if(panelOpen&&this.elements.readout&&time-this.lastReadout>=500){
   const s=this.layer.snapshot(time);this.elements.readout.textContent='Superfícies de apoio (passivas): '+s.state+'\nRegiões: '+s.regions+'; candidatas '+s.candidateRegions+'; confirmadas '+s.confirmedRegions+'; revalidação '+s.revalidatingRegions+'\nInvalidações: '+s.invalidatedRegions+' regiões / '+s.invalidatedTiles+' sub-regiões; rejeições de hipóteses: vertical '+s.rejectedVertical+', geometria '+s.rejectedGeometry+', curva/mista '+s.rejectedCurved+'\nAmostras '+s.samples+'; sementes processadas '+s.processed+'; adiadas '+s.deferred+'\nAtualização '+(s.updateMs==null?'—':s.updateMs.toFixed(2)+' ms')+'; consulta '+(s.queryMs==null?'—':s.queryMs.toFixed(2)+' ms')+'\n'+s.summaries.slice(0,4).map(v=>'#'+v.id+' '+(v.relativeHeight>=0?'+':'')+v.relativeHeight.toFixed(2)+' m; '+v.inclination.toFixed(1)+'°; '+v.observedArea.toFixed(3)+' m²; '+v.state).join('\n')+'\nPotencial geométrico, sem garantia de sustentação ou caminhada. Limites sem evidência são cobertura desconhecida.'+(s.state==='waiting-for-reconstruction'?' Aguardando amostras: ative colisões e observe a região.':'');this.lastReadout=time;
  }
 }
 build(time){
  const started=this.now(),layer=this.layer,q=layer.config.cellSize/4;this.count=0;
  for(let group=0;group<4;group++){
   const batch=this.groups[group];batch.first=this.count;
   for(const r of layer.regions){if(!r.active)continue;
    for(let b=0;b<16;b++){const bit=1<<b,color=!(r.confirmedMask&bit)?2:time-r.seen[b]>=layer.config.revalidateAfter||r.free[b]>0?3:layer.kind(r)==='reference-floor'?0:1;if(!(r.mask&bit)||color!==group||this.count+6>512*6)continue;
     const x=layer.origin[0]+r.ix*layer.config.cellSize+b%4*q,z=layer.origin[2]+r.iz*layer.config.cellSize+Math.floor(b/4)*q;
     for(let k=0;k<6;k++){const px=x+(k===1||k===2||k===4?q:0),pz=z+(k===2||k===4||k===5?q:0),j=this.count++*6;this.data[j]=px;this.data[j+1]=r.a*px+r.b*pz+r.c+.002;this.data[j+2]=pz;this.data[j+3]=r.nx;this.data[j+4]=r.ny;this.data[j+5]=r.nz;}
    }
   }
   batch.count=this.count-batch.first;
  }
  const points=this.groups[4];points.first=this.count;
  for(const r of layer.regions)if(r.active&&r.pointOnly&&this.count<512*6){const j=this.count++*6;this.data[j]=r.pinX;this.data[j+1]=r.pinY;this.data[j+2]=r.pinZ;this.data[j+3]=r.nx;this.data[j+4]=r.ny;this.data[j+5]=r.nz;}
  points.count=this.count-points.first;
  this.buildUpdates++;this.buildMs=Math.max(0,this.now()-started);
 }
 draw(){if(!this.visual||this.disabled||!this.count)return;const started=this.now();try{this.engine.drawDebug(this.data,this.groups,this.resource);this.drawMs=Math.max(0,this.now()-started);}catch{this.disabled=true;this.layer.state='unavailable';this.release();}}
 snapshot(time=this.layer.time){return {...this.layer.snapshot(time),visual:this.visual,unavailable:this.disabled,vertices:this.count,visualBuildUpdates:this.buildUpdates,visualBuildMs:this.buildMs,visualDrawMs:this.drawMs,visualCpuBytes:this.data.byteLength,visualGpuBytes:this.resource.debugBuffer?this.data.byteLength:0};}
}
