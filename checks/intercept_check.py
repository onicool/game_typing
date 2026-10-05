"""Native input equivalence and visual-only interception review.

Usage: python checks/intercept_check.py [production] [410d06b] [Vite dev]
Fresh artificial profiles; no production diagnostics are added to the app.
"""
import ast,json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
URL=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5186'
BASE=sys.argv[2] if len(sys.argv)>2 else 'http://127.0.0.1:5189'
DEV=sys.argv[3] if len(sys.argv)>3 else 'http://127.0.0.1:5184'
OUT=Path('/tmp/game-typing-qa/asset-cycle/interception');OUT.mkdir(parents=True,exist_ok=True)
module=ast.parse(Path('checks/asset_load_check.py').read_text())
READ=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='READ' for t in n.targets))
INIT="localStorage.setItem('icebreaker.sound','false');"
PROBE="""async()=>{const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/fx/scene.ts')).name;
const {Scene}=await import(url);const frame=Scene.prototype.frame;window.qaInterceptions=[];
Scene.prototype.frame=function(t){window.qaScene=this;return frame.call(this,t);};
const intercept=Scene.prototype.showIntercept;Scene.prototype.showIntercept=function(at){qaInterceptions.push({generation:this.generation,point:[...at]});return intercept.call(this,at);};}"""
STATE="""()=>({generation:qaScene.generation,progress:[...qaScene.progressByGeneration],world:qaScene.time,
travel:qaScene.tunnelZ,shake:[...qaScene.shakeOffset],interceptions:qaInterceptions,
packet_times:qaScene.packets.map(p=>p.t),particles:[qaScene.sparks,qaScene.shards,qaScene.rings].map(a=>a.map(p=>p.life))})"""
results=[];reference=None
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for tag,url,probe,reduced in [('png-baseline',BASE,False,False),('production',URL,False,False),('dev-probed',DEV,True,False),('dev-low-reduced',DEV,True,True)]:
  c=b.new_context(viewport={'width':1366,'height':768},reduced_motion='reduce' if reduced else 'no-preference');c.add_init_script(INIT+("localStorage.setItem('icebreaker.graphics.low','true');" if reduced else ''))
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
  if probe:
   page.evaluate(PROBE);page.wait_for_function('window.qaScene?.background?.naturalWidth>0 && qaScene?.target?.naturalWidth>0')
  page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>1499/2**31;}');page.keyboard.press('Space');page.evaluate('Math.random=qaRandom')
  page.keyboard.type(page.locator('#romaji').inner_text(),delay=6);page.wait_for_timeout(140)
  assert page.locator('#word').inner_text()=='酢'
  if tag!='png-baseline':
   assert '迎撃（通常入力）' in page.locator('#input-label').inner_text()
   assert page.locator('#stage').evaluate("e=>e.classList.contains('intercept-input')")
  page.keyboard.type('s');before=page.locator('#romaji .typed').inner_text();page.keyboard.press('ArrowRight');page.keyboard.type('?')
  assert page.locator('#romaji .typed').inner_text()==before
  if probe:
   prior=page.evaluate(STATE);page.wait_for_timeout(500);idle=page.evaluate(STATE)
   assert prior['generation']==idle['generation']==1 and prior['progress']==idle['progress']
   assert not idle['interceptions']
   sizes=[(1920,1080),(1366,768),(800,600),(768,1024)] if not reduced else [(800,600)]
   for width,height in sizes:
    page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(80)
    box=page.locator('#input-panel').bounding_box();label=page.locator('#input-label').bounding_box()
    assert label['x']>=box['x'] and label['x']+label['width']<=box['x']+box['width']+.5
    page.screenshot(path=str(OUT/f'{tag}-telegraph-{width}x{height}.png'))
   page.set_viewport_size({'width':1366,'height':768});page.wait_for_timeout(80)
  page.keyboard.press('Escape');page.wait_for_timeout(100)
  timer=page.locator('#timer').inner_text()
  if probe: paused=page.evaluate(STATE);pixels=page.locator('#scene').evaluate('c=>c.toDataURL()')
  page.wait_for_timeout(200);assert page.locator('#timer').inner_text()==timer
  if probe:assert page.evaluate(STATE)==paused and page.locator('#scene').evaluate('c=>c.toDataURL()')==pixels
  page.keyboard.press('Enter');page.keyboard.type('u');page.wait_for_timeout(100)
  if tag!='png-baseline':assert '迎撃' not in page.locator('#input-label').inner_text()
  if probe:
   assert len(page.evaluate('qaInterceptions'))==1
   page.screenshot(path=str(OUT/f'{tag}-intercepted-1366.png'))
  for _ in range(4):
   preview=[page.locator('#next-word').inner_text(),page.locator('#following-word').inner_text()]
   page.keyboard.type(page.locator('#romaji').inner_text(),delay=6);page.wait_for_timeout(100)
   assert page.locator('#word').inner_text()==preview[0] and page.locator('#next-word').inner_text()==preview[1]
  if probe:
   reactions=page.evaluate('qaInterceptions');assert [r['generation'] for r in reactions]==[1,4]
   if reduced:assert reactions[0]['point']==reactions[1]['point']
  page.evaluate("""()=>{const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});Object.defineProperty(e,'timeStamp',{value:performance.now()+65000});document.activeElement.dispatchEvent(e);}""")
  page.wait_for_function("document.querySelector('#session-save-state').textContent.includes('このブラウザに保存しました')")
  records=page.evaluate(READ);raw=records['events'][0]['events'];stable=[{k:v for k,v in e.items() if k not in ['session','t','dt']} for e in raw]
  if reference is None:reference=stable
  assert stable==reference,{'tag':tag,'stable':stable,'reference':reference}
  assert sum(not e['correct'] for e in raw)==1 and sum(bool(e['afterPause']) for e in raw)==1
  assert '中断あり' in page.locator('#r-mode').inner_text()
  page.reload();assert json.dumps(page.evaluate(READ),sort_keys=True)==json.dumps(records,sort_keys=True)
  assert not errors,errors
  results.append({'condition':tag,'keys':len(raw),'exact_persisted_stable_fields_match':True,'one_deliberate_miss':True,'one_after_pause':True,'saved_reload_exact':True,
   'reaction_generations':[1,4] if probe else None,'page_errors':errors});c.close()
 b.close()
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2))
