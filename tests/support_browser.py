import json

def run_supports(context,base):
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'?test=1');page.wait_for_function('window.__arplay?.state().frameCount > 2')
 page.evaluate('Object.assign(window.__xrTest,{spatial:true,highResolution:true,manualFrames:true,supportScene:"box",cameraY:1.2,cameraPitch:-.5,placementZ:-.8})')
 page.locator('#ar').click();page.wait_for_function('window.__arplay.state().mode === "xr"');page.evaluate('window.__xrTest.step(2,80)');page.evaluate('window.__xrTest.place()')
 assert not page.locator('#supportDebugToggle').is_checked()
 page.locator('#collisionToggle').check();page.evaluate('window.__xrTest.step(240,80)')
 stats=page.evaluate('window.__arplay.supports()');assert stats['confirmedRegions']>0,stats
 assert any(r['relativeHeight']>.45 for r in stats['summaries']),stats
 assert page.evaluate('window.__arplay.state().pos[1]')==0
 page.locator('#depthToggle').click();page.locator('#supportDebugToggle').check();page.evaluate('window.__xrTest.step(8,80)')
 assert page.evaluate('window.__arplay.supports().vertices')>0
 assert not page.evaluate('window.__arplay.spatialDebug().enabled')
 assert page.evaluate('window.__arplay.glError()')==0
 timings=page.evaluate('''() => {const rows={update:[],build:[],draw:[]};let update=-1,build=-1;for(let i=0;i<80;i++){window.__xrTest.step(1,80);const s=window.__arplay.supports();if(s.updates!==update&&s.updateMs!==null){rows.update.push(s.updateMs);update=s.updates;}if(s.visualBuildUpdates!==build&&s.visualBuildMs!==null){rows.build.push(s.visualBuildMs);build=s.visualBuildUpdates;}if(s.visualDrawMs!==null)rows.draw.push(s.visualDrawMs);}return Object.fromEntries(Object.entries(rows).map(([key,a])=>{a.sort((x,y)=>x-y);return [key,{n:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)}]}));}''')
 print('BENCHMARK SUPPORT WEBGL CPU '+json.dumps(timings),flush=True)
 page.evaluate('Object.assign(window.__xrTest,{cameraYaw:.2,cameraX:.08})');page.evaluate('window.__xrTest.step(16,80)')
 assert page.evaluate('window.__arplay.glError()')==0
 page.locator('#spatialDebugToggle').check();page.evaluate('window.__xrTest.step(8,80)');assert page.evaluate('window.__arplay.spatialDebug().enabled')
 assert page.evaluate('window.__arplay.glError()')==0
 page.locator('#spatialDebugToggle').uncheck();page.evaluate('window.__xrTest.step(4,80)');assert page.evaluate('window.__arplay.supports().vertices')>0
 assert page.evaluate('window.__arplay.glError()')==0
 # Exactly the same requested horizontal displacement with perception on/off/visual.
 page.evaluate('Object.assign(window.__xrTest,{cameraYaw:0,cameraX:0})');results=[]
 for mode in ['visual','active','unavailable']:
  if mode=='active':page.locator('#supportDebugToggle').uncheck()
  page.evaluate('(v)=>window.__arplay.supportTest.unavailable(v)',mode=='unavailable')
  start=page.evaluate('window.__arplay.state().pos');page.locator('#joystick').focus();page.keyboard.down('ArrowLeft');page.evaluate('window.__xrTest.step(16,16)');page.keyboard.up('ArrowLeft');finish=page.evaluate('window.__arplay.state().pos')
  assert abs(finish[0]-start[0]+.1408)<1e-5,(mode,start,finish);assert finish[1]==start[1]==0
  results.append({'mode':mode,'requested':-.1408,'permitted':finish[0]-start[0],'height':finish[1]})
 page.evaluate('window.__arplay.supportTest.unavailable(false)');page.evaluate('window.__xrTest.step(80,80)')
 assert page.evaluate('window.__arplay.supports().confirmedRegions')>0
 page.locator('#demo').click();page.wait_for_function('window.__arplay.state().mode === "demo"')
 assert page.evaluate('window.__arplay.supports().regions')==0
 saved=page.evaluate('window.__arplay.archive()');assert saved['supports']['regions']>0,saved
 assert len(saved['supports']['summaries'])<=8;assert all('relativeHeight' in s and 'x' not in s for s in saved['supports']['summaries'])
 page.locator('#ar').click();page.wait_for_function('window.__arplay.state().mode === "xr"');assert page.evaluate('window.__arplay.supports().regions')==0
 page.evaluate('window.__xrTest.step(2,80)');page.evaluate('window.__xrTest.place()');page.locator('#collisionToggle').check();page.evaluate('window.__xrTest.step(40,80)')
 page.evaluate('window.__xrTest.resetReference()');page.evaluate('window.__xrTest.step(2,80)');assert page.evaluate('window.__arplay.supports().regions')==0
 page.locator('#demo').click();assert not errors,errors;page.close()
 print('PASS ARP-005A real app passive supports, elevated top, independent GPU toggles, camera poses, preserved height/motion, archive, reference/session cleanup '+json.dumps(results),flush=True)
