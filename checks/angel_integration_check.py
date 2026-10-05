"""Finite native-browser integration checks with artificial, isolated records.

python checks/angel_integration_check.py LOCAL_PRODUCTION_URL NEW_OUTPUT_DIRECTORY
No application debug exports, existing user database, or physical-input claims.
"""
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL, destination = sys.argv[1:3]
assert urlparse(URL).hostname in ('localhost', '127.0.0.1')
OUT = Path(destination)
assert not OUT.exists(), 'Preserve earlier evidence'
OUT.mkdir(parents=True)
INIT = '''
const nativeOpen=indexedDB.open.bind(indexedDB);
window.qaDB=sessionStorage.getItem('qa-angel-db')||'qa-angel-'+crypto.randomUUID();sessionStorage.setItem('qa-angel-db',qaDB);
window.qaRawOpen=()=>nativeOpen(qaDB,1);
indexedDB.open=(name,...args)=>nativeOpen(name==='icebreaker-stats'?qaDB:name,...args);
window.qaNativeTx=IDBDatabase.prototype.transaction;window.qaWriteBlocked=false;window.qaReadBlocked=false;
window.qaHold=false;window.qaDone=[];
IDBDatabase.prototype.transaction=function(...args){
 if(this.name===qaDB&&args[1]==='readwrite'&&qaWriteBlocked)throw new DOMException('QA quota','QuotaExceededError');
 if(this.name===qaDB&&args[1]==='readonly'&&qaReadBlocked)throw new DOMException('QA read denied','SecurityError');
 const tx=qaNativeTx.apply(this,args);
 if(this.name===qaDB&&args[1]==='readwrite'&&qaHold){Object.defineProperty(tx,'oncomplete',{set(fn){tx.addEventListener('complete',()=>qaDone.push(()=>fn.call(tx)));}});}
 return tx;
};
localStorage.setItem('icebreaker.sound','false');
'''
SEED = '''async()=>{const db=await new Promise((ok,no)=>{const r=qaRawOpen();r.onupgradeneeded=()=>{
 for(const name of ['events','sessions']){const s=r.result.createObjectStore(name,{keyPath:'session'});s.createIndex('dict','dict',{unique:false});}};
 r.onsuccess=()=>ok(r.result);r.onerror=no;});
const meta={session:'qa-preserved',dict:'jp-core',mode:'practice',kanaPerSec:1,accuracy:1,endedAt:1};
const record={session:meta.session,dict:meta.dict,endedAt:1,events:[{session:meta.session,dict:meta.dict,mode:meta.mode,t:0,key:'q',code:'KeyQ',correct:true,expected:['q'],prevKey:null,dt:NaN,wordStart:true,afterMiss:false,intended:null,wordId:'qa-original'}]};
await new Promise((ok,no)=>{const tx=qaNativeTx.call(db,['events','sessions'],'readwrite');tx.objectStore('events').put(record);tx.objectStore('sessions').put(meta);tx.oncomplete=ok;tx.onabort=no;});db.close();}'''
READ = '''async()=>{const db=await new Promise((ok,no)=>{const r=qaRawOpen();r.onsuccess=()=>ok(r.result);r.onerror=no;});
const read=name=>new Promise((ok,no)=>{const tx=qaNativeTx.call(db,name,'readonly'),r=tx.objectStore(name).getAll();let rows;r.onsuccess=()=>rows=r.result;tx.oncomplete=()=>ok(rows);tx.onabort=no;});
const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return{events,sessions};}'''
CASES = []
ERRORS = []


def canonical(data):
    return json.dumps(data, sort_keys=True, ensure_ascii=False)


def audit(page):
    data = page.evaluate(READ)
    assert {r['session'] for r in data['events']} == {r['session'] for r in data['sessions']}
    for record in data['events']:
        for event in record['events']:
            if event['correct']:
                assert event['key'] in event['expected'], event
    return data


def click(page, name):
    page.locator(f'#angel-main [data-action="{name}"]').click()


def map_start(page, place=0):
    page.locator('[data-view=journey]').click()
    page.locator(f'[data-place="{place}"]').click()
    click(page, 'start-journey')
    page.wait_for_selector('#romaji')


def guide(page):
    typed = page.locator('#romaji .av-typed').inner_text()
    return page.locator('#romaji').inner_text()[len(typed):]


def wait_save(page, memory=False):
    page.wait_for_selector('#session-save-state')
    page.wait_for_function("!document.querySelector('#session-save-state').textContent.includes('保存中')")
    text = page.locator('#session-save-state').inner_text()
    assert ('一時保持のみ' in text) if memory else ('このブラウザに保存しました' in text), text


def partial(page, count=12, memory=False):
    expected = guide(page)[:count]
    page.keyboard.type(expected, delay=4)
    page.keyboard.press('Escape')
    page.locator('#pause-finish').click()
    wait_save(page, memory)
    return expected


def complete_route(page, alternatives=False):
    observed = []
    for i in range(5):
        word = page.locator('#word').inner_text()
        future = [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()]
        text = guide(page)
        if alternatives:
            text = text.replace('shi', 'si').replace('chi', 'ti').replace('tsu', 'tu')
        page.keyboard.type(text, delay=2)
        observed.append({'word': word, 'keys': text, 'future': future})
        if i < 4:
            assert page.locator('#word').inner_text() == future[0]
            if i < 3:
                assert page.locator('#next-word').inner_text() == future[1]
        else:
            assert page.locator('h1').inner_text() == '五つの封印を突破'
    wait_save(page)
    return observed


def expired(page):
    page.evaluate('''()=>{const e=new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true});Object.defineProperty(e,'timeStamp',{value:performance.now()+60001});window.dispatchEvent(e);}''')
    wait_save(page)


def geometry(page, long=False):
    result = page.evaluate('''long=>{const panel=document.querySelector('#input-panel').getBoundingClientRect();
 const ids=['word','reading','romaji','next-word','next-guide','following-word','following-guide'];
 return {scrollY,overflowX:document.documentElement.scrollWidth>innerWidth,
  panelInside:panel.left>=0&&panel.right<=innerWidth+.5&&panel.top>=0&&panel.bottom<=innerHeight+.5,
  nodes:ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return{id,font:parseFloat(getComputedStyle(e).fontSize),horizontal:e.scrollWidth<=e.clientWidth+1||(id==='next-guide'&&getComputedStyle(e).overflowX==='hidden'&&getComputedStyle(e).textOverflow==='ellipsis'),withinViewport:r.left>=0&&r.right<=innerWidth+.5&&r.top>=0&&r.bottom<=innerHeight+.5};}),
  cursors:long?['.current-sentence','.reading-position','.current-unit'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),c=e.closest('#word,#reading,#romaji').getBoundingClientRect();return{selector,visible:r.top>=c.top-1&&r.bottom<=c.bottom+1};}):[]};}''', long)
    assert not result['overflowX'] and result['panelInside'], result
    assert all(n['horizontal'] and n['withinViewport'] for n in result['nodes']), result
    assert all(n['visible'] for n in result['cursors']), result
    assert next(n['font'] for n in result['nodes'] if n['id'] == 'romaji') >= 20
    return result


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])

    def fresh(init='', size=(1366, 768), motion='reduce', missing_images=False):
        c = browser.new_context(viewport={'width': size[0], 'height': size[1]}, reduced_motion=motion)
        c.add_init_script(INIT + init)
        if missing_images:
            c.route('**/angel/*.webp', lambda route: route.abort())
        page = c.new_page(); page.set_default_timeout(6000)
        page.on('pageerror', lambda e: ERRORS.append(str(e)))
        page.goto(URL); page.evaluate(SEED)
        return c, page

    # All seven places, both characters, exact source-order previews and persistence.
    c, page = fresh()
    original = audit(page)
    captures = []
    for i in range(7):
        page.locator('[data-view=characters]').click()
        who = 'elna' if i % 2 == 0 else 'towa'
        page.locator(f'[data-person={who}]').click()
        if i == 0:
            page.screenshot(path=str(OUT / '01-characters.png'))
        page.locator('[data-view=journey]').click(); page.locator(f'[data-place="{i}"]').click()
        if i == 0:
            page.screenshot(path=str(OUT / '02-map.png'))
        click(page, 'start-journey')
        page.wait_for_function("[...document.images].every(i=>i.complete)")
        layout = geometry(page)
        image = f'stage-{i + 1:02d}.png'; page.screenshot(path=str(OUT / image)); captures.append(image)
        preview = [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()]
        page.keyboard.press('?')
        assert preview == [page.locator('#next-word').inner_text(), page.locator('#following-word').inner_text()]
        keys = complete_route(page, alternatives=True)
        data = audit(page)
        # Native storage order is by UUID; select this stage by dictionary.
        meta = next(s for s in data['sessions'] if s['dict'] == ['jp-angel-heaven','jp-angel-town','jp-angel-road','jp-angel-canal','jp-angel-theatre','jp-angel-snow','jp-angel-city'][i])
        events = next(r['events'] for r in data['events'] if r['session'] == meta['session'])
        assert meta['mode'] == 'journey' and sum(not e['correct'] for e in events) == 1
        assert ''.join(e['key'] for e in events if e['correct']) == ''.join(x['keys'] for x in keys)
        CASES.append({'case': 'place', 'place': i + 1, 'character': who, 'dict': meta['dict'], 'keys': len(events), 'layout': layout, 'passed': True})
    page.screenshot(path=str(OUT / '03-route-result.png'))
    before = audit(page)
    assert canonical(next(r for r in before['events'] if r['session'] == 'qa-preserved')) == canonical(original['events'][0])
    assert next(s for s in before['sessions'] if s['session'] == 'qa-preserved') == original['sessions'][0]
    page.reload(); assert canonical(audit(page)) == canonical(before)
    assert page.locator('[data-person=elna]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-view=records]').click(); page.locator('#record-dict').select_option('jp-angel-city')
    page.wait_for_selector('#report[aria-busy=false]')
    assert str(CASES[-1]['keys']) in page.locator('.rp-counters').inner_text()
    page.screenshot(path=str(OUT / '04-records.png'))
    for value in ['jp-angel-heaven','jp-core','jp-angel-city','jp-angel-town']:
        page.locator('#record-dict').select_option(value)
    page.wait_for_selector('#report[aria-busy=false]')
    assert page.locator('#report .rp-head > div:first-child .eyebrow').inner_text()=='風車の町'
    page.locator('#record-dict').select_option('jp-angel-heaven'); page.locator('[data-view=training]').click()
    page.wait_for_timeout(100); assert page.locator('#report').count()==0
    CASES.append({'case': 'all-seven-reload-report-and-original-row-preserved', 'passed': True})
    c.close()

    # Composition, repeat, modifiers, native controls, modal focus, frozen clock.
    c, page = fresh(motion='no-preference'); map_start(page)
    initial = page.locator('#romaji').inner_text()
    page.evaluate('''()=>{for(const opts of [{key:'s',isComposing:true},{key:'Process'},{key:'Escape',keyCode:229},{key:'s',repeat:true},{key:'s',ctrlKey:true},{key:'s',metaKey:true},{key:'s',altKey:true}])window.dispatchEvent(new KeyboardEvent('keydown',{...opts,bubbles:true}));}''')
    assert page.locator('#romaji').inner_text() == initial and page.locator('#score').inner_text() == '0'
    assert page.locator('#ime-warning').is_visible()
    page.keyboard.type('sora', delay=40)
    page.keyboard.press('Escape'); frozen = page.locator('#clock').inner_text()
    page.wait_for_timeout(250); assert page.locator('#clock').inner_text() == frozen
    assert page.locator('#angel-app').evaluate('e=>e.inert')
    page.keyboard.press('Shift+Tab'); assert page.evaluate('document.activeElement.id') == 'pause-map'
    page.keyboard.press('Tab'); assert page.evaluate('document.activeElement.id') == 'pause-resume'
    page.evaluate("document.getElementById('open-settings').focus()")
    assert page.evaluate("document.activeElement.id==='pause-resume'")
    page.keyboard.press('Enter'); assert page.locator('#pause-dialog').is_hidden()
    assert page.evaluate('document.activeElement.id') == 'input-panel'
    page.locator('#input-panel [data-action=pause]').focus(); page.keyboard.press('Space')
    assert page.locator('#pause-dialog').is_visible()
    page.locator('#pause-resume').click(); page.keyboard.press('n')
    partial(page, 5)
    events = next(r['events'] for r in audit(page)['events'] if r['session'] != 'qa-preserved')
    assert len(events) == 10 and sum(e.get('afterPause', False) for e in events) == 1
    assert events[4]['afterPause'] and math.isnan(events[4]['dt'])
    CASES.append({'case': 'IME-controls-focus-pause-and-native-log-exclusion', 'passed': True, 'keys': len(events)})
    c.close()

    # Native two-store outage recovery and partial-read warning.
    c, page = fresh(); initial = audit(page); map_start(page)
    page.evaluate('qaWriteBlocked=true'); first = partial(page, memory=True)
    assert canonical(audit(page)) == canonical(initial)
    page.evaluate('qaWriteBlocked=false'); click(page, 'retry'); second = partial(page)
    recovered = audit(page)
    assert len(recovered['sessions']) == 3
    assert sorted(''.join(e['key'] for e in r['events']) for r in recovered['events'] if r['session'] != 'qa-preserved') == sorted([first, second])
    page.evaluate('qaReadBlocked=true'); click(page, 'run-records')
    page.wait_for_selector('#report[aria-busy=false]')
    assert '保存領域の一部' in page.locator('#report').inner_text()
    page.screenshot(path=str(OUT / '05-partial-storage-report.png'))
    page.evaluate('qaReadBlocked=false'); page.locator('[data-view=journey]').click(); page.locator('[data-view=records]').click()
    page.locator('#record-dict').select_option('jp-angel-heaven'); page.wait_for_selector('#report[aria-busy=false]')
    assert '保存領域の一部' not in page.locator('#report').inner_text()
    page.reload(); assert canonical(audit(page)) == canonical(recovered)
    CASES.append({'case': 'native-write-outage-read-partial-recovery-and-reload', 'passed': True})
    c.close()

    # Real native commits held only at delivery: an old result must not confirm a new one.
    c, page = fresh(); page.evaluate('qaHold=true'); map_start(page)
    first = guide(page)[:8]; page.keyboard.type(first); page.keyboard.press('Escape'); page.locator('#pause-finish').click()
    page.wait_for_function('qaDone.length===1'); assert '保存中' in page.locator('#session-save-state').inner_text()
    click(page, 'retry'); second = guide(page)[:10]; page.keyboard.type(second); page.keyboard.press('Escape'); page.locator('#pause-finish').click()
    page.evaluate('qaDone.shift()()'); page.wait_for_function('qaDone.length===1')
    assert '保存中' in page.locator('#session-save-state').inner_text()
    page.evaluate('qaDone.shift()()'); wait_save(page); data = audit(page)
    assert sorted(''.join(e['key'] for e in r['events']) for r in data['events'] if r['session'] != 'qa-preserved') == sorted([first, second])
    CASES.append({'case': 'old-native-save-completion-cannot-confirm-new-result', 'passed': True})
    c.close()

    # Long practice tracks all three cursor regions at desktop and compact sizes.
    c, page = fresh(size=(800, 600)); page.locator('[data-view=training]').click(); click(page, 'start-passage')
    full = guide(page); positions = []
    for i in range(0, len(full), 14):
        page.keyboard.type(full[i:i + 14], delay=2)
        if page.locator('#input-panel').count():
            positions.append(geometry(page, True))
            if i==28: page.screenshot(path=str(OUT/'06-long-800x600.png'))
    wait_save(page); data = audit(page); events = next(r['events'] for r in data['events'] if r['session'] != 'qa-preserved')
    assert ''.join(e['key'] for e in events) == full and all(e['correct'] for e in events)
    assert next(s for s in data['sessions'] if s['session'] != 'qa-preserved')['mode'] == 'practice'
    page.screenshot(path=str(OUT / '06-long-result.png'))
    click(page, 'retry'); before = guide(page)[:30]; page.keyboard.type(before); page.keyboard.press('Escape'); page.locator('#pause-finish').click(); wait_save(page)
    data = audit(page); assert len(data['sessions']) == 3
    CASES.append({'case': 'long-complete-partial-and-visible-cursor-tracking', 'passed': True, 'keys': len(full), 'samples': len(positions)})
    c.close()

    # English and JP benchmark/protected PB; deadline advanced synthetically.
    c, page = fresh()
    for index in ['0', '1']:
        page.locator('[data-view=training]').click(); page.locator('#training-dict').select_option(index); click(page, 'start-training')
        for _ in range(4): page.keyboard.type(guide(page), delay=5)
        expired(page)
    benchmark_rows = audit(page)
    assert sum(s['mode'] == 'benchmark' for s in benchmark_rows['sessions']) == 2
    best = page.evaluate("localStorage.getItem('icebreaker.pb.en-core')")
    click(page, 'retry'); page.keyboard.type(guide(page)[:3], delay=10); page.keyboard.press('Escape'); page.locator('#pause-resume').click(); page.keyboard.type(guide(page)[:3], delay=10); expired(page)
    assert page.evaluate("localStorage.getItem('icebreaker.pb.en-core')") == best
    assert sum(s['mode'] == 'practice' for s in audit(page)['sessions']) == 2
    CASES.append({'case': 'JP-English-benchmark-and-interrupted-PB-exclusion', 'passed': True, 'synthetic_deadline': True})
    c.close()

    # A deliberately slow synthetic transition makes the report-to-patch route
    # deterministic; only the following patch's keys are native browser input.
    c, page = fresh()
    page.evaluate('''async()=>{const db=await new Promise((ok,no)=>{const r=qaRawOpen();r.onsuccess=()=>ok(r.result);r.onerror=no;});
     const meta={session:'qa-training',dict:'jp-core',mode:'benchmark',kanaPerSec:1,accuracy:1,endedAt:2};let t=0;
     const events=[...('ka'.repeat(60))].map((key,i)=>{const dt=i%2?600:25;t+=dt;return{session:meta.session,dict:meta.dict,mode:meta.mode,t,key,code:'',correct:true,expected:[key],prevKey:i?i%2?'k':'a':null,dt:i?dt:NaN,wordStart:i===0,afterMiss:false,afterPause:false,intended:null,wordId:'qa-only-corpus'};});
     await new Promise((ok,no)=>{const tx=qaNativeTx.call(db,['events','sessions'],'readwrite');tx.objectStore('events').put({session:meta.session,dict:meta.dict,endedAt:meta.endedAt,events});tx.objectStore('sessions').put(meta);tx.oncomplete=ok;tx.onabort=no;});db.close();}''')
    page.locator('[data-view=records]').click(); page.wait_for_selector('#report[aria-busy=false]')
    page.locator('[data-patch="0"]').click(); native=[]
    assert '弱点練習' in page.locator('#input-label').inner_text()
    for _ in range(4):
        text=guide(page); native.append(text); page.keyboard.type(text,delay=3)
    expired(page); data=audit(page)
    patch_meta=next(s for s in data['sessions'] if s['mode']=='patch')
    events=next(r['events'] for r in data['events'] if r['session']==patch_meta['session'])
    assert ''.join(e['key'] for e in events)==''.join(native)
    assert page.evaluate("localStorage.getItem('icebreaker.pb.jp-core')") is None
    CASES.append({'case':'report-native-targeted-patch-and-PB-exclusion','passed':True,'synthetic_diagnostic_fixture':True,'native_patch_keys':len(events)})
    c.close()

    bad={'icebreaker.angel.character':'"unknown"','icebreaker.angel.place':'999','icebreaker.prefs':'null','icebreaker.effects.motion':'[]','icebreaker.sound':'"false"','icebreaker.volume':'2'}
    c, page = fresh(init='for(const [k,v] of Object.entries('+json.dumps(bad)+'))localStorage.setItem(k,v);')
    page.locator('#open-settings').click(); assert '元の保存内容は保持' in page.locator('#settings-save-state').inner_text()
    page.locator('[data-action=motion]').click(); page.locator('#sound-volume').focus(); page.keyboard.press('ArrowLeft')
    assert page.locator('#sound-volume').input_value()=='0.95'
    page.keyboard.press('Escape'); map_start(page); partial(page)
    preserved=page.evaluate('(keys)=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)]))',list(bad))
    assert preserved==bad; page.reload()
    assert page.evaluate('(keys)=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)]))',list(bad))==bad
    CASES.append({'case':'malformed-settings-original-bytes-and-native-slider-preserved','passed':True})
    c.close()

    # Five desktop sizes, full words visible, no-motion and missing optional media.
    c, page = fresh(); map_start(page)
    layouts = []
    for width, height in [(1920,1080),(1366,768),(1024,768),(800,600),(768,1024)]:
        page.set_viewport_size({'width':width,'height':height}); page.wait_for_timeout(60)
        layouts.append({'size':[width,height],**geometry(page)})
        page.screenshot(path=str(OUT / f'layout-{width}x{height}.png'))
    page.keyboard.type(guide(page)); assert page.evaluate("document.querySelector('#angel-app').classList.contains('no-motion')")
    assert page.locator('.av-landscape').evaluate('e=>getComputedStyle(e).transform') == 'none'
    CASES.append({'case':'five-desktop-sizes-and-reduced-motion','passed':True,'layouts':layouts})
    c.close()
    c, page = fresh(init="localStorage.setItem('icebreaker.graphics.low','true');window.AudioContext=class{constructor(){throw new Error('QA unavailable');}};localStorage.setItem('icebreaker.sound','true');",motion='no-preference',missing_images=True)
    map_start(page); page.screenshot(path=str(OUT/'07-no-assets-battle.png')); partial(page); page.screenshot(path=str(OUT / '07-no-assets-result.png'))
    assert len(audit(page)['sessions']) == 2
    page.locator('#open-settings').click(); assert '利用不可' in page.locator('#setting-sound').inner_text()
    assert page.locator('#setting-graphics').inner_text() == '低負荷'
    CASES.append({'case':'low-graphics-all-assets-unavailable-audio-failure-save','passed':True})
    c.close()

    assert not ERRORS, ERRORS
    receipt={'browser':browser.version,'url':URL,'cases':CASES,'page_errors':ERRORS,'captures':captures,'synthetic_storage_only':True,'real_60_second_run_not_performed':True}
    (OUT/'results.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases_passed':len(CASES),'browser':browser.version,'page_errors':ERRORS,'results':str(OUT/'results.json')},ensure_ascii=False))
    browser.close()
