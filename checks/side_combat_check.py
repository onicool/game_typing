"""Finite side-view practice checks with isolated artificial profiles.

Run against a local preview; screenshots and measurements go outside the repo.
JS dispatch duration is not physical latency, FPS, or GPU rendering cost.
"""
import json
import statistics
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from browser_support import launch_chromium, enter_characters

URL, destination = sys.argv[1:3]
assert urlparse(URL).hostname in ('localhost', '127.0.0.1')
OUT = Path(destination)
assert not OUT.exists(), 'Preserve earlier evidence'
OUT.mkdir(parents=True)
ERRORS, CASES = [], []
INIT = '''
const open=indexedDB.open.bind(indexedDB), db='side-check-'+crypto.randomUUID();
indexedDB.open=(name,...args)=>open(name==='icebreaker-stats'?db:name,...args);
localStorage.setItem('icebreaker.sound','false'); Math.random=()=>.25;
'''


def action(page, name):
    page.locator(f'[data-action="{name}"]').click()


def guide(page):
    return page.locator('#romaji').inner_text()[len(page.locator('#romaji .av-typed').inner_text()):]


def state(page):
    return page.locator('.side-vector').evaluate('''s=>({
      accepted:+s.dataset.accepted||0, attacks:+s.dataset.attacks||0,
      deflections:+s.dataset.deflections||0, mode:s.dataset.mode,
      nodes:s.querySelectorAll('*').length,
      effects:[...s.querySelectorAll('.side-key-effect')].filter(e=>+e.getAttribute('opacity')>0)
        .map(e=>({id:+e.dataset.id, action:e.dataset.action, opacity:+e.getAttribute('opacity')})),
      contact:s.querySelector('.side-shield').dataset.contact,
      playerPose:s.querySelector('.side-player').dataset.pose,
      enemyPose:s.querySelector('.side-enemy').dataset.pose,
      result:s.querySelector('.side-outcome').dataset.kind,
      label:s.querySelector('.side-outcome-text').textContent})''')


def geometry(page):
    return page.evaluate('''()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      const scene=rect('.av-combat-scene'), input=rect('#romaji'), marker=rect('#romaji .current-unit');
      return {size:[innerWidth,innerHeight],scroll:scrollY,page:document.documentElement.scrollHeight,
        overflowX:document.documentElement.scrollWidth>innerWidth,scene,input,marker,
        wordTop:document.querySelector('#word').scrollTop,
        romajiFont:parseFloat(getComputedStyle(document.querySelector('#romaji')).fontSize)};
    }''')


with sync_playwright() as p:
    browser = launch_chromium(p)

    def fresh(long=False, size=(1366, 768), virtual=False, settings='', reduced='no-preference'):
        context = browser.new_context(viewport={'width':size[0], 'height':size[1]}, reduced_motion=reduced)
        context.add_init_script(INIT + settings)
        page = context.new_page()
        page.set_default_timeout(8000)
        page.on('pageerror', lambda e: ERRORS.append(str(e)))
        if virtual:
            page.clock.install(time=0)
            page.clock.pause_at(1000)
        page.goto(URL); enter_characters(page)
        if long:
            page.locator('[data-view="training"]').click()
        action(page, 'combat-long' if long else 'combat-practice')
        page.evaluate('''async()=>{
          const urls=[...document.querySelectorAll('.side-sprite')].map(e=>e.getAttribute('href'));
          urls.push(getComputedStyle(document.querySelector('.av-combat-scene')).backgroundImage.slice(5,-2));
          await Promise.all(urls.map(src=>new Promise((ok,no)=>{
            const image=new Image();image.onload=()=>image.naturalWidth>0?ok():no(new Error(src));
            image.onerror=()=>no(new Error(src));image.src=src;
          })));
        }''')
        if page.locator('.side-vector').get_attribute('data-art-ready') != 'static':
            page.wait_for_function("document.querySelector('.side-vector').dataset.artReady==='ready'")
        return context, page

    for character in ('elna', 'towa'):
        c, page = fresh(virtual=True, settings=f"localStorage.setItem('icebreaker.angel.character',JSON.stringify('{character}'));")
        assert page.locator('.av-combat-scene').get_attribute('data-character') == character
        assert state(page)['playerPose'] == state(page)['enemyPose'] == 'idle'
        art = page.locator('.side-sprite').evaluate_all('''images=>images.map(e=>({
          href:e.getAttribute('href'), opacity:e.getAttribute('opacity'),
          x:+e.getAttribute('x'), y:+e.getAttribute('y'), h:+e.getAttribute('height')}))''')
        assert len(art) == 2 and sum(a['opacity'] == '0' for a in art) == 2
        assert all(a['y'] >= 0 and a['y'] + a['h'] <= 260 for a in art)
        page.keyboard.type(guide(page)[:1])
        assert state(page)['playerPose'] == 'attack' and state(page)['enemyPose'] == 'hit'
        page.screenshot(path=str(OUT/f'{character}-attack.png'))
        page.clock.run_for(352)
        assert state(page)['playerPose'] == state(page)['enemyPose'] == 'idle'
        page.keyboard.type(guide(page)); page.clock.run_for(500)
        assert state(page)['playerPose'] == 'guard'
        page.screenshot(path=str(OUT/f'{character}-guard.png'))
        page.keyboard.type(guide(page))
        assert state(page)['result'] == 'parry' and state(page)['playerPose'] == 'guard'
        page.screenshot(path=str(OUT/f'{character}-parry.png'))
        assert page.locator('.side-player').get_attribute('transform') is None
        assert page.locator('.side-enemy').get_attribute('transform') is None
        CASES.append({'case':character+'-loaded-atlases-immediate-attack-guard-parry', 'posterImages':len(art)})
        c.close()
    print('Both illustrated characters and pose changes passed', flush=True)

    layouts = []
    for size in [(1366,768), (800,600), (390,844), (640,480), (320,568)]:
        for long in (False, True):
            c, page = fresh(long=long, size=size)
            g = geometry(page)
            assert not g['overflowX'] and g['scroll'] == 0, g
            assert 0 <= g['scene']['top'] < g['scene']['bottom'] <= size[1], g
            assert g['scene']['bottom'] <= g['input']['top'], g
            assert g['input']['bottom'] <= size[1] + 1 and g['romajiFont'] >= 22, g
            assert g['wordTop'] == 0, 'An oversized active sentence must start at its beginning'
            page.keyboard.type(guide(page)[:12])
            assert state(page)['accepted'] == 12
            assert geometry(page)['scroll'] == 0
            if size in [(1366,768), (390,844)]:
                page.screenshot(path=str(OUT/f'layout-{size[0]}-{"long" if long else "short"}.png'))
            page.locator('#chapter-queue summary').click()
            assert page.locator('#next-word').is_visible() and page.locator('#following-word').is_visible()
            assert not geometry(page)['overflowX']
            page.locator('#chapter-queue summary').click()
            layouts.append({'size':size, 'long':long, 'geometry':g})
            c.close()
    CASES.append({'case':'ten-layouts-current-input-visible-and-disclosure', 'layouts':layouts})
    print('Ten layouts passed', flush=True)

    # All 100 keys arrive in one task: bounded overlap, no deferred animation queue.
    for repeat in range(1):
        c, page = fresh(long=True, virtual=True)
        initial_nodes = state(page)['nodes']
        costs = page.evaluate('''()=>{
          const guide=document.querySelector('#romaji').textContent, costs=[], stamp=performance.now();
          for(const key of guide.slice(0,100)){
            const e=new KeyboardEvent('keydown',{key,code:/[a-z]/i.test(key)?'Key'+key.toUpperCase():'Period',bubbles:true});
            Object.defineProperty(e,'timeStamp',{value:stamp});
            const t=performance.now();window.dispatchEvent(e);costs.push(performance.now()-t);
          } return costs;
        }''')
        s = state(page)
        assert len(costs) == s['accepted'] == s['attacks'] == 100 and s['deflections'] == 0, s
        assert s['nodes'] == initial_nodes and len(s['effects']) == 64, s
        assert sorted(e['id'] for e in s['effects']) == list(range(37,101)), s
        newest = next(e for e in s['effects'] if e['id'] == 100)
        assert newest['opacity'] == 1
        assert max(e['opacity'] for e in s['effects'] if e['id'] != 100) < .1
        page.clock.run_for(16)
        if repeat == 0:
            page.screenshot(path=str(OUT/'attack-burst.png'))
        page.clock.run_for(300)
        assert not state(page)['effects'] and state(page)['accepted'] == 100
        # Repeat, composition and modifier keys must never create effects.
        page.evaluate('''()=>{
          for(const flags of [{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true}])
            window.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true,...flags}));
        }''')
        assert state(page)['accepted'] == 100
        action(page, 'pause'); page.clock.fast_forward(180000); action(page, 'resume')
        assert state(page)['accepted'] == 100 and not state(page)['effects']
        assert geometry(page)['scroll'] == 0
        action(page, 'pause'); page.locator('#pause-finish').click()
        page.locator('#session-save-state').filter(has_text='このブラウザに保存しました').wait_for()
        stored = page.evaluate('''async()=>{
          const db=await new Promise(ok=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);});
          const get=name=>new Promise(ok=>{const r=db.transaction(name,'readonly').objectStore(name).getAll();r.onsuccess=()=>ok(r.result);});
          const [sessions,events]=await Promise.all(['sessions','events'].map(get));db.close();
          return {dict:sessions[0].dict,mode:sessions[0].mode,keys:events[0].events.length,
            correct:events[0].events.every(e=>e.correct),sessions:sessions.length};
        }''')
        assert stored == {'dict':'jp-duel-long-v1','mode':'practice','keys':100,'correct':True,'sessions':1}, stored
        c.close()
    CASES.append({'case':'100-key-burst-fixed-pool-expiry-pause-excluded-keys-and-save'})
    # Measure a real browser clock separately: virtual performance.now cannot measure cost.
    measurements = []
    for _ in range(3):
        c, page = fresh(long=True)
        costs = page.evaluate('''()=>{
          const guide=document.querySelector('#romaji').textContent, costs=[], stamp=performance.now();
          for(const key of guide.slice(0,100)){
            const e=new KeyboardEvent('keydown',{key,code:/[a-z]/i.test(key)?'Key'+key.toUpperCase():'Period',bubbles:true});
            Object.defineProperty(e,'timeStamp',{value:stamp});
            const t=performance.now();window.dispatchEvent(e);costs.push(performance.now()-t);
          } return costs;
        }''')
        assert len(costs) == state(page)['accepted'] == 100
        values = sorted(costs)
        measurements.append({'samples':len(values), 'medianMs':statistics.median(values),
                             'p95Ms':values[94], 'maxMs':max(values)})
        c.close()
    CASES.append({'case':'three-real-clock-100-key-dispatch-measurements', 'measurements':measurements})
    print('Burst and real-clock measurements passed', flush=True)

    c, page = fresh(virtual=True)
    page.keyboard.type(guide(page))
    assert state(page)['mode'] == 'defend' and state(page)['result'] == 'combo'
    page.clock.run_for(950)
    assert state(page)['result'] == ''
    # A chip is announced in the defense phase, then delivered in small packets.
    for _ in range(200):
        page.clock.run_for(100)
        if state(page)['contact'] == 'impact':
            break
    assert state(page)['contact'] == 'impact' and '98 / 100' in page.locator('#compact-barrier').inner_text()
    assert geometry(page)['scroll'] == 0, 'Chip feedback moved the viewport'
    assert page.locator('.side-impact-lines').evaluate("e=>getComputedStyle(e).opacity") == '1'
    page.screenshot(path=str(OUT/'impact.png'))
    before = state(page)['accepted']
    page.keyboard.type('#' + guide(page))
    assert state(page)['accepted'] > before and state(page)['mode'] == 'attack'
    assert state(page)['result'] == 'parry' and '100 / 100' in page.locator('#compact-barrier').inner_text()
    assert geometry(page)['scroll'] == 0, 'Completing a word moved the viewport'
    page.screenshot(path=str(OUT/'parry.png'))
    action(page, 'pause'); frozen = state(page)
    page.clock.fast_forward(180000)
    assert state(page) == frozen
    action(page, 'resume'); page.clock.run_for(16)
    assert state(page)['contact'] == 'parry'
    # Synthetic visibility events test the app clock; OS tab switching is separate.
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
    hidden = state(page); page.clock.fast_forward(180000)
    assert state(page) == hidden
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
    # Returning from a hidden tab opens pause; explicit resume keeps the clock stable.
    if page.locator('#pause-dialog').is_visible():
        action(page, 'resume')
    page.clock.run_for(16)
    assert state(page)['contact'] == 'parry'
    CASES.append({'case':'chip-shape-corrected-completion-recovers-parry-pause-visibility-clock', 'syntheticVisibility':True})
    print('Chip, parry and clock passed', flush=True)
    c.close()

    for kind, settings in [('off',"localStorage.setItem('icebreaker.effects.motion','0');"),
                           ('low',"localStorage.setItem('icebreaker.graphics.low','true');"), ('reduced','')]:
        c, page = fresh(long=True, virtual=True, settings=settings, reduced='reduce' if kind == 'reduced' else 'no-preference')
        page.keyboard.type(guide(page)[:80])
        s = state(page)
        assert s['accepted'] == 80 and len(s['effects']) == 64
        assert page.locator('.side-player').get_attribute('transform') is None
        assert s['playerPose'] == s['enemyPose'] == 'idle'
        page.clock.run_for(300)
        assert not state(page)['effects']
        CASES.append({'case':kind+'-static-input-feedback-expiry'})
        c.close()

    c, page = fresh()
    page.wait_for_function("document.querySelector('#bgm-player').currentTime>.1")
    audio_before = page.locator('#bgm-player').evaluate('a=>({time:a.currentTime,src:a.currentSrc,rate:a.playbackRate,loop:a.loop})')
    page.keyboard.type(guide(page)[:10])
    page.wait_for_timeout(250)
    audio_after = page.locator('#bgm-player').evaluate('a=>({time:a.currentTime,src:a.currentSrc,rate:a.playbackRate,loop:a.loop})')
    assert audio_after['time'] > audio_before['time'] and audio_after['src'] == audio_before['src']
    assert audio_after['rate'] == 1 and audio_after['loop']
    action(page, 'pause'); stopped = page.locator('#bgm-player').evaluate('a=>a.currentTime')
    page.wait_for_timeout(250)
    assert page.locator('#bgm-player').evaluate('a=>a.paused && Math.abs(a.currentTime-'+str(stopped)+')<.03')
    action(page, 'resume'); page.wait_for_function("document.querySelector('#bgm-player').currentTime>"+str(stopped+.1))
    CASES.append({'case':'ordinary-independent-bgm-pause-resume', 'rate':audio_after['rate'], 'loop':audio_after['loop']})
    # Validate each bundled MP3 in the native browser decoder, separately from app selection.
    decoded = page.evaluate('''async()=>{
      const manifest=await (await fetch('/audio/music/boss/manifest.json')).json(), result=[];
      const media=new Audio();media.muted=true;media.loop=true;
      for(const track of manifest.tracks){
        media.pause();media.src='/audio/music/boss/'+track.file;
        await new Promise((ok,no)=>{media.onloadedmetadata=ok;media.onerror=()=>no(new Error(track.file));media.load();});
        await media.play();media.currentTime=media.duration-.15;
        await new Promise((ok,no)=>{const end=performance.now()+5000;const poll=()=>{
          if(media.currentTime<1)ok();else if(performance.now()>end)no(new Error('Loop timeout: '+track.file));else setTimeout(poll,30);
        };setTimeout(poll,30);});
        result.push({file:track.file,duration:media.duration,looped:media.currentTime<1});
      }
      media.pause();media.removeAttribute('src');media.load();return result;
    }''')
    assert len(decoded) == 7 and all(t['looped'] for t in decoded)
    CASES.append({'case':'seven-bundled-mp3s-native-decode-and-loop', 'tracks':decoded})
    c.close()
    version = browser.version
    browser.close()

assert not ERRORS, ERRORS
result = {'browser':version, 'cases':CASES, 'pageErrors':ERRORS,
          'physicalLatencyMeasured':False, 'gpuCostMeasured':False}
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
