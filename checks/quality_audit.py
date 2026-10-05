"""Local synthetic quality audit. AX/DOM checks are not spoken screen-reader tests."""
import json
import math
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/game-typing-qa')
OUT.mkdir(parents=True, exist_ok=True)
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
subprocess.run(['node', '--input-type=module', '-e', """
import { build } from 'vite';
await build({configFile:false,build:{lib:{entry:'checks/fixtures.ts',formats:['es'],fileName:()=> 'fixtures.js'},outDir:'/tmp/game-typing-qa/fixtures',emptyOutDir:false,minify:false}});
"""], cwd=ROOT, check=True, capture_output=True, text=True)
FIXTURE = (OUT / 'fixtures/fixtures.js').read_text()
SIZES = [(1920, 1080), (1366, 768), (1024, 768), (800, 600), (768, 1024)]
results = {'tools': {name: shutil.which(name) for name in ['orca', 'espeak', 'espeak-ng', 'spd-say', 'speech-dispatcher', 'festival']},
           'notifications': {}, 'layout': [], 'engine': {}}


def load(page):
    page.route('**/__qa__/fixtures.js', lambda route: route.fulfill(body=FIXTURE, content_type='text/javascript'))
    page.goto(URL)
    page.evaluate("async () => { window.qaF=await import('/__qa__/fixtures.js'); }")


def size(page, width, height):
    page.set_viewport_size({'width': width, 'height': height})
    # set_viewport_size can resolve before the application's resize handler runs.
    page.wait_for_function("Math.abs(document.querySelector('#stage').getBoundingClientRect().width - Math.min(innerWidth/1920,innerHeight/1080)*1920) < 0.5")


def start(page, seed):
    page.evaluate('seed=>{window.qaRandom=Math.random;Math.random=()=>seed/2**31}', seed)
    page.keyboard.press('Space')
    page.evaluate('Math.random=window.qaRandom')


def finish(page):
    page.evaluate('''() => {const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});
      Object.defineProperty(e,'timeStamp',{value:performance.now()+60001}); document.activeElement.dispatchEvent(e);}''')
    page.wait_for_function("!document.querySelector('#result-screen').classList.contains('hidden') && !document.querySelector('#session-save-state').textContent.includes('保存中')")


def visible_box_inside_viewport(page, selector):
    return page.locator(selector).evaluate('''e => {const r=e.getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect();return {
      inside_stage:r.left>=s.left-0.5&&r.top>=s.top-0.5&&r.right<=s.right+0.5&&r.bottom<=s.bottom+0.5,
      inside:r.left>=-0.5&&r.top>=-0.5&&r.right<=innerWidth+0.5&&r.bottom<=innerHeight+0.5,
      width:r.width,height:r.height};}''')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    results['browser'] = browser.version
    context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce')
    context.add_init_script('''localStorage.setItem('icebreaker.dict','-1');
      window.qaLive=[]; new MutationObserver(records=>{for(const r of records){
        const t=r.target.nodeType===1?r.target:r.target.parentElement;
        if(t?.matches('[role=status]')) window.qaLive.push({id:t.id,text:[...r.addedNodes].map(n=>n.textContent).join('')});
      }}).observe(document,{childList:true,subtree:true});''')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    for _ in range(5):
        page.keyboard.press('m')
    page.keyboard.press('s')
    assert not page.locator('#settings-storage-state').is_visible()
    ax = context.new_cdp_session(page).send('Accessibility.getFullAXTree')['nodes']
    exposed = [n for n in ax if not n.get('ignored')]
    statuses = [n for n in exposed if n.get('role', {}).get('value') == 'status']
    dialogs = [n for n in exposed if n.get('role', {}).get('value') == 'dialog']
    assert len(statuses) == 1
    assert any(prop['name'] == 'live' and prop['value'].get('value') == 'polite' for prop in statuses[0].get('properties', []))
    warning = page.locator('#settings-save-state').inner_text()
    assert warning and len(dialogs) == 1 and warning in dialogs[0].get('description', {}).get('value', '')
    assert dialogs[0]['name']['value'] == '演出設定'
    buttons = [n['name']['value'] for n in exposed if n.get('role', {}).get('value') == 'button']
    assert len(buttons) == 5 and all(buttons)
    updates = Counter((event['id'], event['text']) for event in page.evaluate('qaLive') if event['text'])
    assert updates[('settings-storage-state', warning)] == 1
    assert updates[('settings-save-state', warning)] == 1
    references = page.evaluate(r'''()=>[...document.querySelectorAll('[aria-labelledby],[aria-describedby]')].flatMap(e=>
      ['aria-labelledby','aria-describedby'].flatMap(attr=>(e.getAttribute(attr)||'').split(/\s+/).filter(id=>id&&!document.getElementById(id))))''')
    assert references == []
    results['notifications'] = {'same_warning_updates_per_region': dict((key[0], count) for key, count in updates.items() if key[1] == warning),
                                'settings_exposed_statuses': len(statuses), 'settings_button_names': buttons,
                                'modal_description_contains_warning': True, 'missing_aria_references': references,
                                'speech_voices': page.evaluate('speechSynthesis.getVoices().map(v=>({name:v.name,lang:v.lang}))')}
    for width, height in SIZES:
        size(page, width, height)
        box = visible_box_inside_viewport(page, '#settings-screen .ov-box')
        assert box['inside'] and box['inside_stage'], (width, height, box)
        page.screenshot(path=str(OUT / f'quality-settings-{width}x{height}.png'))
    page.keyboard.press('Escape')
    assert page.evaluate("localStorage.getItem('icebreaker.dict')") == '-1'
    assert not errors, errors
    context.close()

    # A new storage error must appear once in the exposed modal status too.
    context = browser.new_context()
    context.add_init_script('''const original=Storage.prototype.setItem;window.qaFailWrites=false;
      Storage.prototype.setItem=function(...args){if(window.qaFailWrites)throw new DOMException('Synthetic quota','QuotaExceededError');return original.apply(this,args);};''')
    page = context.new_page()
    page.goto(URL)
    page.keyboard.press('s')
    page.evaluate('window.qaFailWrites=true')
    page.keyboard.press('1')
    page.wait_for_selector('#settings-save-state:not(.hidden)')
    assert 'このページ内でのみ' in page.locator('#settings-save-state').inner_text()
    ax = context.new_cdp_session(page).send('Accessibility.getFullAXTree')['nodes']
    assert len([n for n in ax if not n.get('ignored') and n.get('role', {}).get('value') == 'status']) == 1
    results['notifications']['new_write_failure_exposed_in_modal'] = True
    context.close()

    for dict_index in range(2):
        context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce')
        context.add_init_script("localStorage.setItem('icebreaker.sound','false')")
        page = context.new_page()
        load(page)
        target = page.evaluate('''index=>{const f=qaF,d=f.DICTIONARIES[index];
          const target=d.words.map(w=>({...w,guide:new f.TypingSession(w.reading).guide})).sort((a,b)=>b.guide.length-a.guide.length)[0];
          let seed=0;for(;seed<10000;seed++)if(new f.BenchmarkSource(d,seed).next().word.display===target.display)break;
          return {...target,dict:d.id,seed,pool:d.words.length};}''', dict_index)
        assert target['seed'] < 10000
        if dict_index:
            page.keyboard.press('d')
        start(page, target['seed'])
        assert page.locator('#word').inner_text() == target['display']
        assert page.locator('#romaji').inner_text() == target['guide']
        for width, height in SIZES:
            size(page, width, height)
            geometry = page.evaluate('''()=>{const p=document.querySelector('#input-panel').getBoundingClientRect();return ['word','romaji','reading'].map(id=>{
              const e=document.getElementById(id),r=document.createRange();r.selectNodeContents(e);const t=r.getBoundingClientRect();
              return {id,empty:!e.textContent,overflow:e.scrollWidth>e.clientWidth+1,
                inside_panel:!e.textContent||(t.left>=p.left&&t.right<=p.right&&t.top>=p.top&&t.bottom<=p.bottom),
                rendered_font_px:parseFloat(getComputedStyle(e).fontSize)*new DOMMatrix(getComputedStyle(document.querySelector('#stage')).transform).a};});}''')
            assert all(not item['overflow'] and item['inside_panel'] for item in geometry), geometry
            results['layout'].append({'dict': target['dict'], 'viewport': [width, height], 'word': target['display'],
                                      'guide': target['guide'], 'seed': target['seed'], 'text_geometry': geometry})
            page.screenshot(path=str(OUT / f'quality-long-{dict_index}-{width}x{height}.png'))
        page.keyboard.press('~')  # Exactly one intentional error at the first character.
        page.keyboard.type(target['guide'], delay=0)
        assert page.locator('#accuracy-note').inner_text() == 'ミス 1'
        finish(page)
        for _ in range(4):
            page.keyboard.press('Space')
            text = page.locator('#romaji').inner_text()
            page.keyboard.type(text, delay=0)
            finish(page)
        assert page.locator('#recent-sessions .session-row').count() == 5
        for width, height in SIZES:
            size(page, width, height)
            box = visible_box_inside_viewport(page, '#result-screen .ov-box')
            assert box['inside'] and box['inside_stage'], (width, height, box)
            page.screenshot(path=str(OUT / f'quality-result-{dict_index}-{width}x{height}.png'))
        # Rapid repeat keys on result cannot create a new round/session.
        page.evaluate('''()=>{for(let i=0;i<30;i++)document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:' ',repeat:true,bubbles:true}));}''')
        assert page.locator('#result-screen').is_visible()
        page.keyboard.press('r')
        page.wait_for_function("!document.querySelector('#report').textContent.includes('ANALYZING')")
        for width, height in SIZES:
            size(page, width, height)
            report_box = visible_box_inside_viewport(page, '#report-screen')
            assert report_box['inside'] and report_box['inside_stage']
            page.screenshot(path=str(OUT / f'quality-report-{dict_index}-{width}x{height}.png'))
        page.keyboard.press('Escape')
        assert page.locator('#result-screen').is_visible()
        context.close()

    context = browser.new_context()
    page = context.new_page()
    load(page)
    results['engine'] = page.evaluate('''()=>{
      const {Round}=qaF, make=reading=>new Round({id:'qa-en',name:'Synthetic',label:'QA',words:[{display:reading,reading}]},{},{seed:0,baselines:new Map()});
      const sentence=('The quick brown fox jumps over the lazy dog. 0123456789 ').repeat(5);
      const paragraph=make(sentence);paragraph.input('~',0,'Backquote');
      [...sentence].forEach((key,i)=>paragraph.input(key,(i+1)*10,'Synthetic'));
      if(paragraph.wordsDone!==1||paragraph.correct!==sentence.length||paragraph.misses!==1)throw Error('paragraph count mismatch');
      const round=make('abcdefgh');const times=[];
      for(let i=0;i<5000;i++){const t=performance.now();round.input('abcdefgh'[i%8],i+1,'Synthetic');times.push(performance.now()-t);}
      if(round.correct!==5000||round.misses!==0)throw Error('stress count mismatch');
      const percentiles=xs=>{xs=[...xs].sort((a,b)=>a-b);return {n:xs.length,p50_ms:xs[Math.ceil(xs.length*.5)-1],p95_ms:xs[Math.ceil(xs.length*.95)-1],max_ms:xs.at(-1)};};
      return {paragraph_characters:sentence.length,paragraph_known_misses:1,stress_keys:5000,
        first_500:percentiles(times.slice(0,500)),last_500:percentiles(times.slice(-500)),
        limit:'Isolated Round only, synthetic timestamps; no UI/paint or physical latency.'};}''')
    context.close()
    browser.close()

results['limits'] = 'Synthetic fresh contexts, CDP AX/DOM semantics only; no spoken screen-reader test. Full custom long-text UI is not implemented; paragraph test covers the engine only. Small-window readability is recorded rather than certified.'
(OUT / 'quality-audit-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({'notifications': results['notifications'], 'layout_cases': len(results['layout']), 'engine': results['engine'], 'tools': results['tools']}, ensure_ascii=False, indent=2))
