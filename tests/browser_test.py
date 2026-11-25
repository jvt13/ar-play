from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from threading import Thread
from urllib.request import urlopen
from urllib.error import HTTPError
import tempfile, os, shutil, json

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
 resources={'':'text/html','index.html':'text/html','style.css':'text/css','manifest.webmanifest':'application/manifest+json','sw.js':'javascript','src/app.js':'javascript','src/depth.js':'javascript','src/math.js':'javascript','src/engine.js':'javascript','icons/icon-192.png':'image/png','icons/icon-512.png':'image/png'}
 for name,mime in resources.items():
  with urlopen(base_url+name,timeout=30) as response:
   assert response.status==200,(name,response.status)
   assert mime in response.headers.get('Content-Type',''),(name,response.headers)
   assert response.read(),name
 print('PASS HTTP 200 and MIME types for all 11 public routes',base_url)
 for name in ['server.mjs','package.json','tests/browser_test.py','tests/app.test.js','tests/depth.test.js','tests/xr_fixture.js','reports/report.md','reports/','README.md','CHANGELOG.md','TESTES.txt','iniciar.bat','.github/workflows/deploy-pages.yml','.git/config','.env']:
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
  assert page.evaluate('caches.keys()')==['ar-play-v'+version]
  assert page.evaluate('(async () => (await (await caches.open("ar-play-v'+version+'")).keys()).length)()')==10
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
   xr.locator('#depthToggle').click();reads=xr.evaluate('window.__xrTest.reads');frames=xr.evaluate('window.__arplay.state().frameCount')
   xr.wait_for_timeout(400);assert xr.evaluate('window.__xrTest.reads')==reads
   assert xr.evaluate('window.__arplay.state().frameCount')>frames
   xr.locator('#demo').click();xr.wait_for_function("window.__arplay.state().mode === 'demo'")
   assert xr.evaluate('window.__arplay.depth().enabled') is False
   assert xr.evaluate('window.__arplay.depth().center') is None
   assert xr.locator('#arDiagnostics').is_hidden()
   assert not xr_errors,xr_errors;xr.close()
   print('PASS SIMULATED XR depth UI, rendering continuity, cleanup and fallback:',scenario)
  simulated.close();browser.close()
finally:
 if server:server.shutdown();server.server_close()
 if staging:staging.cleanup()
