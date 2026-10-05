"""Local SKYWAY review: actual app scene, native typing, fallback and video.

Usage: python checks/skyway_check.py [Vite dev URL] [retained baseline URL]
The optional scene probe imports the app's existing Vite module; no production
hooks or exports are added. Fresh browser profiles contain artificial logs only.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5184'
BASE = sys.argv[2] if len(sys.argv)>2 else 'http://127.0.0.1:5188'
OUT = Path('/tmp/game-typing-qa/skyway-cycle')
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(1920,1080),(1366,768),(1024,768),(800,600),(768,1024)]
INIT = """localStorage.setItem('icebreaker.sound','false');
let qaSeed=1234567;Math.random=()=>{qaSeed=(Math.imul(qaSeed,1664525)+1013904223)>>>0;return qaSeed/2**32;};"""
PROBE = """async()=>{const moduleURL=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/fx/scene.ts')).name;
const {Scene}=await import(moduleURL);window.qaTransitions=[];
const frame=Scene.prototype.frame;Scene.prototype.frame=function(t){window.qaScene=this;return frame.call(this,t);};
for(const name of ['showLayerBreak','showBreach']){const fn=Scene.prototype[name];Scene.prototype[name]=function(...args){qaTransitions.push({name,at:performance.now()});return fn.apply(this,args);};}}"""
STATE = """()=>({generation:qaScene.generation, inputGeneration:qaScene.inputGeneration,
progress:[...qaScene.progressByGeneration], radius:qaScene.cubeRadius,thrust:qaScene.thrust,
world:qaScene.time,travel:qaScene.tunnelZ,shake:[...qaScene.shakeOffset],
packets:qaScene.packets.map(p=>[p.t,p.generation,p.completion]),
particles:[qaScene.sparks,qaScene.shards,qaScene.rings].map(a=>a.map(p=>p.life)),
low:qaScene.lowGraphics,backing:[qaScene.canvas.width,qaScene.canvas.height]})"""
rows={'layout':[],'captures':[],'checks':[]}

def start(page):
    page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>1499/2**31;}')
    page.keyboard.press('Space')
    page.evaluate('Math.random=qaRandom')
    assert page.locator('#romaji').inner_text() == 'chirimotsumorebayamatonaru'

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    rows['browser']=browser.version
    # Retain real baseline output, rather than reconstructing the old UI.
    context=browser.new_context(viewport={'width':1920,'height':1080});context.add_init_script(INIT)
    page=context.new_page();page.goto(BASE);start(page);page.keyboard.type('chiri',delay=60);page.wait_for_timeout(150)
    page.screenshot(path=str(OUT/'before-1920.png'));rows['captures'].append('before-1920.png');context.close()

    context=browser.new_context(viewport={'width':1920,'height':1080},record_video_dir=str(OUT/'video'),record_video_size={'width':1366,'height':768})
    context.add_init_script(INIT);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.evaluate(PROBE);page.wait_for_function('window.qaScene?.background?.naturalWidth>0')
    start(page);page.wait_for_timeout(200);initial=page.evaluate(STATE)
    page.keyboard.type('chiri',delay=30);page.wait_for_timeout(50);hit=page.evaluate(STATE)
    assert hit['radius']>initial['radius'] and hit['thrust']>0, {'initial':initial,'hit':hit}
    for width,height in SIZES:
        page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(120)
        geo=page.evaluate("""()=>{const input=document.querySelector('#input-panel').getBoundingClientRect();
          return {panel_inside:input.left>=0&&input.right<=innerWidth+.5&&input.top>=0&&input.bottom<=innerHeight+.5,
          canvas_full:document.querySelector('#scene').getBoundingClientRect().width>=document.querySelector('#stage').getBoundingClientRect().width-.5,
          artwork_ready:qaScene.background.naturalWidth>0,arena_bottom:qaScene.arenaBottom};}""")
        assert geo['panel_inside'] and geo['canvas_full'] and geo['artwork_ready'],geo
        name=f'flight-{width}x{height}.png';page.screenshot(path=str(OUT/name));rows['captures'].append(name);rows['layout'].append({'viewport':[width,height],**geo})
    page.set_viewport_size({'width':1920,'height':1080});page.wait_for_timeout(120)
    panel_before=page.locator('#input-panel').bounding_box();typed=page.locator('#romaji .typed').inner_text();before_miss=page.evaluate(STATE)
    page.keyboard.type('?');page.wait_for_timeout(40);miss=page.evaluate(STATE)
    assert page.locator('#romaji .typed').inner_text()==typed and before_miss['inputGeneration']==miss['inputGeneration']
    assert panel_before==page.locator('#input-panel').bounding_box()
    page.screenshot(path=str(OUT/'miss-1920.png'));rows['captures'].append('miss-1920.png')
    page.keyboard.type(page.locator('#romaji').inner_text()[len(typed):],delay=50);page.wait_for_timeout(110)
    page.screenshot(path=str(OUT/'breakthrough-1920.png'));rows['captures'].append('breakthrough-1920.png')
    for _ in range(5):
        preview=[page.locator('#next-word').inner_text(),page.locator('#following-word').inner_text()]
        page.keyboard.type(page.locator('#romaji').inner_text(),delay=35);page.wait_for_timeout(110)
        assert page.locator('#word').inner_text()==preview[0] and page.locator('#next-word').inner_text()==preview[1]
    transitions=page.evaluate('qaTransitions');state=page.evaluate(STATE)
    assert len(transitions)==state['generation']==6 and sum(t['name']=='showBreach' for t in transitions)==1
    page.keyboard.type('?');page.keyboard.press('Escape');page.wait_for_timeout(80)
    paused=page.evaluate(STATE);pixels=page.locator('#scene').evaluate('c=>c.toDataURL()');page.wait_for_timeout(800)
    assert page.evaluate(STATE)==paused and page.locator('#scene').evaluate('c=>c.toDataURL()')==pixels
    page.keyboard.press('Enter');page.wait_for_timeout(200);assert page.evaluate(STATE)['world']>paused['world']
    assert not errors,errors
    rows['checks'].append({'native_typing':True,'progress_drives_approach':True,'miss_never_advances':True,
      'fixed_input_panel_during_shake':True,'six_completions_six_barriers_one_route_breach':True,
      'pause_freezes_scene_pixels_and_resume_continues':True,'page_errors':errors})
    video=page.video;context.close();rows['video_webm']=str(video.path())

    # Reduced motion and low load preserve successful completion with no travel.
    context=browser.new_context(viewport={'width':800,'height':600},reduced_motion='reduce');context.add_init_script(INIT+"localStorage.setItem('icebreaker.graphics.low','true');")
    page=context.new_page();page.goto(URL);page.evaluate(PROBE);page.wait_for_function('window.qaScene?.background?.naturalWidth>0');start(page)
    before=page.evaluate(STATE);page.keyboard.type('chiri',delay=20);page.wait_for_timeout(120);after=page.evaluate(STATE)
    assert before['radius']==after['radius'] and before['travel']==after['travel'] and after['low'] and max(after['backing'])<=1920
    page.keyboard.type(page.locator('#romaji').inner_text()[5:],delay=20);page.wait_for_timeout(120);assert page.evaluate(STATE)['generation']==1
    page.screenshot(path=str(OUT/'reduced-low-800.png'));rows['captures'].append('reduced-low-800.png');rows['checks'].append({'motion_off':True,'low_load_backing_cap':True,'completion_feedback_retained':True});context.close()

    for fail in ['artwork','canvas']:
        context=browser.new_context(viewport={'width':800,'height':600});context.add_init_script(INIT)
        if fail=='artwork': context.route('**/stages/skyway.png',lambda route:route.abort())
        else: context.add_init_script("const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){return args[0]==='2d'?null:get.apply(this,args);};")
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL);start(page);page.keyboard.type('chiri',delay=20)
        assert page.locator('#romaji .typed').inner_text()=='chiri'
        if fail=='canvas': assert page.locator('#stage').evaluate("e=>e.classList.contains('scene-unavailable')")
        page.screenshot(path=str(OUT/f'fallback-{fail}-800.png'));rows['captures'].append(f'fallback-{fail}-800.png')
        assert not errors,errors;rows['checks'].append({'unavailable':fail,'typing_continues':True,'page_errors':errors});context.close()
    browser.close()
(OUT/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print(json.dumps(rows,ensure_ascii=False,indent=2))
