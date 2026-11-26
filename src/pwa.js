import {BUILD} from './build.js';
export class PWAUpdates {
  constructor({serviceWorker=globalThis.navigator?.serviceWorker,reload=()=>globalThis.location.reload(),active=()=>false}={}) {
    this.sw=serviceWorker;this.reload=reload;this.active=active;this.state=serviceWorker?'starting':'unsupported';this.updateAvailable=false;this.compatible=!serviceWorker;this.applying=false;
  }
  snapshot(){return {...BUILD,serviceWorker:this.state,controllerState:this.sw?.controller?.state||'none',controllerRevision:this.controllerBuild?.revision??null,updateAvailable:this.updateAvailable,updateBlocked:!!this.active()};}
  changed(){this.onchange?.(this.snapshot());}
  async identify(worker){
    if(!worker)return null;
    return new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null)},1200);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data)};worker.postMessage({type:'BUILD_INFO'},[channel.port2]);});
  }
  async watch(){
    const identity=await this.identify(this.sw.controller);
    this.controllerBuild=identity;
    this.compatible=identity?.revision===BUILD.revision&&identity?.cache===BUILD.cache;
    this.updateAvailable=!!this.registration?.waiting||!!identity&&!this.compatible;
    this.state=this.updateAvailable?'waiting':this.compatible?'controlled':this.registration?.installing?'installing':'controller-mismatch';this.changed();
  }
  async start(){
    if(!this.sw){this.changed();return;}
    try{
      this.sw.addEventListener('controllerchange',async()=>{if(this.applying&&!this.active()){this.reload();return;}await this.watch();});
      this.registration=await this.sw.register('./sw.js',{type:'module',updateViaCache:'none'});
      const installing=this.registration.installing;
      if(installing&&installing.state!=='activated'&&installing.state!=='installed')await new Promise(resolve=>installing.addEventListener('statechange',()=>{if(['installed','activated','redundant'].includes(installing.state))resolve();}));
      if(!this.sw.controller){await this.sw.ready;for(let i=0;i<40&&!this.sw.controller;i++)await new Promise(r=>setTimeout(r,25));}
      this.registration.addEventListener('updatefound',()=>{const worker=this.registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')this.watch();});});
      await this.watch();
    }catch{this.state='error';this.changed();}
  }
  apply(){
    if(this.active()||!this.updateAvailable)return false;
    this.applying=true;
    if(this.registration?.waiting)this.registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
    else if(this.controllerBuild&&!this.compatible)this.reload();
    else return false;
    return true;
  }
  render(){
    const el=globalThis.document?.getElementById('updateApp'),out=globalThis.document?.getElementById('buildStatus');
    if(el){el.hidden=!this.updateAvailable;el.disabled=!!this.active();el.textContent=this.active()?'Atualização disponível — encerre AR ou gravação':'Atualização disponível — atualizar';el.onclick=()=>this.apply();}
    if(out)out.textContent=`v${BUILD.version} · ${BUILD.revision} · cache ${BUILD.cache} · SW ${this.state}${this.updateAvailable?' · atualização disponível':''}`;
  }
}
export const pwa=new PWAUpdates();
