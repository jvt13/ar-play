from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from threading import Thread
from urllib.request import urlopen as _urlopen
from urllib.error import HTTPError
import tempfile, os, shutil, json, time, re

def urlopen(*args,**kwargs):
 # Bounded transport retry for provider 5xx; all final 200/404 assertions stay strict.
 for attempt in range(5):
  try:return _urlopen(*args,**kwargs)
  except HTTPError as error:
   if error.code not in (502,503,504) or attempt==4:raise
   print('INFO HTTP retry',attempt+1,'status',error.code,flush=True)
   error.close();time.sleep(2**attempt)

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=['index.html','style.css','manifest.webmanifest','sw.js','src','icons']
server=None
staging=None
base_url=os.environ.get('BASE_URL')
if not base_url:
 staging=tempfile.TemporaryDirectory(prefix='arplay-pages-')
 site=Path(staging.name)/'ar-play'
 site.mkdir()
 for name in PUBLIC:
  source=ROOT/name
  if source.is_dir():shutil.copytree(source,site/name)
  else:shutil.copy2(source,site/name)
 class PagesHandler(SimpleHTTPRequestHandler):
  extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.webmanifest':'application/manifest+json'}
  def log_message(self,*args):pass
 server=ThreadingHTTPServer(('localhost',0),partial(PagesHandler,directory=staging.name))
 Thread(target=server.serve_forever,daemon=True).start()
 base_url=f'http://localhost:{server.server_port}/ar-play/'
base_url=base_url.rstrip('/')+'/'
try:
 resources={'':'text/html','index.html':'text/html','style.css':'text/css','manifest.webmanifest':'application/manifest+json','sw.js':'javascript','src/app.js':'javascript','src/depth.js':'javascript','src/spatial-map.js':'javascript','src/collision.js':'javascript','src/movement-probe.js':'javascript','src/body-profiles.js':'javascript','src/volume.js':'javascript','src/spatial-debug.js':'javascript','src/revalidation.js':'javascript','src/diagnostics.js':'javascript','src/math.js':'javascript','src/engine.js':'javascript','icons/icon-192.png':'image/png','icons/icon-512.png':'image/png'}
 for name,mime in resources.items():
  with urlopen(base_url+name,timeout=30) as response:
   assert response.status==200,(name,response.status)
   assert mime in response.headers.get('Content-Type',''),(name,response.headers)
   assert response.read(),name
 print('PASS HTTP 200 and MIME types for all 19 public routes',base_url)
 for name in ['server.mjs','package.json','tests/browser_test.py','tests/app.test.js','tests/depth.test.js','tests/spatial.test.js','tests/collision.test.js','tests/hybrid.test.js','tests/refinement.test.js','tests/directional.test.js','tests/spatial-debug.test.js','tests/memory.test.js','tests/oriented.test.js','tests/recovery.test.js','tests/collision-sequences.mjs','tests/recovery_compare.mjs','tests/recovery_benchmark.mjs','tests/revalidation-recovery.test.js','tests/revalidation-sequences.mjs','tests/fixtures/recovery-v115.json','tests/generate_body_profiles.mjs','tests/volume_benchmark.mjs','tests/contact.test.js','tests/memory_benchmark.mjs','tests/spatial_benchmark.mjs','tests/xr_fixture.js','reports/report.md','reports/','README.md','CHANGELOG.md','TESTES.txt','iniciar.bat','.github/workflows/deploy-pages.yml','.git/config','.env']:
  try:
   with urlopen(base_url+name,timeout=30) as response:raise AssertionError(f'Private file exposed: {name} ({response.status})')
  except HTTPError as error:assert error.code==404,(name,error.code)
 print('PASS development and report files excluded from site')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or None,headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
  context=browser.new_context(viewport={'width':393,'height':852},device_scale_factor=1,permissions=['camera'],accept_downloads=True)
  page=context.new_page();errors=[];console_errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda message:console_errors.append(message.text) if message.type=='error' else None)
  page.goto(base_url+'?test=1');page.wait_for_function('window.__arplay?.state().frameCount > 3');state=lambda:page.evaluate('window.__arplay.state()')
  assert page.evaluate('window.__arplay.glError()')==0; print('PASS WebGL rendering')
  if os.environ.get('PREVIEW'):page.screenshot(path=os.environ['PREVIEW'])
  for char in ['nori','luma','bip']:
   page.locator(f'[data-character={char}]').click();assert state()['id']==char
   frame=state()['frameCount'];page.wait_for_function('(frame) => window.__arplay.state().frameCount > frame + 2',arg=frame)
   assert page.evaluate('window.__arplay.glError()')==0
   if os.environ.get('PREVIEW'):page.screenshot(path=str(Path(os.environ['PREVIEW']).with_name(char+'-'+Path(os.environ['PREVIEW']).name)))
  print('PASS all characters')
  page.locator('#dance').click();assert state()['dancing'];page.locator('#rotate').click();assert state()['yaw']!=0;page.locator('#size').fill('140');assert state()['scale']==1.4;page.locator('#jump').click();print('PASS actions and scale')
  j=page.locator('#joystick').bounding_box();page.mouse.move(j['x']+j['width']*.5,j['y']+j['height']*.5);page.mouse.down();page.mouse.move(j['x']+j['width']*.83,j['y']+j['height']*.5);page.wait_for_timeout(650);page.mouse.up();assert state()['pos'][0]>0;page.locator('#reset').click();assert state()['pos']==[0,0,0];print('PASS joystick and reset')
  page.locator('#cam').click();page.wait_for_function("window.__arplay.state().mode === 'camera'");assert state()['streamActive'];page.wait_for_function('document.querySelector("video").readyState >= 2');print('PASS simulated camera')
  with page.expect_download() as d:page.locator('#photo').click()
  photo=d.value.path();assert Path(photo).read_bytes().startswith(b'\x89PNG');assert Path(photo).stat().st_size>1000;print('PASS PNG',Path(photo).stat().st_size,'bytes')
  page.locator('#record').click();page.wait_for_timeout(1800);assert state()['recording']
  with page.expect_download(timeout=15000) as d:page.locator('#record').click()
  rec=Path(d.value.path());assert rec.stat().st_size>1000;print('PASS video',rec.stat().st_size,'bytes')
  page.locator('#flip').click();page.wait_for_function("window.__arplay.state().mode === 'camera' && document.querySelector('video').readyState >= 2");print('PASS camera flip (simulated)')
  page.locator('#demo').click();assert not state()['streamActive']
  assert not console_errors,console_errors
  page.locator('#ar').click();page.wait_for_timeout(300);assert state()['mode']=='demo'
  assert 'AR espacial' in page.locator('#status').inner_text()
  # Desktop Chrome may log this expected native diagnostic when rejecting immersive-ar.
  # Accept only this exact diagnostic, only during the explicit unsupported-XR check.
  assert all(message=='Could not create a session because: No runtimes supported the requested configuration' for message in console_errors),console_errors
  for message in console_errors:print('INFO expected desktop WebXR diagnostic:',message)
  console_errors.clear()
  print('PASS camera release and unsupported XR fallback')
  page.locator('#help').click();assert page.locator('dialog').is_visible();page.locator('#closeDialog').click();print('PASS help')
  page.evaluate('navigator.serviceWorker.ready');page.wait_for_function('navigator.serviceWorker.controller !== null')
  assert page.evaluate('(async () => (await navigator.serviceWorker.ready).scope)()')==base_url
  version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
  cache=re.search(r"const CACHE='([^']+)'",(ROOT/'sw.js').read_text(encoding='utf-8')).group(1)
  assert re.fullmatch(r'ar-play-v'+re.escape(version)+r'(-r[1-9][0-9]*)?',cache),cache
  assert page.evaluate('caches.keys()')==[cache]
  assert page.evaluate('(async () => (await (await caches.open("'+cache+'")).keys()).length)()')==18
  print('PASS service worker scope and versioned cache')
  context.set_offline(True);page.reload();page.wait_for_function('window.__arplay?.state().frameCount > 2');print('PASS offline reload')
  for char in ['nori','luma','bip']:
   page.locator(f'[data-character={char}]').click();assert state()['id']==char
  assert page.evaluate('window.__arplay.glError()')==0
  assert not errors,errors;assert not console_errors,console_errors;print('PASS no uncaught page errors or unexpected console errors')
  context.close()
  # Isolated synthetic sessions test AR integration/UI, never device support or real depth.
  simulated=browser.new_context(viewport={'width':393,'height':852})
  simulated.add_init_script(path=str(ROOT/'tests'/'xr_fixture.js'))
  for scenario in ['granted','denied','unsupported','reject-option']:
   xr=simulated.new_page();xr_errors=[];xr.on('pageerror',lambda error:xr_errors.append(str(error)))
   xr.goto(base_url+'?test=1');xr.wait_for_function('window.__arplay?.state().frameCount > 3')
   assert xr.locator('#arDiagnostics').is_hidden()
   xr.evaluate('(scenario) => { window.__xrTest.scenario = scenario; if (scenario === "unsupported") delete window.XRFrame.prototype.getDepthInformation; }',scenario)
   xr.locator('#ar').click();xr.wait_for_function("window.__arplay.state().mode === 'xr'")
   assert xr.locator('#depthToggle').is_visible();assert xr.locator('#depthPanel').is_hidden()
   assert xr.evaluate('window.__xrTest.reads')==0
   xr.locator('#depthToggle').click();assert xr.locator('#depthPanel').is_visible()
   if scenario=='granted':
    xr.wait_for_function("window.__arplay.depth().status === 'available'")
    assert xr.evaluate('window.__arplay.depth().center')==2
    assert '2.00 m' in xr.locator('#depthReadout').inner_text()
    xr.locator('#depthMapToggle').check();xr.wait_for_function('window.__arplay.depth().total === 768')
    assert xr.locator('#depthMap').is_visible()
    for height in [650,852]:
     xr.set_viewport_size({'width':393,'height':height})
     bounds=xr.locator('#arDiagnostics').bounding_box();joystick=xr.locator('#joystick').bounding_box()
     assert bounds['y']+bounds['height']<=joystick['y'],(height,bounds,joystick)
    if os.environ.get('PREVIEW'):xr.screenshot(path=str(Path(os.environ['PREVIEW']).with_name('simulated-depth-'+Path(os.environ['PREVIEW']).name)))
    xr.evaluate("window.__xrTest.scenario='missing'");xr.wait_for_function("window.__arplay.depth().status === 'waiting'")
    assert xr.evaluate('window.__arplay.depth().center') is None
    assert xr.locator('#depthMap').is_hidden()
    xr.evaluate("window.__xrTest.scenario='error'");xr.wait_for_function("window.__arplay.depth().status === 'error'")
    xr.evaluate("window.__xrTest.scenario='granted'");xr.wait_for_function("window.__arplay.depth().status === 'available'")
   else:
    expected='unsupported' if scenario=='unsupported' else 'not-granted'
    xr.wait_for_function('(expected) => window.__arplay.depth().status === expected',arg=expected)
    assert xr.evaluate('window.__xrTest.reads')==0
    if scenario=='reject-option':assert xr.evaluate('window.__xrTest.requests')==[True,False]
    # Even without depth, opted-in collisions cannot prevent conventional AR movement.
    xr.evaluate('window.__xrTest.spatial=true');xr.wait_for_function('window.__xrTest.hitReady')
    xr.evaluate('window.__xrTest.place()');xr.locator('#collisionToggle').check()
    xr.locator('#joystick').focus();xr.keyboard.down('ArrowUp');xr.wait_for_timeout(500);xr.keyboard.up('ArrowUp')
    assert xr.evaluate('window.__arplay.state().pos[2]') < -1.02
    assert xr.evaluate('window.__arplay.spatial().phase')=='unavailable'
    xr.locator('#collisionToggle').uncheck()
   xr.locator('#depthToggle').click();reads=xr.evaluate('window.__xrTest.reads');frames=xr.evaluate('window.__arplay.state().frameCount')
   xr.wait_for_timeout(400);assert xr.evaluate('window.__xrTest.reads')==reads
   assert xr.evaluate('window.__arplay.state().frameCount')>frames
   xr.locator('#demo').click();xr.wait_for_function("window.__arplay.state().mode === 'demo'")
   assert xr.evaluate('window.__arplay.depth().enabled') is False
   assert xr.evaluate('window.__arplay.depth().center') is None
   assert xr.locator('#arDiagnostics').is_hidden()
   assert not xr_errors,xr_errors;xr.close()
   print('PASS SIMULATED XR depth UI, rendering continuity, cleanup and fallback:',scenario)
  ar=simulated.new_page();collision_errors=[];ar.on('pageerror',lambda error:collision_errors.append(str(error)))
  ar.goto(base_url+'?test=1');ar.wait_for_function('window.__arplay?.state().frameCount > 3')
  ar.evaluate('window.__xrTest.spatial=true');ar.locator('#ar').click()
  ar.wait_for_function('window.__xrTest.hitReady');ar.evaluate('window.__xrTest.place()')
  assert not ar.locator('#collisionToggle').is_checked();assert ar.locator('#depthPanel').is_hidden()
  ar.locator('#collisionToggle').check()
  ar.wait_for_function('window.__arplay.spatial().occupied > 0',timeout=15000)
  assert ar.locator('#depthPanel').is_hidden();assert ar.evaluate('window.__xrTest.reads')>0
  assert ar.evaluate('window.__arplay.spatial().volumeMode')=='legacy-circular'
  start=ar.evaluate('window.__arplay.state().pos')
  ar.locator('#joystick').focus();ar.keyboard.down('ArrowUp');ar.wait_for_timeout(2500)
  ar.wait_for_function('window.__arplay.spatial().blocked',timeout=15000)
  stopped=ar.evaluate('window.__arplay.state().pos');assert -1.8 < stopped[2] < start[2]-.05,(start,stopped)
  ar.locator('#jump').click();ar.wait_for_timeout(400)
  jumped=ar.evaluate('window.__arplay.state().pos');assert abs(jumped[2]-stopped[2])<.04;assert jumped[1]==0
  ar.keyboard.up('ArrowUp');ar.locator('#joystick').focus();ar.keyboard.down('ArrowDown');ar.wait_for_timeout(700);ar.keyboard.up('ArrowDown')
  retreated=ar.evaluate('window.__arplay.state().pos');assert retreated[2]>stopped[2]+.05
  ar.wait_for_timeout(100);old_yaw=ar.evaluate('window.__arplay.state().yaw')
  ar.locator('#rotate').click();ar.wait_for_timeout(100)
  assert abs(ar.evaluate('window.__arplay.state().yaw')-old_yaw-3.141592653589793/4)<1e-5
  assert ar.evaluate('window.__arplay.spatial().posePending') is False
  ar.locator('#joystick').focus()
  ar.keyboard.down('ArrowUp');ar.keyboard.down('ArrowRight');ar.wait_for_timeout(1800);ar.keyboard.up('ArrowUp');ar.keyboard.up('ArrowRight')
  slid=ar.evaluate('window.__arplay.state().pos');assert slid[0]>retreated[0]+.1;assert slid[2]>-1.8
  ar.locator('#depthToggle').click();ar.wait_for_function('document.querySelector("#collisionReadout").textContent.includes("Células")')
  ar.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedDiagnostic=text}}})")
  ar.locator('#copyDiagnostic').click();ar.wait_for_function('window.__copiedDiagnostic?.includes("events")')
  for first,second in [('#status','#arDiagnostics'),('#hint','#arDiagnostics')]:
   a=ar.locator(first).bounding_box();b=ar.locator(second).bounding_box()
   assert a['y']+a['height']<=b['y'],(first,a,b)
  assert not ar.locator('#spatialDebugToggle').is_checked()
  ar.wait_for_function('window.__arplay.spatial().renderedBase !== null')
  support=ar.evaluate('window.__arplay.spatial()');assert abs(support['renderedBase']-support['supportY'])<.03,support
  assert abs(support['shadowY']-support['supportY']-.003)<1e-5,support
  ar.locator('#spatialDebugToggle').check();ar.wait_for_function('window.__arplay.spatialDebug().vertices > 0')
  stats=ar.evaluate('window.__arplay.spatialDebug()');assert stats['vertices']<=6000 and stats['cells']<=64
  assert stats['candidates']>0 and stats['cpuBytes']==144000,stats
  assert ar.evaluate('window.__arplay.glError()')==0
  pixel_check="""() => {const canvas=document.querySelector('#gl'),g=canvas.getContext('webgl'),data=new Uint8Array(canvas.width*canvas.height*4);g.readPixels(0,0,canvas.width,canvas.height,g.RGBA,g.UNSIGNED_BYTE,data);let red=0,blue=0,occupied=0,sumX=0;for(let i=0;i<data.length;i+=4){if(data[i]>220&&data[i+1]<60&&data[i+2]<60)red++;if((data[i]>220&&data[i+1]<60&&data[i+2]<60)||(data[i]>160&&data[i+1]<100&&data[i+2]>240)||(data[i]>240&&data[i+1]<110&&data[i+2]>150))occupied++;if(data[i]<80&&data[i+1]>80&&data[i+1]<170&&data[i+2]>240){blue++;sumX+=(i/4)%canvas.width;}}return {red,occupied,blue,blueX:blue?sumX/blue:null};}"""
  before_pixels=ar.evaluate(pixel_check);assert before_pixels['occupied']>0 and before_pixels['blue']>0,before_pixels
  ar.evaluate('window.__xrTest.cameraX=.12');ar.wait_for_timeout(350)
  after_pixels=ar.evaluate(pixel_check);assert after_pixels['blue']>0 and after_pixels['blueX']<before_pixels['blueX']-3,(before_pixels,after_pixels)
  ar.evaluate('window.__xrTest.cameraX=0');ar.wait_for_timeout(200)
  metrics=ar.evaluate("""async () => { const out={build:[],submit:[],diagnostic:[]};let last=null;for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);const d=window.__arplay.spatialDebug(),s=window.__arplay.spatial();out.build.push(d.buildMs);out.submit.push(d.drawMs);if(s.diagnosticTime!==last){last=s.diagnosticTime;out.diagnostic.push(s.diagnosticMs)}}return out; }""")
  def summary(values):
   values=sorted(v for v in values if v is not None)
   assert values
   return {'n':len(values),'medianMs':values[len(values)//2],'p95Ms':values[min(len(values)-1,int(len(values)*.95))],'maxMs':max(values)}
  print('BENCHMARK XR SIMULATED '+json.dumps({key:summary(value) for key,value in metrics.items()}),flush=True)
  ar.locator('#depthToggle').click();ar.wait_for_timeout(250)
  assert ar.evaluate('window.__arplay.spatialDebug().enabled') is True
  if os.environ.get('PREVIEW'):
   ar.evaluate("document.querySelector('#gl').style.cssText='position:fixed;inset:0;width:100vw;height:100vh;opacity:1';document.querySelector('#view').style.opacity='0'")
   ar.wait_for_timeout(100);ar.screenshot(path=str(Path(os.environ['PREVIEW']).with_name('simulated-3d-'+Path(os.environ['PREVIEW']).name)))
   ar.evaluate("document.querySelector('#gl').style.cssText='';document.querySelector('#view').style.opacity='1'")
  ar.locator('#depthToggle').click();ar.locator('#spatialDebugToggle').uncheck()
  ar.wait_for_function('window.__arplay.spatialDebug().vertices === 0')
  ar.locator('#collisionVisualToggle').check();ar.wait_for_function('!document.querySelector("#collisionMap").hidden')
  ar.locator('#collisionMap').scroll_into_view_if_needed()
  assert ar.evaluate("() => { const pixels=document.querySelector('#collisionMap').getContext('2d').getImageData(0,0,128,128).data; for(let i=1;i<pixels.length;i+=4) if(pixels[i]>180 && pixels[i]>pixels[i-1] && pixels[i]>pixels[i+1]) return true; return false; }")
  if os.environ.get('PREVIEW'):ar.screenshot(path=str(Path(os.environ['PREVIEW']).with_name('simulated-collision-'+Path(os.environ['PREVIEW']).name)))
  for char in ['nori','luma','bip']:
   ar.locator(f'[data-character={char}]').click();ar.wait_for_timeout(100)
   assert ar.evaluate('window.__arplay.state().id')==char
  ar.locator('#size').fill('140');ar.wait_for_function('window.__arplay.spatial().radius > .4')
  ar.evaluate('window.__xrTest.resetReference()');ar.wait_for_function('window.__arplay.spatial().cells === 0')
  ar.wait_for_timeout(300);assert ar.evaluate('window.__arplay.spatial().occupied')==0
  ar.evaluate('window.__xrTest.place()');ar.wait_for_function('window.__arplay.spatial().occupied > 0',timeout=15000)
  ar.locator('#collisionToggle').uncheck();ar.locator('#depthToggle').click()
  reads=ar.evaluate('window.__xrTest.reads');ar.wait_for_timeout(400)
  assert ar.evaluate('window.__xrTest.reads')==reads;assert ar.evaluate('window.__arplay.spatial().cells')==0
  ar.locator('#demo').click();ar.wait_for_function("window.__arplay.state().mode === 'demo'")
  assert ar.evaluate('window.__arplay.spatial().enabled') is False
  assert not collision_errors,collision_errors;ar.close()
  print('PASS SIMULATED real-depth collision pipeline: wall, retreat, slide, jump, model/scale, reference reset and closed diagnosis')
  hybrid=simulated.new_page();hybrid_errors=[];hybrid.on('pageerror',lambda error:hybrid_errors.append(str(error)))
  hybrid.goto(base_url+'?test=1');hybrid.wait_for_function('window.__arplay?.state().frameCount > 3')
  hybrid.evaluate('Object.assign(window.__xrTest,{spatial:true,highResolution:true,placementZ:-1.4,maxDepthReads:2})')
  hybrid.locator('#ar').click();hybrid.wait_for_function('window.__xrTest.hitReady');hybrid.evaluate('window.__xrTest.place()')
  hybrid.locator('#joystick').focus();hybrid.keyboard.down('ArrowUp');hybrid.locator('#collisionToggle').check()
  hybrid.wait_for_function('window.__arplay.spatial().probeSamples >= 3',timeout=10000)
  assert hybrid.evaluate('window.__arplay.spatial().occupied')==0
  assert hybrid.locator('#depthPanel').is_hidden()
  hybrid.wait_for_function('window.__arplay.spatial().blockSource === "sonda imediata"',timeout=10000)
  probe_stop=hybrid.evaluate('window.__arplay.state().pos[2]');assert -2+.42*.771+.04-.01 < probe_stop < -1.4,probe_stop # legacy circular Bip envelope, unchanged margins
  assert hybrid.evaluate('window.__arplay.spatial().coverageInsufficient') is True
  hybrid.keyboard.up('ArrowUp');hybrid.locator('#joystick').focus();hybrid.keyboard.down('ArrowDown')
  hybrid.wait_for_timeout(200);hybrid.keyboard.up('ArrowDown')
  assert hybrid.evaluate('window.__arplay.state().pos[2]') > probe_stop+.025
  hybrid.locator('#depthToggle').click()
  hybrid.wait_for_function('document.querySelector("#collisionReadout").textContent.includes("Custo da sonda")')
  hybrid.locator('#collisionToggle').uncheck();assert hybrid.evaluate('window.__arplay.spatial().probeSamples')==0
  hybrid.locator('#demo').click();assert not hybrid_errors,hybrid_errors;hybrid.close()
  print('PASS SIMULATED hybrid immediate probe: partial map, limited coverage, actual stop/retreat, closed diagnosis and cleanup')
  regression=simulated.new_page();regression_errors=[];regression.on('pageerror',lambda error:regression_errors.append(str(error)))
  regression.goto(base_url+'?test=1');regression.wait_for_function('window.__arplay?.state().frameCount > 3')
  regression.evaluate('Object.assign(window.__xrTest,{spatial:true,highResolution:true})');regression.locator('#ar').click()
  regression.wait_for_function('window.__xrTest.hitReady');regression.evaluate('window.__xrTest.place()')
  regression.locator('#size').fill('81');regression.locator('#collisionToggle').check()
  regression.wait_for_function('window.__arplay.spatial().scale === .81 && window.__arplay.spatial().occupied > 0')
  import math
  for heading in [0,math.pi/2,math.pi,-math.pi/2]:
   regression.evaluate('(yaw)=>window.__xrTest.cameraYaw=yaw',heading);regression.wait_for_timeout(150)
   start=regression.evaluate('window.__arplay.state().pos');regression.locator('#joystick').focus()
   regression.keyboard.down('ArrowUp');regression.wait_for_timeout(350);regression.keyboard.up('ArrowUp')
   finish=regression.evaluate('window.__arplay.state().pos')
   advance=(finish[0]-start[0])*(-math.sin(heading))+(finish[2]-start[2])*(-math.cos(heading))
   assert advance>.04,(heading,start,finish)
   s=regression.evaluate('window.__arplay.spatial()');assert s['posePending'] is False
   assert abs(s['requestedYaw']-s['volumeYaw'])<1e-6
   regression.wait_for_timeout(150);rest=regression.evaluate('window.__arplay.state().pos')
   regression.wait_for_timeout(200);assert regression.evaluate('window.__arplay.state().pos')==rest
  regression.locator('#demo').click();assert not regression_errors,regression_errors;regression.close()
  print('PASS ARP-004H SIMULATED Bip 81%: sustained movement, rapid direction changes, camera headings, adopted yaw and rest')
  memory=simulated.new_page();memory_errors=[];memory.on('pageerror',lambda error:memory_errors.append(str(error)))
  memory.goto(base_url+'?test=1');memory.wait_for_function('window.__arplay?.state().frameCount > 3')
  memory.evaluate('Object.assign(window.__xrTest,{spatial:true,highResolution:true})');memory.locator('#ar').click()
  memory.wait_for_function('window.__xrTest.hitReady');memory.evaluate('window.__xrTest.place()')
  memory.locator('#collisionToggle').check();memory.locator('#depthToggle').click()
  memory.locator('#mappingToggle').click();assert memory.evaluate('window.__arplay.spatial().guided') is True
  origin=memory.evaluate('window.__arplay.state().pos')
  memory.locator('#joystick').focus();memory.keyboard.down('ArrowUp');memory.wait_for_timeout(400);memory.keyboard.up('ArrowUp')
  assert memory.evaluate('window.__arplay.state().pos')==origin
  memory.wait_for_function('window.__arplay.spatial().memory.consolidated > 0',timeout=25000)
  assert memory.locator('#mappingReadout').is_visible()
  memory.locator('#mappingToggle').click();assert memory.evaluate('window.__arplay.spatial().guided') is False
  assert memory.evaluate('window.__arplay.spatial().memory.consolidated')>0
  memory.evaluate('window.__xrTest.cameraYaw=Math.PI');memory.wait_for_timeout(6200)
  assert memory.evaluate('window.__arplay.spatial().memory.oldestAgeMs')>5000
  assert memory.evaluate('window.__arplay.spatial().memory.consolidated')>0
  memory.evaluate('window.__xrTest.cameraYaw=0;window.__xrTest.maxDepthReads=window.__xrTest.reads')
  memory.locator('#joystick').focus();memory.keyboard.down('ArrowUp')
  memory.wait_for_function('window.__arplay.spatial().blocked',timeout=15000);memory.keyboard.up('ArrowUp')
  stopped=memory.evaluate('window.__arplay.state().pos');assert stopped[2]>-1.8
  memory.evaluate('Object.assign(window.__xrTest,{maxDepthReads:0,depthMeters:4})')
  memory.wait_for_function('window.__arplay.spatial().memory.released > 0',timeout=25000)
  memory.locator('#joystick').focus();memory.keyboard.down('ArrowUp')
  memory.wait_for_function('window.__arplay.state().pos[2] < -2.1',timeout=15000);memory.keyboard.up('ArrowUp')
  memory.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__memoryDiagnostic=JSON.parse(text)}}})")
  memory.locator('#copyDiagnostic').click();memory.wait_for_function('window.__memoryDiagnostic?.lastBlock !== null')
  assert memory.evaluate('window.__memoryDiagnostic.state.memory.released')>0
  memory.locator('#collisionToggle').uncheck();assert memory.evaluate('window.__arplay.spatial().memory.confirmed')==0
  memory.locator('#demo').click();assert not memory_errors,memory_errors;memory.close()
  print('PASS SIMULATED adaptive memory: guided mapping, camera turn, retention >5s, collision, removal and released movement')
  recovery=simulated.new_page();recovery_errors=[];recovery.on('pageerror',lambda error:recovery_errors.append(str(error)))
  recovery.goto(base_url+'?test=1');recovery.wait_for_function('window.__arplay?.state().frameCount > 3')
  recovery.evaluate('Object.assign(window.__xrTest,{spatial:true,highResolution:true})');recovery.locator('#ar').click()
  recovery.wait_for_function('window.__xrTest.hitReady');recovery.evaluate('window.__xrTest.place()');recovery.locator('#collisionToggle').check()
  recovery.wait_for_function('window.__arplay.spatial().memory.consolidated > 0',timeout=25000)
  cells=recovery.evaluate('window.__arplay.spatial().cells');origin=recovery.evaluate('window.__arplay.state().pos')
  recovery.evaluate("window.__xrTest.visibility('hidden');window.__xrTest.poseMissing=true")
  reads=recovery.evaluate('window.__xrTest.reads');recovery.wait_for_timeout(500)
  assert recovery.evaluate('window.__arplay.spatial().cells')==cells
  assert recovery.evaluate('window.__xrTest.reads')==reads
  assert recovery.evaluate('window.__arplay.state().pos')==origin
  recovery.evaluate("window.__xrTest.poseMissing=false;window.__xrTest.visibility('visible')")
  recovery.wait_for_function('!window.__arplay.spatial().suspended');assert recovery.evaluate('window.__arplay.spatial().occupied')>0
  recovery.evaluate('window.__xrTest.maxDepthReads=window.__xrTest.reads');recovery.wait_for_timeout(1100)
  recovery.locator('#joystick').focus();recovery.keyboard.down('ArrowUp')
  recovery.wait_for_function('window.__arplay.spatial().blocked',timeout=15000);recovery.keyboard.up('ArrowUp')
  recovery.locator('#demo').click();recovery.wait_for_function("window.__arplay.state().mode === 'demo'")
  assert recovery.evaluate('window.__arplay.spatial().cells')==0
  saved=recovery.evaluate('window.__arplay.archive()');assert any(e['kind']=='suspended' for e in saved['state']['lifecycle']);assert any(e['kind']=='resumed' for e in saved['state']['lifecycle']);assert saved['lastBlock'] and saved['version']=='1.1.7'
  assert 0<len(saved['state']['blockedCells'])<=8;assert all('freeEvidence' in c and 'reason' in c and 'key' not in c for c in saved['state']['blockedCells']);assert saved['reason']=='mode-change';assert 'previousX' not in saved['lastBlock'];assert saved['session']=='AR-1'
  recovery.locator('#lastDiagnostic').click();assert recovery.locator('#archiveText').inner_text()
  recovery.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('simulated permission denial')}}})")
  recovery.locator('#copyArchive').click();recovery.wait_for_function('document.querySelector("#archiveFeedback").textContent.includes("Falha")')
  with recovery.expect_download() as exported:recovery.locator('#exportArchive').click()
  exported_bytes=Path(exported.value.path()).read_bytes();assert 0<len(exported_bytes)<=32000
  record=json.loads(exported_bytes);assert record['session']=='AR-1' and record['lastBlock']
  assert 'previousX' not in record['lastBlock'] and 'points' not in record
  recovery.locator('#clearArchive').click();assert recovery.evaluate('window.__arplay.archive()') is None
  assert recovery.locator('#lastDiagnostic').is_hidden();recovery.locator('#closeDialog').click()
  recovery.locator('#ar').click();recovery.wait_for_function("window.__arplay.state().mode === 'xr'")
  assert recovery.evaluate('window.__arplay.spatial().session')=='AR-2';assert recovery.evaluate('window.__arplay.spatial().cells')==0
  recovery.locator('#demo').click();assert not recovery_errors,recovery_errors;recovery.close()
  print('PASS SIMULATED lifecycle and diagnostic recovery: same-reference suspension, end cleanup, anonymous archive, failed clipboard, local export and session isolation')
  simulated.close();browser.close()
finally:
 if server:server.shutdown();server.server_close()
 if staging:staging.cleanup()
