"""Actual local browser A/B captures and synthetic renderer/input regressions.

Usage: python checks/graphics_check.py [updated URL] [baseline URL]
Both servers must serve preserved builds, never deployed games or personal data.
"""
import json
import math
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:5180'
OUT = Path('/tmp/game-typing-qa/graphics-cycle')
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(1920, 1080), (1366, 768), (1024, 768), (800, 600), (768, 1024)]
rows = {'layout': [], 'captures': [], 'input': [], 'rendering': [], 'settings': []}

# Deterministic procedural visuals; scripted rAF advances only for A/B screenshots.
CAPTURE = '''window.qaCallbacks=[];window.qaNow=0;
window.requestAnimationFrame=cb=>{qaCallbacks.push(cb);return qaCallbacks.length;};
window.qaStep=ms=>{if(!qaNow)qaNow=performance.now();for(let elapsed=0;elapsed<ms;){
  const dt=Math.min(16,ms-elapsed);qaNow+=dt;elapsed+=dt;
  const callbacks=qaCallbacks.splice(0);callbacks.forEach(cb=>cb(qaNow));}}
let qaSeed=1234567;Math.random=()=>{qaSeed=(Math.imul(qaSeed,1664525)+1013904223)>>>0;return qaSeed/2**32;};
localStorage.setItem('icebreaker.sound','false');
localStorage.setItem('icebreaker.effects.shake','0');
localStorage.setItem('icebreaker.effects.flash','0');
'''

MEASURE = '''window.qaCollect=false;window.qaHandler=[];window.qaNext=[];window.qaDraw=[];
const nativeRAF=requestAnimationFrame.bind(window);let app=null;
window.requestAnimationFrame=cb=>{app??=cb;return nativeRAF(t=>{const start=performance.now();cb(t);
  if(qaCollect&&cb===app)qaDraw.push(performance.now()-start);});};
const originalAdd=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(type,listener,options){
  if(this===window&&type==='keydown'&&typeof listener==='function'){
    const original=listener;listener=function(e){const record=qaCollect&&e.isTrusted&&e.key.length===1&&!e.repeat;
      const start=performance.now();original.call(this,e);
      if(record){qaHandler.push(performance.now()-start);nativeRAF(()=>qaNext.push(performance.now()-start));}};
  }return originalAdd.call(this,type,listener,options);};
localStorage.setItem('icebreaker.sound','false');
'''


def start(page, seed, english=False):
    if english:
        page.keyboard.press('d')
    page.evaluate('seed=>{window.qaSavedRandom=Math.random;Math.random=()=>seed/2**31;}', seed)
    page.keyboard.press('Space')
    page.evaluate('Math.random=qaSavedRandom')


def save(page):
    page.evaluate('''()=>{const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});
      Object.defineProperty(e,'timeStamp',{value:performance.now()+60001});document.activeElement.dispatchEvent(e);}''')
    page.wait_for_function("!document.querySelector('#result-screen').classList.contains('hidden') && !document.querySelector('#session-save-state').textContent.includes('保存中')")
    return page.evaluate('''async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
      const records=await new Promise((resolve,reject)=>{const r=db.transaction('events').objectStore('events').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
      db.close();return records.flatMap(r=>r.events).map(e=>({key:e.key,code:e.code,correct:e.correct,expected:e.expected,wordId:e.wordId,wordStart:e.wordStart}));}''')


def summary(values):
    values = sorted(values)
    return {'n': len(values), **{label: round(values[math.ceil(len(values)*q)-1], 3)
                                for label, q in [('p50_ms', .5), ('p95_ms', .95), ('p99_ms', .99)]},
            'max_ms': round(values[-1], 3)} if values else {'n': 0}


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    rows['browser'] = browser.version
    # A/B preference evidence: same seed, partial typed prefix, viewport and frame steps.
    for tag, url in [('A', BASE), ('B', URL)]:
        context = browser.new_context(reduced_motion='reduce')
        context.add_init_script(CAPTURE)
        page = context.new_page()
        page.goto(url)
        start(page, 1499)
        assert page.locator('#romaji').inner_text() == 'chirimotsumorebayamatonaru'
        page.evaluate('qaStep(160)')
        page.keyboard.type('chiri', delay=2)
        page.evaluate('qaStep(160)')
        for width, height in SIZES:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_function("Math.abs(document.querySelector('#stage').getBoundingClientRect().width-Math.min(innerWidth/1920,innerHeight/1080)*1920)<0.5", polling=50)
            page.evaluate('qaStep(16)')
            geometry = page.evaluate('''()=>{const panel=document.querySelector('#input-panel').getBoundingClientRect(),
              scale=new DOMMatrix(getComputedStyle(document.querySelector('#stage')).transform).a;
              return {panel_inside:panel.left>=0&&panel.right<=innerWidth&&panel.top>=0&&panel.bottom<=innerHeight,
                text:['word','reading','romaji'].map(id=>{const e=document.getElementById(id),r=document.createRange();r.selectNodeContents(e);const t=r.getBoundingClientRect();
                  return {id,font_px:parseFloat(getComputedStyle(e).fontSize)*scale,overflow:e.scrollWidth>e.clientWidth+1,
                    inside:t.left>=panel.left&&t.right<=panel.right&&t.top>=panel.top&&t.bottom<=panel.bottom};})};}''')
            assert geometry['panel_inside'] and all(t['inside'] and not t['overflow'] for t in geometry['text'])
            if tag == 'B':
                assert next(t['font_px'] for t in geometry['text'] if t['id'] == 'reading') >= 13.99
            name = f'{tag}-reading-{width}x{height}.png'
            page.screenshot(path=str(OUT / name))
            rows['layout'].append({'tag': tag, 'viewport': [width, height], 'seed': 1499, 'prefix': 'chiri', **geometry})
            rows['captures'].append(name)
        context.close()

        context = browser.new_context(viewport={'width': 1920, 'height': 1080}, reduced_motion='no-preference')
        context.add_init_script(CAPTURE)
        page = context.new_page()
        page.goto(url)
        start(page, 8, english=True)
        assert not page.locator('#stage').evaluate("e=>e.classList.contains('scene-unavailable')")
        page.evaluate('qaStep(160)')
        words = []
        for i in range(5):
            text = page.locator('#romaji').inner_text()
            words.append(text)
            page.keyboard.type(text, delay=2)
            if i < 4:
                page.evaluate('qaStep(160)')
        assert page.locator('#ice-id').inner_text() == '[ ICE // FW-002 ]'
        for step, ms in [(0, 0), (48, 48), (96, 48), (192, 96)]:
            page.evaluate('ms=>qaStep(ms)', ms)
            name = f'{tag}-breach-{step}ms-1920x1080.png'
            page.screenshot(path=str(OUT / name))
            rows['captures'].append(name)
        rows.setdefault('breach_words', {})[tag] = words
        context.close()
    assert rows['breach_words']['A'] == rows['breach_words']['B']

    # All graphics paths retain the same accepted key sequence and persistent logs.
    configurations = ['normal', 'low', 'reduced', 'webgl-disabled', 'canvas-null', 'canvas-throws', 'context-loss', 'draw-failure']
    expected_log = None
    for config in configurations:
        context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce' if config == 'reduced' else 'no-preference')
        context.add_init_script("localStorage.setItem('icebreaker.sound','false');")
        if config == 'low':
            context.add_init_script("localStorage.setItem('icebreaker.graphics.low','true');")
        if config in ['webgl-disabled', 'canvas-null', 'canvas-throws']:
            context.add_init_script('const config=' + json.dumps(config) + ';' + '''const original=HTMLCanvasElement.prototype.getContext;
              HTMLCanvasElement.prototype.getContext=function(type,...args){
                if(type==='webgl'||type==='webgl2')return null;
                if(this.id==='scene'&&type==='2d'){
                  if(config==='canvas-null')return null;
                  if(config==='canvas-throws')throw Error('Synthetic graphics initialisation failure');
                }return original.call(this,type,...args);};''')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        start(page, 8, english=True)
        assert page.locator('#stage').evaluate("e=>e.classList.contains('scene-unavailable')") == (config in ['canvas-null', 'canvas-throws'])
        words = []
        for i in range(12):
            if i == 3 and config == 'context-loss':
                page.evaluate("document.querySelector('#scene').dispatchEvent(new Event('contextlost'))")
                assert page.locator('#stage').evaluate("e=>e.classList.contains('scene-unavailable')")
            if i == 3 and config == 'draw-failure':
                page.evaluate("()=>{const c=document.querySelector('#scene').getContext('2d');window.qaFill=c.fillRect;c.fillRect=()=>{throw Error('Synthetic draw failure')};}")
                page.wait_for_function("document.querySelector('#stage').classList.contains('scene-unavailable')")
            if i == 7 and config in ['context-loss', 'draw-failure']:
                page.evaluate("const e=document.querySelector('#scene');if(window.qaFill)e.getContext('2d').fillRect=qaFill;e.dispatchEvent(new Event('contextrestored'))")
                assert not page.locator('#stage').evaluate("e=>e.classList.contains('scene-unavailable')")
            text = page.locator('#romaji').inner_text()
            words.append(text)
            page.keyboard.type(text, delay=2)
            if i == 5:
                page.screenshot(path=str(OUT / f'B-{config}-playing.png'))
        assert page.locator('#accuracy-note').inner_text() == 'ミス 0'
        assert not page.locator('#ready-help').is_visible()
        if config == 'reduced':
            assert page.locator('#stage').evaluate("e=>e.classList.contains('motion-off')")
        log = save(page)
        assert [e['key'] for e in log] == list(''.join(words))
        assert all(e['correct'] for e in log)
        expected_log = log if expected_log is None else expected_log
        assert log == expected_log, config
        if config not in ['canvas-null', 'canvas-throws']:
            assert not page.locator('#stage').evaluate("e=>e.classList.contains('scene-unavailable')")
        assert not errors, (config, errors)
        rows['input'].append({'config': config, 'trusted_keys': len(log), 'words': len(words), 'equal_persisted_log': True, 'page_errors': errors})
        context.close()

    # New low-load control is native, persistent, and cannot overwrite damaged original data.
    for damaged in [False, True]:
        context = browser.new_context(device_scale_factor=2, viewport={'width': 1920, 'height': 1080})
        if damaged:
            context.add_init_script("localStorage.setItem('icebreaker.graphics.low','\"unrecognised\"')")
        page = context.new_page()
        page.goto(URL)
        page.keyboard.press('s')
        page.locator('#graphics-toggle').focus()
        page.keyboard.press('Enter')
        assert page.locator('#setting-graphics').inner_text() == '低負荷'
        assert page.evaluate('document.activeElement.id') == 'graphics-toggle'
        assert page.locator('#scene').evaluate('e=>[e.width,e.height]') == [1920, 1080]
        if damaged:
            assert page.evaluate("localStorage.getItem('icebreaker.graphics.low')") == '"unrecognised"'
            assert page.locator('#settings-save-state').is_visible()
        else:
            assert page.evaluate("localStorage.getItem('icebreaker.graphics.low')") == 'true'
            page.reload()
            page.keyboard.press('s')
            assert page.locator('#setting-graphics').inner_text() == '低負荷'
            page.locator('#graphics-toggle').focus()
            page.keyboard.press('Space')
            assert page.locator('#setting-graphics').inner_text() == '標準'
            assert page.locator('#scene').evaluate('e=>[e.width,e.height]') == [3840, 2160]
        rows['settings'].append({'damaged_original': damaged, 'passed': True})
        context.close()

    # Serial diagnostic software samples, never a statistical A/B or device latency test.
    for repeat in range(2):
        for config, url in [('A-normal', BASE), ('B-normal', URL), ('B-low', URL), ('B-reduced', URL)]:
            context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce' if config == 'B-reduced' else 'no-preference')
            context.add_init_script(MEASURE)
            if config == 'B-low':
                context.add_init_script("localStorage.setItem('icebreaker.graphics.low','true')")
            page = context.new_page()
            page.goto(url)
            start(page, 8, english=True)
            page.wait_for_timeout(250)
            page.evaluate('qaCollect=true')
            keys = 0
            for _ in range(30):
                text = page.locator('#romaji').inner_text()
                page.keyboard.type(text, delay=2)
                keys += len(text)
            page.evaluate('qaCollect=false')
            page.wait_for_timeout(100)
            data = page.evaluate('({handler:qaHandler,next:qaNext,draw:qaDraw})')
            assert len(data['handler']) == len(data['next']) == keys
            assert page.locator('#accuracy-note').inner_text() == 'ミス 0'
            rows['rendering'].append({'repeat': repeat+1, 'config': config, 'trusted_keys': keys,
                                      'handler': summary(data['handler']), 'next_callback': summary(data['next']), 'app_loop': summary(data['draw'])})
            context.close()
    browser.close()

rows['limits'] = ('Actual application browser screenshots with scripted rAF only for reproducible visual capture; synthetic seeds/data/deadlines/context failure flags. '
                  'No real GPU context loss, physical device latency, actual paint timing, Safari/Firefox, spoken accessibility, or paid-product comparison. '
                  'A/B is a design preference comparison, not a statistical experiment. WebGL is unused by this Canvas2D renderer.')
(OUT / 'graphics-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
print(json.dumps({'layout_cases': len(rows['layout']), 'input': rows['input'], 'settings': rows['settings'], 'rendering': rows['rendering']}, ensure_ascii=False, indent=2))
