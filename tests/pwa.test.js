import test from 'node:test';import assert from 'node:assert/strict';
import {BUILD} from '../src/build.js';import {PWAUpdates} from '../src/pwa.js';
function fixture({active=false,legacy=false,waiting=false}={}){
  const worker={identity:legacy?{...BUILD,revision:'legacy'}:BUILD,state:'activated',activations:0,postMessage(data,ports){if(data.type==='BUILD_INFO')ports[0].postMessage(this.identity);else if(data.type==='ACTIVATE_UPDATE')this.activations++;}};
  const registration=Object.assign(new EventTarget(),{active:worker,waiting:waiting?worker:null,installing:null});
  const sw=Object.assign(new EventTarget(),{controller:worker,register:async(url,options)=>{assert.equal(url,'./sw.js');assert.equal(options.type,'module');return registration;},ready:Promise.resolve(registration)});
  let reloads=0;const pwa=new PWAUpdates({serviceWorker:sw,reload:()=>reloads++,active:()=>active});
  return {pwa,sw,worker,registration,reloads:()=>reloads};
}
test('runtime and diagnostics share immutable version/revision/cache',async()=>{
  const f=fixture();await f.pwa.start();assert.equal(f.pwa.compatible,true);assert.equal(f.pwa.snapshot().cache,BUILD.cache);assert.equal(f.pwa.snapshot().revision,BUILD.revision);
});
test('waiting update never activates implicitly and cannot mix legacy modules',async()=>{
  const f=fixture({legacy:true,waiting:true});await f.pwa.start();assert.equal(f.pwa.compatible,false);assert.equal(f.pwa.updateAvailable,true);assert.equal(f.worker.activations,0);assert.equal(f.reloads(),0);
});
test('AR or recording blocks activation and controller changes never reload active sessions',async()=>{
  const f=fixture({active:true,waiting:true});await f.pwa.start();assert.equal(f.pwa.apply(),false);assert.equal(f.worker.activations,0);
  f.sw.dispatchEvent(new Event('controllerchange'));await new Promise(r=>setTimeout(r,20));assert.equal(f.reloads(),0);
});
test('safe explicit activation reloads only after controller change',async()=>{
  const f=fixture({waiting:true});await f.pwa.start();assert.equal(f.pwa.apply(),true);assert.equal(f.worker.activations,1);assert.equal(f.reloads(),0);
  f.sw.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads(),1);
});
test('external activation updates status without a reload',async()=>{
  const f=fixture();await f.pwa.start();f.sw.dispatchEvent(new Event('controllerchange'));await new Promise(r=>setTimeout(r,20));assert.equal(f.reloads(),0);
});
test('a revision activated by another tab offers a safe explicit reload',async()=>{
  const f=fixture();await f.pwa.start();f.worker.identity={...BUILD,revision:'next'};f.sw.dispatchEvent(new Event('controllerchange'));await new Promise(r=>setTimeout(r,20));
  assert.equal(f.reloads(),0);assert.equal(f.pwa.updateAvailable,true);assert.equal(f.pwa.apply(),true);assert.equal(f.reloads(),1);
});
