"""Bounded finishing checks: isolated QA data, real app input, no external writes.

python checks/angel_finish_check.py LOCAL_PRODUCTION_URL NEW_OUTPUT_DIRECTORY
Only installed Chromium is used; no browser downloads or physical-device claims.
"""
import json
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
const originalOpen=indexedDB.open.bind(indexedDB);
window.qaDB=sessionStorage.getItem('qa-finish-db')||'qa-finish-'+crypto.randomUUID();
sessionStorage.setItem('qa-finish-db',qaDB);
indexedDB.open=(name,...args)=>originalOpen(name==='icebreaker-stats'?qaDB:name,...args);
localStorage.setItem('icebreaker.sound','false');
'''
READ = '''async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const read=name=>new Promise((ok,no)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();let rows;r.onsuccess=()=>rows=r.result;tx.oncomplete=()=>ok(rows);tx.onabort=no;});
const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return{events,sessions};}'''
SIZES = [(320,568),(390,844),(480,800),(640,480),(800,600)]
CASES, ERRORS = [], []


def action(page, name):
    page.locator(f'#angel-main [data-action="{name}"]').click()


def guide(page):
    return page.locator('#romaji').inner_text()


def saved(page):
    page.wait_for_function("document.querySelector('#session-save-state')?.textContent.includes('このブラウザに保存')")


def audit(page):
    data = page.evaluate(READ)
    assert {x['session'] for x in data['events']} == {x['session'] for x in data['sessions']}
    for row in data['events']:
        for e in row['events']:
            assert not e['correct'] or e['key'] in e['expected']
    return data


def geometry(page):
    result=page.evaluate('''()=>{
 const panel=document.querySelector('#input-panel'),pr=panel.getBoundingClientRect();
 const nodes=[panel,document.querySelector('.av-combat-dock'),document.querySelector('.av-later'),document.querySelector('.av-next')];
 return {size:[innerWidth,innerHeight],pageOverflow:document.documentElement.scrollWidth>innerWidth,
  nodes:nodes.map(e=>{const r=e.getBoundingClientRect();return {name:e.id||e.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth};}),
  markers:['.current-sentence','.reading-position','.current-unit'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=e.closest('#word,#reading,#romaji').getBoundingClientRect();return{selector:s,visible:r.top>=c.top-1&&r.bottom<=c.bottom+1,left:r.left,right:r.right,top:r.top,bottom:r.bottom,containerTop:c.top,containerBottom:c.bottom,offsetTop:e.offsetTop,scrollTop:e.closest('#word,#reading,#romaji').scrollTop};}),
  fonts:['word','reading','romaji'].map(id=>({id,font:parseFloat(getComputedStyle(document.getElementById(id)).fontSize)}))};}''')
    assert not result['pageOverflow'], result
    assert all(n['left']>=0 and n['right']<=result['size'][0]+1 and n['scrollWidth']<=n['clientWidth']+1 for n in result['nodes']), result
    assert all(n['visible'] for n in result['markers']), result
    assert min(n['font'] for n in result['fonts'] if n['id']!='reading')>=20, result
    if result['size'][0]<=620:
        panel,_,later,_=result['nodes']
        assert later['top']>=panel['bottom'], result
    return result


with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])

    def fresh(seed=None, size=(800,600)):
        c=browser.new_context(viewport={'width':size[0],'height':size[1]},reduced_motion='reduce')
        c.add_init_script(INIT + (f'Math.random=()=>{seed}/4294967296;' if seed is not None else ''))
        page=c.new_page();page.set_default_timeout(6000)
        page.on('pageerror',lambda e:ERRORS.append(str(e)))
        page.goto(URL)
        return c,page

    # Discover all four actual paragraphs using finite deterministic seeds, no app hooks.
    seen=set()
    for seed in range(24):
        c,page=fresh(seed)
        page.locator('[data-view=training]').click();action(page,'start-passage')
        display=page.locator('#word').inner_text()
        if display in seen:
            c.close();continue
        seen.add(display); full=guide(page); layouts=[]
        for offset in range(0,len(full),12):
            # Exercise every layout at the same cursor position, then use native keys.
            for width,height in SIZES:
                page.set_viewport_size({'width':width,'height':height});page.evaluate('()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)))')
                try: layouts.append(geometry(page))
                except AssertionError:
                    page.screenshot(path=str(OUT/'failed-layout.png'),full_page=True)
                    raise
                if offset==36:
                    page.locator('#input-panel').scroll_into_view_if_needed()
                    page.screenshot(path=str(OUT/f'long-{len(seen)}-{width}x{height}.png'),full_page=True)
            page.keyboard.type(full[offset:offset+12],delay=1)
        saved(page); data=audit(page)
        assert len(data['sessions'])==1 and data['sessions'][0]['mode']=='practice'
        assert ''.join(e['key'] for e in data['events'][0]['events'])==full
        assert all(e['correct'] for e in data['events'][0]['events'])
        assert page.locator('h1').inner_text()=='長文を完了'
        CASES.append({'case':'full-original-passage-at-five-small-sizes','seed':seed,'display':display,'keys':len(full),'layouts':layouts,'passed':True})
        c.close()
        if len(seen)==4:break
    assert len(seen)==4, 'Did not cover all four original passages'

    # Journey's actual next-place action, selection reload, and last-stage boundary.
    c,page=fresh(size=(800,600));page.locator('[data-person=towa]').click();action(page,'map')
    all_keys=[]
    for place in range(7):
        assert page.locator(f'[data-place="{place}"]').get_attribute('aria-pressed')=='true'
        if place:
            before=json.dumps(audit(page),sort_keys=True,ensure_ascii=False)
            page.reload();assert page.locator('[data-person=towa]').get_attribute('aria-pressed')=='true'
            action(page,'map');assert page.locator(f'[data-place="{place}"]').get_attribute('aria-pressed')=='true'
            assert json.dumps(audit(page),sort_keys=True,ensure_ascii=False)==before
        action(page,'start-journey');keys=[]
        for i in range(5):
            next_word=page.locator('#next-word').inner_text(); later=page.locator('#following-word').inner_text()
            if i==3:assert later=='この道中の終わり'
            if i==4:assert next_word==later=='この道中の終わり'
            text=guide(page);page.keyboard.type(text,delay=1);keys.append(text)
        saved(page);all_keys.append(''.join(keys))
        assert page.locator('h1').inner_text()=='五つの封印を突破'
        assert page.locator('#angel-main [data-action=next-place]').count()==(1 if place<6 else 0)
        if place<6:action(page,'next-place')
    data=audit(page);assert len(data['sessions'])==7 and all(x['mode']=='journey' for x in data['sessions'])
    assert sorted(''.join(e['key'] for e in r['events']) for r in data['events'])==sorted(all_keys)
    action(page,'run-records');page.wait_for_selector('#report[aria-busy=false]')
    assert '白い救済都市' in page.locator('#report').inner_text()
    page.screenshot(path=str(OUT/'stage-7-records-800x600.png'),full_page=True)
    CASES.append({'case':'next-place-chain-seven-stages-selection-reload-and-last-stage-report','passed':True,'sessions':7,'native_keys':sum(map(len,all_keys))})

    # No-input map/retry, settings inside pause, explicitly saved partial, immutable older rows.
    action(page,'map');action(page,'start-journey');page.keyboard.press('Escape')
    assert not page.locator('#pause-finish').is_visible()
    page.locator('#pause-retry').click();assert page.locator('#combo').inner_text()=='0'
    page.keyboard.press('Escape');page.locator('#pause-map').click()
    assert len(audit(page)['sessions'])==7
    action(page,'start-journey');prefix=guide(page)[:8];page.keyboard.type(prefix)
    page.locator('[data-action=pause]').click()
    page.locator('#pause-resume').click();page.locator('#open-settings').click()
    assert page.locator('#settings-dialog').is_visible()
    page.keyboard.press('Escape');assert page.locator('#pause-dialog').is_visible()
    page.locator('#pause-resume').click();assert page.locator('#romaji .av-typed').inner_text()==prefix
    page.keyboard.press('Escape');page.locator('#pause-finish').click();saved(page)
    after=audit(page);assert len(after['sessions'])==8
    assert all(json.dumps(row,sort_keys=True,ensure_ascii=False) in {json.dumps(x,sort_keys=True,ensure_ascii=False) for x in after['events']} for row in data['events'])
    part=next(x for x in after['sessions'] if x['session'] not in {s['session'] for s in data['sessions']})
    assert part['mode']=='practice'
    events=next(x['events'] for x in after['events'] if x['session']==part['session'])
    assert ''.join(e['key'] for e in events)==prefix and events[0]['dt']!=events[0]['dt']
    assert page.locator('#angel-main [data-action=next-place]').count()==0
    action(page,'run-records');page.wait_for_selector('#report[aria-busy=false]')
    page.reload();assert json.dumps(audit(page),sort_keys=True,ensure_ascii=False)==json.dumps(after,sort_keys=True,ensure_ascii=False)
    CASES.append({'case':'empty-retry-map-nested-settings-preserve-input-partial-save-and-history','passed':True,'sessions':8})
    c.close()

    # Both character images load without overlap at two small widths; inspect actual captures.
    c,page=fresh()
    for width,height in [(320,568),(390,844),(800,600)]:
        page.set_viewport_size({'width':width,'height':height})
        for person in ['elna','towa']:
            page.locator(f'[data-person={person}]').click()
            page.locator(f'[data-person={person}]').scroll_into_view_if_needed()
            page.wait_for_function('[...document.images].every(i=>i.complete&&i.naturalWidth>0)')
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
            cards=page.locator('[data-person]').evaluate_all('''es=>es.map(e=>{const r=e.getBoundingClientRect(),i=e.querySelector('img'),ir=i.getBoundingClientRect(),t=e.querySelector('.av-choice-copy').getBoundingClientRect();return {x:r.x,right:r.right,top:r.top,bottom:r.bottom,imageBottom:ir.bottom,textTop:t.top,position:getComputedStyle(i).objectPosition};})''')
            assert all(x['imageBottom']<=x['textTop']+1 and x['position']=='50% 0%' for x in cards)
            assert cards[0]['right']<=cards[1]['x']+1 or cards[0]['bottom']<=cards[1]['top']+1
            page.screenshot(path=str(OUT/f'characters-{person}-{width}x{height}.png'),full_page=True)
    CASES.append({'case':'small-character-images-text-and-card-separation','passed':True})
    c.close();assert not ERRORS,ERRORS
    result={'browser':browser.version,'url':URL,'cases':CASES,'page_errors':ERRORS,'other_browsers':'Firefox and WebKit not installed; not run','vertical_scroll_required_on_small_screens':True,'synthetic_isolated_data':True,'physical_device_not_tested':True}
    (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases_passed':len(CASES),'page_errors':ERRORS,'results':str(OUT/'results.json')},ensure_ascii=False))
    browser.close()
