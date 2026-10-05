"""Original passages, readable future queue, native typing and persistent logs.

Usage: python checks/passage_queue_check.py [candidate URL] [retained baseline URL]
Snapshots are actual local browser output, with no uploads or compositing.
"""
import json
import re
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183'
BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:5187'
OUT = Path('/tmp/game-typing-qa/passage-cycle')
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(1920, 1080), (1366, 768), (1024, 768), (800, 600), (768, 1024)]
subprocess.run(['node', '--input-type=module', '-e', '''import { build } from 'vite';
await build({configFile:false,build:{lib:{entry:'checks/fixtures.ts',formats:['es'],fileName:()=> 'fixtures.js'},outDir:'/tmp/game-typing-qa/passage-cycle/fixture',emptyOutDir:false,minify:false}});'''], check=True)
FIXTURE = (OUT / 'fixture/fixtures.js').read_text()
READ = '''async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
 const read=name=>new Promise((resolve,reject)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();let rows;
 r.onsuccess=()=>rows=r.result;tx.oncomplete=()=>resolve(rows);tx.onabort=reject;});
 const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return {events,sessions};}'''
CAPTURE = '''window.qaCallbacks=[];window.qaNow=0;requestAnimationFrame=cb=>{qaCallbacks.push(cb);return qaCallbacks.length;};
window.qaStep=ms=>{qaNow||=performance.now();for(let e=0;e<ms;e+=16){qaNow+=16;qaCallbacks.splice(0).forEach(cb=>cb(qaNow));}};
let qaSeed=1234567;Math.random=()=>{qaSeed=(Math.imul(qaSeed,1664525)+1013904223)>>>0;return qaSeed/2**32;};
localStorage.setItem('icebreaker.sound','false');localStorage.setItem('icebreaker.effects.shake','0');localStorage.setItem('icebreaker.effects.flash','0');'''
rows = {'layout': [], 'queue': [], 'practice': [], 'captures': []}


def geometry(page, long):
    result = page.evaluate('''long=>{const p=document.querySelector('#input-panel').getBoundingClientRect(),m=document.querySelector('.input-meta').getBoundingClientRect();
      const scale=new DOMMatrix(getComputedStyle(document.querySelector('#stage')).transform).a;
      const ids=long?['word','reading','romaji']:['word','reading','romaji','next-word','next-guide','following-word','following-guide'];
      return {inside:p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight,
        nodes:ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,font_px:parseFloat(getComputedStyle(e).fontSize)*scale,
          within:r.left>=p.left&&r.right<=p.right+.5&&r.top>=p.top&&r.bottom<=m.top+.5,horizontal:e.scrollWidth<=e.clientWidth+1};}),
        positions:long?['.current-sentence','.reading-unit','.current-unit'].map(selector=>{
          const e=document.querySelector(selector),r=e.getBoundingClientRect(),c=e.closest('.word,.reading,.romaji').getBoundingClientRect();
          return {selector,visible:r.top>=c.top-.5&&r.bottom<=c.bottom+.5};}):[]};}''', long)
    assert result['inside'] and all(n['within'] and n['horizontal'] for n in result['nodes']), result
    assert all(p['visible'] for p in result['positions']), result
    assert next(n['font_px'] for n in result['nodes'] if n['id'] == 'reading') >= 13.99, result
    if not long:
        assert next(n['font_px'] for n in result['nodes'] if n['id'] == 'word') >= 37.6, result
        assert next(n['font_px'] for n in result['nodes'] if n['id'] == 'next-word') >= 19.24, result
    return result


def wait_save(page):
    page.wait_for_selector('#result-screen:not(.hidden)')
    page.wait_for_function("document.querySelector('#session-save-state').textContent.includes('このブラウザに保存しました')")


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    rows['browser'] = browser.version
    # Same seed/partial input/frame increments compare only the user-requested UI.
    for tag, url in [('before', BASE), ('candidate', URL)]:
        context = browser.new_context(reduced_motion='reduce'); context.add_init_script(CAPTURE)
        page = context.new_page(); page.goto(url)
        page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>1499/2**31;}')
        page.keyboard.press('Space'); page.evaluate('()=>{Math.random=qaRandom;}')
        assert page.locator('#romaji').inner_text() == 'chirimotsumorebayamatonaru'
        page.keyboard.type('chiri', delay=2); page.evaluate('qaStep(160)')
        for width, height in SIZES:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_function("Math.abs(document.querySelector('#stage').getBoundingClientRect().width-Math.min(innerWidth/1920,innerHeight/1080)*1920)<.5", polling=50)
            page.evaluate('qaStep(16)')
            if tag == 'candidate': rows['layout'].append({'kind': 'queue', 'size': [width, height], **geometry(page, False)})
            name = f'queue-{tag}-{width}x{height}.png'; page.screenshot(path=str(OUT / name)); rows['captures'].append(name)
        context.close()

    for english in [False, True]:
        context = browser.new_context(reduced_motion='reduce'); context.add_init_script("localStorage.setItem('icebreaker.sound','false');")
        page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.goto(URL)
        if english: page.keyboard.press('d')
        page.keyboard.press('Space'); observed = []
        for i in range(12):
            word = page.locator('#word').inner_text(); observed.append(word)
            preview = [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()]
            if i == 2:
                page.keyboard.press('ArrowRight')
                assert [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()] == preview
            if i == 3:
                page.keyboard.press('Escape'); page.keyboard.press('Enter')
                assert [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()] == preview
            page.keyboard.type(page.locator('#romaji').inner_text(), delay=2)
            assert page.locator('#word').inner_text() == preview[0]
            assert page.locator('#next-word').inner_text() == preview[1]
        page.evaluate('''()=>{const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});Object.defineProperty(e,'timeStamp',{value:performance.now()+65000});window.dispatchEvent(e);}''')
        wait_save(page); saved = page.evaluate(READ)
        prefix = 'en-core:' if english else 'jp-core:'
        events = saved['events'][0]['events']
        assert [e['wordId'] for e in events if e['correct'] and e['wordStart']] == [prefix+word for word in observed]
        page.keyboard.press('Space')  # Result retry reconstructs both previews.
        for _ in range(2):
            preview = [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()]
            page.keyboard.type(page.locator('#romaji').inner_text(), delay=2)
            assert page.locator('#word').inner_text() == preview[0] and page.locator('#next-word').inner_text() == preview[1]
        page.keyboard.press('Escape'); page.locator('#pause-retry').click()
        assert all(page.locator('#'+id).inner_text() for id in ['next-word','following-word'])
        page.keyboard.press('Escape'); page.keyboard.press('Escape'); page.keyboard.press('d')
        assert page.locator('#dict-name').inner_text() == ('長文練習' if english else 'English')
        assert not errors, errors
        rows['queue'].append({'dictionary': prefix[:-1], 'passed': True, 'words': 12, 'keys': len(events),
                              'previews_match_input_and_saved_word_ids': True, 'retry_pause_and_dictionary_sync': True})
        context.close()

    context = browser.new_context(reduced_motion='reduce'); context.add_init_script("localStorage.setItem('icebreaker.sound','false');")
    page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/__qa__/fixtures.js', lambda route: route.fulfill(body=FIXTURE, content_type='text/javascript'))
    page.goto(URL); page.evaluate("async()=>{window.qaF=await import('/__qa__/fixtures.js');}")
    page.locator('#start-passage').focus(); page.keyboard.press('Enter')
    assert not page.locator('.next').is_visible()
    guide = page.locator('#romaji').inner_text(); display = page.locator('#word').inner_text()
    word = page.evaluate('display=>qaF.DICTIONARIES.find(d=>d.kind==="passage").words.find(w=>w.display===display)', display)
    total = len(page.evaluate('reading=>new qaF.TypingSession(reading).guide', word['reading']))
    assert total == len(guide) and total > 100
    split = len(guide)//3; page.keyboard.type(guide[:split], delay=3)
    typed = page.locator('#romaji .typed').inner_text(); page.keyboard.type('?')
    assert page.locator('#romaji .typed').inner_text() == typed
    page.keyboard.press('Escape'); timer = page.locator('#timer').inner_text(); page.wait_for_timeout(180)
    assert page.locator('#timer').inner_text() == timer
    page.keyboard.press('Enter'); assert page.locator('#romaji .typed').inner_text() == typed
    page.keyboard.type(guide[split:2*split], delay=3)
    for width, height in SIZES:
        page.set_viewport_size({'width': width, 'height': height}); page.wait_for_timeout(50)
        result = geometry(page, True); rows['layout'].append({'kind': 'long-practice', 'size': [width,height], **result})
        name = f'passage-candidate-{width}x{height}.png'; page.screenshot(path=str(OUT / name)); rows['captures'].append(name)
    page.keyboard.type(guide[2*split:], delay=3); wait_save(page)
    assert page.locator('#r-mode').inner_text() == '長文練習（完了）・中断あり'
    first = page.evaluate(READ); logs = first['events'][0]['events']; meta = first['sessions'][0]
    assert ''.join(e['key'] for e in logs) == guide[:split]+'?'+guide[split:]
    assert sum(not e['correct'] for e in logs) == 1 and sum(bool(e.get('afterPause')) for e in logs if e['correct']) == 1
    assert meta['mode'] == 'practice' and meta['dict'] == 'jp-passages'
    assert page.evaluate("localStorage.getItem('icebreaker.pb.jp-passages')") is None
    assert all(e['wordId'] == word['id'] for e in logs)
    assert '破った層 1' in page.locator('#r-layers').inner_text()
    page.keyboard.press('Space'); partial_guide = page.locator('#romaji').inner_text()
    page.keyboard.type(partial_guide[:35], delay=3); kana = int(page.locator('#progress-text').inner_text().split('/')[0])
    page.keyboard.press('Escape'); frozen = page.locator('#timer').inner_text(); page.wait_for_timeout(200)
    assert page.locator('#timer').inner_text() == frozen
    page.locator('#pause-finish').click(); wait_save(page)
    assert '途中終了' in page.locator('#r-mode').inner_text()
    second = page.evaluate(READ); assert len(second['events']) == len(second['sessions']) == 2
    partial = next(m for m in second['sessions'] if m['session'] != meta['session'])
    partial_logs = next(r['events'] for r in second['events'] if r['session'] == partial['session'])
    assert ''.join(e['key'] for e in partial_logs) == partial_guide[:35]
    expected_kpm = page.evaluate('v=>Math.round(35*v.speed/v.kana*60)', {'speed':partial['kanaPerSec'],'kana':kana})
    assert int(re.search(r'\d+', page.locator('#r-kpm').inner_text()).group()) == expected_kpm
    page.reload(); assert json.dumps(page.evaluate(READ), sort_keys=True) == json.dumps(second, sort_keys=True)
    assert page.locator('#dict-name').inner_text() == '長文練習'
    assert not errors, errors
    rows['practice'].append({'passed': True, 'full_keys': len(logs), 'partial_keys':len(partial_logs), 'practice_only':True,
                             'one_intentional_miss':True,'pause_resume_cursor_and_duration':True,'completion_and_partial_save_reload':True,
                             'original_paragraph':word['id'],'page_errors':errors})
    context.close(); browser.close()
(OUT / 'results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
print(json.dumps({'browser':rows['browser'],'layout_cases':len(rows['layout']),'queue':rows['queue'],
                  'practice':rows['practice'],'results':str(OUT/'results.json')}, ensure_ascii=False, indent=2))
