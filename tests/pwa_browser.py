from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import json
import subprocess

def repeated_retreat(context,base):
 results=[]
 for scale in [40,81,100]:
  for repeat in range(4):
   page=context.new_page();page.goto(base+'?test=1');page.wait_for_function('window.__arplay?.state().frameCount > 2')
   page.evaluate('Object.assign(window.__xrTest,{spatial:true,highResolution:true,placementZ:-1.4,maxDepthReads:2,manualFrames:true})')
   page.locator('#ar').click();page.wait_for_function('window.__arplay.state().mode === "xr"');page.evaluate('window.__xrTest.step(2)');page.evaluate('window.__xrTest.place()')
   page.locator('#size').fill(str(scale));page.locator('#collisionToggle').check();page.locator('#joystick').focus();page.keyboard.down('ArrowUp');page.evaluate('window.__xrTest.step(50)');page.keyboard.up('ArrowUp')
   stop=page.evaluate('window.__arplay.state().pos[2]');assert stop>-2+.42*.771*scale/100+.0399,(scale,stop)
   assert page.evaluate('window.__arplay.spatial().blockSource')=='sonda imediata'
   page.keyboard.down('ArrowDown');page.evaluate('window.__xrTest.step(16)');page.keyboard.up('ArrowDown')
   finish=page.evaluate('window.__arplay.state().pos[2]');advance=finish-stop
   assert abs(advance-.55*.016*16)<1e-5,(scale,repeat,stop,finish)
   results.append({'scale':scale,'repeat':repeat,'updates':16,'requested':.1408,'permitted':advance})
   page.locator('#demo').click();page.close()
 print('PASS REPEATED_RETREAT_REAL_CONTROLLER '+json.dumps(results),flush=True)

def run_updates(browser,root):
 build=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {BUILD} from './src/build.js';console.log(JSON.stringify(BUILD))"],cwd=root))
 revision=build['revision'];next_revision=revision.removesuffix('-r1')+'-r2'
 legacy=json.loads((root/'tests/fixtures/legacy-workers.json').read_text(encoding='utf-8'))
 state={'phase':'legacy','worker':legacy[0]['worker'],'version':'1.1.5'}
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   name=self.path.split('?',1)[0].removeprefix('/ar-play/');name=name or 'index.html'
   if state['phase']=='legacy' and name=='sw.js':data=state['worker'].encode();mime='text/javascript'
   elif state['phase']=='legacy' and name=='src/build.js' and state.get('buildSource'):
    data=state['buildSource'].encode();mime='text/javascript'
   elif state['phase']=='legacy' and name=='src/body-profiles.js':data=b'// legacy asset';mime='text/javascript'
   elif state['phase']=='legacy' and name=='index.html':
    data=b'<html><body>Legacy AR<script type="module" src="src/app.js"></script></body></html>';mime='text/html'
   elif state['phase']=='legacy' and name=='src/app.js':
    registration='navigator.serviceWorker.register("./sw.js",{type:"module"})' if state.get('buildSource') else 'navigator.serviceWorker.register("./sw.js")'
    data=('window.__legacyAR=true;window.__legacyFrames=0;setInterval(()=>window.__legacyFrames++,16);'+registration).encode();mime='text/javascript'
   elif name in ['index.html','style.css','manifest.webmanifest','sw.js'] or name.startswith(('src/','icons/')):
    target=(root/name).resolve()
    if not target.is_relative_to(root) or not target.is_file():self.send_error(404);return
    data=target.read_bytes();mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'}[target.suffix]
    if state['phase']=='next' and name=='src/build.js':data=data.replace(b'revisionNumber=1',b'revisionNumber=2')
    if state['phase']=='next' and name=='sw.js':data=b'// simulated next revision\n'+data
   else:self.send_error(404);return
   self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}/ar-play/'
 try:
  for item in legacy:
   state.update(phase='legacy',worker=item['worker'],version=item['version'],buildSource=item.get('buildSource'))
   context=browser.new_context(viewport={'width':393,'height':852});context.add_init_script(path=str(root/'tests/xr_fixture.js'))
   old=context.new_page();old.goto(base);old.wait_for_function('window.__legacyAR && navigator.serviceWorker.controller !== null')
   assert any(item['version'] in name for name in old.evaluate('caches.keys()'))
   state['phase']='current';page=context.new_page();page.goto(base+'?test=1')
   page.wait_for_function('!document.querySelector("#updateApp").hidden',timeout=30000)
   assert page.evaluate('window.__arplay === undefined'),'fresh modules cannot mix with legacy cache'
   frames=old.evaluate('window.__legacyFrames');page.locator('#updateApp').click()
   page.wait_for_function('(r)=>window.__arplay?.build().revision === r',arg=revision,timeout=30000)
   assert page.locator('#appVersion').inner_text()=='v'+build['version']
   assert page.evaluate('caches.keys()')==[build['cache']]
   assert old.evaluate('window.__legacyAR && window.__legacyFrames > '+str(frames)),'old AR page must remain running without reload'
   # A second revision must remain waiting throughout a real simulated XR session.
   page.locator('#ar').click();page.wait_for_function('window.__arplay.state().mode === "xr"');session=page.evaluate('window.__arplay.spatial().session')
   assert page.locator('#appVersion').is_visible()
   state['phase']='next';page.evaluate('(async()=>{await (await navigator.serviceWorker.getRegistration()).update()})()')
   page.wait_for_function('window.__arplay.build().updateAvailable',timeout=30000);assert page.locator('#updateApp').is_disabled()
   assert page.evaluate('window.__arplay.state().mode')=='xr';assert page.evaluate('window.__arplay.spatial().session')==session
   assert page.evaluate('window.__arplay.build().revision')==revision
   page.locator('#demo').click();assert page.locator('#updateApp').is_enabled();page.locator('#updateApp').click()
   page.wait_for_function('(r)=>window.__arplay?.build().revision === r',arg=next_revision,timeout=30000)
   assert page.evaluate('caches.keys()')==[build['cache'].removesuffix('-r1')+'-r2']
   context.set_offline(True);page.reload();page.wait_for_function('window.__arplay?.state().frameCount > 2')
   assert page.evaluate('window.__arplay.build().revision')==next_revision
   context.close();print('PASS PWA MIGRATION '+item['version']+' -> '+build['version']+'; coherent modules, manual activation, old AR continuity, next revision blocked in XR and offline',flush=True)
 finally:server.shutdown();server.server_close()
