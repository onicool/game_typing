"""Production asset loading, cold/warm throttled cache, bounded fallback.

Usage: python checks/asset_load_check.py [candidate URL] [410d06b baseline URL]
All profiles are fresh/artificial; actual local HTTP plus Chrome network shaping.
No browser data clearing outside these newly created test contexts.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
URL=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5186'
BASE=sys.argv[2] if len(sys.argv)>2 else 'http://127.0.0.1:5189'
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/game-typing-qa/asset-cycle');OUT.mkdir(parents=True,exist_ok=True)
INIT="""localStorage.setItem('icebreaker.sound','false');window.qaImages=[];window.qaLoaded=[];window.qaDrawn=[];window.qaKeys=[];window.qaGLCalls=0;
const NativeImage=Image;function AssetImage(...args){const image=new NativeImage(...args);qaImages.push(image);
image.addEventListener('load',()=>qaLoaded.push({path:image.currentSrc.split('/').pop(),at:performance.now(),width:image.naturalWidth,height:image.naturalHeight}));return image;}
AssetImage.prototype=NativeImage.prototype;Object.setPrototypeOf(AssetImage,NativeImage);window.Image=AssetImage;
window.addEventListener('keydown',e=>{if(e.isTrusted&&/^[a-z]$/.test(e.key))qaKeys.push({key:e.key,at:performance.now()});});
const getContext=HTMLCanvasElement.prototype.getContext;const wrapped=new WeakSet();
HTMLCanvasElement.prototype.getContext=function(kind,...args){if(kind.includes('webgl')){qaGLCalls++;return null;}
const ctx=getContext.call(this,kind,...args);if(ctx&&!wrapped.has(ctx)){wrapped.add(ctx);const draw=ctx.drawImage;ctx.drawImage=function(image,...args){
if(qaImages.includes(image)&&!qaDrawn.some(row=>row.path===image.currentSrc.split('/').pop()))qaDrawn.push({path:image.currentSrc.split('/').pop(),at:performance.now()});return draw.call(this,image,...args);};}return ctx;};"""
READ="""async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const read=name=>new Promise((ok,no)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();let rows;r.onsuccess=()=>rows=r.result;tx.oncomplete=()=>ok(rows);tx.onabort=no;});
const events=await read('events'),sessions=await read('sessions');db.close();return {events,sessions};}"""
STATE="""()=>({at:performance.now(),dcl:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
loaded:qaLoaded,drawn:qaDrawn,keys:qaKeys,gl_calls:qaGLCalls,
images:qaImages.map(i=>({path:i.currentSrc.split('/').pop(),complete:i.complete,width:i.naturalWidth})),
resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/stages/')).map(e=>({path:e.name.split('/').pop(),start:e.startTime,response_end:e.responseEnd,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize}))})"""
rows={'network':[],'faults':[]}

def begin(page,url,reload=False):
 if reload:page.reload(wait_until='domcontentloaded')
 else:page.goto(url,wait_until='domcontentloaded')
 page.wait_for_function('qaImages.length===2')
 page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>1499/2**31;}');page.keyboard.press('Space');page.evaluate('Math.random=qaRandom')
 assert page.locator('#romaji').inner_text()=='chirimotsumorebayamatonaru'
 before=page.evaluate(STATE);page.keyboard.type('chiri',delay=15)
 assert page.locator('#romaji .typed').inner_text()=='chiri'
 return before,page.evaluate(STATE)

def save(page):
 page.evaluate("""()=>{const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});Object.defineProperty(e,'timeStamp',{value:performance.now()+65000});document.activeElement.dispatchEvent(e);}""")
 page.wait_for_function("document.querySelector('#session-save-state').textContent.includes('このブラウザに保存しました')")
 r=page.evaluate(READ);events=r['events'][-1]['events']
 assert ''.join(e['key'] for e in events)=='chiri' and all(e['correct'] for e in events)
 assert len(r['events'])==len(r['sessions'])
 return [{k:v for k,v in e.items() if k not in ['session','t','dt']} for e in events]

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);rows['browser']=browser.version
 reference=None
 # Same Vite production server/header behavior, 128 KiB/s and 80 ms latency.
 for tag,url in [('png-before',BASE),('webp',URL)]:
  context=browser.new_context(viewport={'width':1366,'height':768});context.add_init_script(INIT)
  page=context.new_page();page.set_default_timeout(60000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  cdp=context.new_cdp_session(page);cdp.send('Network.enable');cdp.send('Network.setCacheDisabled',{'cacheDisabled':False})
  cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':80,'downloadThroughput':128*1024,'uploadThroughput':128*1024})
  for cache in ['cold','warm']:
   before,typed=begin(page,url,reload=cache=='warm')
   assert typed['gl_calls']==0
   page.wait_for_function('qaDrawn.length===2')
   final=page.evaluate(STATE);saved=save(page)
   if reference is None:reference=saved
   assert saved==reference,{'condition':tag,'cache':cache,'saved':saved,'reference':reference}
   assert not errors,errors
   name=f'{tag}-{cache}-1366.png';page.screenshot(path=str(OUT/name))
   rows['network'].append({'condition':tag,'cache':cache,'profile':{'latency_ms':80,'download_kib_s':128},
    'before_typing':before,'after_first_five_keys':typed,'all_assets_drawn':final,'exact_key_fields_match':True,'capture':name,'page_errors':errors})
  context.close()

 for fault in ['held','held-low-reduced','webp-404','webp-corrupt','all-fail']:
  reduced=fault=='held-low-reduced';context=browser.new_context(viewport={'width':800,'height':600},reduced_motion='reduce' if reduced else 'no-preference')
  context.add_init_script(INIT+("localStorage.setItem('icebreaker.graphics.low','true');" if reduced else ''))
  pending=[];requests=[]
  def asset(route):
   name=route.request.url.split('/')[-1];requests.append(name)
   if fault.startswith('held'):pending.append(route)
   elif fault=='all-fail':route.abort()
   elif name.endswith('.webp'):
    route.fulfill(status=404,body='missing') if fault=='webp-404' else route.fulfill(status=200,body=b'invalid webp',content_type='image/webp')
   else:route.continue_()
  context.route('**/stages/*',asset);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  before,typed=begin(page,URL);assert typed['gl_calls']==0
  if fault.startswith('held'):
   assert not typed['loaded'] and len(pending)==2 and all(i['width']==0 for i in typed['images'])
   page.screenshot(path=str(OUT/f'fault-{fault}-800.png'));saved=save(page)
   for route in pending:
    path=ROOT/'public/stages'/route.request.url.split('/')[-1];route.fulfill(body=path.read_bytes(),content_type='image/webp')
   page.wait_for_function('qaLoaded.length===2')
  elif fault=='all-fail':
   page.wait_for_function('qaImages.every(i=>i.complete)');assert not page.evaluate(STATE)['loaded'];saved=save(page)
   assert len(requests)==4
  else:
   page.wait_for_function('qaDrawn.length===2');saved=save(page)
   assert len(requests)==4 and all(i['path'].endswith('.png') for i in page.evaluate(STATE)['images'])
  assert saved==reference,{'fault':fault,'saved':saved,'reference':reference}
  assert not errors,errors
  rows['faults'].append({'condition':fault,'before_typing':before,'after_first_five_keys':typed,'final':page.evaluate(STATE),
   'requests':requests,'exact_key_fields_match':True,'saved':True,'page_errors':errors});context.close()
 browser.close()
rows['limits']='Fresh artificial Chromium profiles and local HTTP/CDP shaping. Timings are diagnostic, not real mobile bandwidth/device/paint or cold-start guarantees. WebGL is explicitly unavailable in every profile; renderer uses Canvas2D. Cache observations include validation and memory reuse. Stable event fields exclude per-run session/t/dt; full logs are persisted in each test profile.'
(OUT/'loading-results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print(json.dumps({'network':[{'condition':r['condition'],'cache':r['cache'],'first_key_ms':r['after_first_five_keys']['keys'][0]['at'],
 'all_art_drawn_ms':max(a['at'] for a in r['all_assets_drawn']['drawn']),'asset_transfer_bytes':sum(a['transfer'] for a in r['all_assets_drawn']['resources'])} for r in rows['network']],
 'faults':[{'condition':r['condition'],'requests':r['requests'],'passed':r['exact_key_fields_match']} for r in rows['faults']],'results':str(OUT/'loading-results.json')},indent=2))
