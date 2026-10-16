"""Finite combat checks: artificial fresh profiles, local preview, no app hooks.

python checks/stage1_combat_check.py LOCAL_URL NEW_OUTPUT_DIRECTORY
Virtual time verifies cues/pause; real callback durations are measured separately.
"""
import json
import math
import statistics
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from browser_support import launch_chromium

URL, destination = sys.argv[1:3]
assert urlparse(URL).hostname in ('localhost', '127.0.0.1')
OUT = Path(destination)
assert not OUT.exists(), 'Preserve earlier evidence'
OUT.mkdir(parents=True)
INIT = '''
const originalOpen=indexedDB.open.bind(indexedDB);
const dbName='qa-stage1-'+crypto.randomUUID();
indexedDB.open=(name,...args)=>originalOpen(name==='icebreaker-stats'?dbName:name,...args);
localStorage.setItem('icebreaker.sound','false'); Math.random=()=>.25;
window.qaFrameCosts=[];
const raf=requestAnimationFrame.bind(window);
window.requestAnimationFrame=fn=>raf(t=>{const start=performance.now();fn(t);qaFrameCosts.push(performance.now()-start);if(qaFrameCosts.length>300)qaFrameCosts.shift();});
'''
READ = '''async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const get=name=>new Promise((ok,no)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();let rows;r.onsuccess=()=>rows=r.result;tx.oncomplete=()=>ok(rows);tx.onabort=no;});
const [events,sessions]=await Promise.all(['events','sessions'].map(get));db.close();return{events,sessions};}'''
ERRORS, CASES = [], []

def action(page, name):
    page.locator(f'[data-action="{name}"]').click()

def guide(page):
    full = page.locator('#romaji').inner_text()
    return full[len(page.locator('#romaji .av-typed').inner_text()):]

def save_partial(page):
    page.keyboard.press('Escape'); page.locator('#pause-finish').click()
    page.wait_for_function("document.querySelector('#session-save-state')?.textContent.includes('このブラウザに保存しました')")

def geometry(page):
    value = page.evaluate('''()=>{const s=document.querySelector('.av-combat-scene').getBoundingClientRect(), a=document.querySelector('.av-obstacle-area').getBoundingClientRect();
const protectedIds=['input-panel','next-word','following-word','speed-value','accuracy-value','speech'];
const nodes=protectedIds.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,x:r.x,y:r.y,w:r.width,h:r.height,overlap:Math.max(0,Math.min(r.right,s.right)-Math.max(r.left,s.left))*Math.max(0,Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top))};});
return{nodes,sceneInsideArena:s.left>=a.left-1&&s.right<=a.right+1&&s.top>=a.top-1&&s.bottom<=a.bottom+1,overflowX:document.documentElement.scrollWidth>innerWidth};}''')
    assert value['sceneInsideArena'] and not value['overflowX'], value
    assert all(n['overlap'] == 0 for n in value['nodes']), value
    return value

def snapshot(page):
    return page.locator('.av-combat-vector').evaluate('''s=>({phase:s.dataset.phase,body:s.querySelector('.combat-body').getAttribute('transform'),arm:s.querySelector('.combat-arm').getAttribute('transform'),bolt:s.querySelector('.combat-bolt').getAttribute('transform'),guard:s.querySelector('.combat-guard').getAttribute('transform'),trajectory:+s.querySelector('.combat-trajectory').getAttribute('opacity'),guardMark:+s.querySelector('.combat-guard-mark').getAttribute('opacity'),impactMark:+s.querySelector('.combat-impact-mark').getAttribute('opacity'),contact:+s.querySelector('.combat-contact').getAttribute('opacity'),badge:+s.querySelector('.combat-hit-badge').getAttribute('opacity'),badgeText:s.querySelector('.combat-hit-badge text').textContent,nodes:s.querySelectorAll('*').length,particles:[...s.querySelectorAll('.combat-shards path')].filter(p=>+p.getAttribute('opacity')>0).length})''')

def summary(values):
    values = sorted(values)
    return {'samples':len(values),'medianMs':statistics.median(values),'p95Ms':values[int((len(values)-1)*.95)],'maxMs':max(values)}

with sync_playwright() as p:
    browser = launch_chromium(p)
    def fresh(motion=1, low=False, reduced='no-preference', size=(1366,768), virtual=False):
        c=browser.new_context(viewport={'width':size[0],'height':size[1]},reduced_motion=reduced)
        c.add_init_script(INIT+f"localStorage.setItem('icebreaker.effects.motion','{motion}');localStorage.setItem('icebreaker.graphics.low','{str(low).lower()}');")
        page=c.new_page();page.set_default_timeout(6000)
        page.on('pageerror',lambda e:ERRORS.append(str(e)))
        page.on('request',lambda r:ERRORS.append('external request') if urlparse(r.url).hostname not in ('localhost','127.0.0.1') else None)
        if virtual:
            page.clock.install(time=0)
            page.clock.pause_at(1000)
        page.goto(URL);page.locator('[data-view=journey]').click();page.locator('[data-place="0"]').click();action(page,'start-journey')
        return c,page

    c,page=fresh(virtual=True)
    initial=geometry(page);node_count=snapshot(page)['nodes']
    page.keyboard.type(guide(page)[0]);page.clock.run_for(1300)
    assert snapshot(page)['phase']=='windup'
    assert snapshot(page)['trajectory']==1
    page.screenshot(path=str(OUT/'01-windup.png'))
    page.keyboard.type(guide(page)[0]);page.clock.run_for(16)
    page.keyboard.press('Escape');before=snapshot(page)
    page.clock.run_for(6000);assert snapshot(page)==before
    action(page,'resume');page.clock.run_for(50)
    assert snapshot(page)['phase']=='windup'
    page.clock.run_for(1000);assert snapshot(page)['phase']=='approach', snapshot(page)
    assert snapshot(page)['trajectory']==1
    page.keyboard.type(guide(page)[0]);page.screenshot(path=str(OUT/'02-approach.png'))
    page.clock.run_for(400);assert snapshot(page)['phase']=='guard'
    assert snapshot(page)['guardMark']==1 and snapshot(page)['impactMark']==0
    page.keyboard.type(guide(page)[0]);page.screenshot(path=str(OUT/'03-guard.png'))
    page.clock.run_for(250)
    assert snapshot(page)['phase']=='guard', 'Contact ended too early for the cue to be read'
    page.clock.run_for(5200);assert snapshot(page)['phase']=='impact'
    assert snapshot(page)['impactMark']==1 and snapshot(page)['guardMark']==0
    assert snapshot(page)['contact']>0
    page.keyboard.type(guide(page)[0]);page.screenshot(path=str(OUT/'04-shield-impact.png'))
    page.keyboard.type(guide(page));page.clock.run_for(16)
    assert float(page.locator('.combat-beam').get_attribute('opacity'))>0
    assert snapshot(page)['badge']==1 and snapshot(page)['badgeText']=='強打'
    assert float(page.locator('.combat-hit-ring').get_attribute('opacity'))>0
    page.keyboard.type(guide(page)[0]);page.clock.run_for(100)
    assert snapshot(page)['badge']==1 and snapshot(page)['badgeText']=='強打', 'Next accepted key erased completion feedback'
    assert float(page.locator('.combat-beam').get_attribute('opacity'))==0, 'Following key feedback was not processed'
    assert '結界への衝撃' in page.locator('#seal-note').inner_text(), 'Combat caption was overwritten by the old seal'
    assert snapshot(page)['nodes']==node_count
    final_geometry=geometry(page)
    assert final_geometry['nodes'][0]==initial['nodes'][0], 'Input panel moved during effects'
    page.screenshot(path=str(OUT/'05-word-hit.png'))
    save_partial(page)
    rows=page.evaluate(READ)
    assert len(rows['sessions'])==1 and all(e['correct'] for e in rows['events'][0]['events'])
    CASES.append({'case':'four-cues-direction-shape-contact-persistent-hit-pause-fixed-ui-save','passed':True,'svgNodes':node_count})
    c.close()

    # Identical artificial event stream and timestamps, only graphics differ.
    records=[];input_costs=[]
    for motion in [1,0]:
        c,page=fresh(motion=motion)
        costs=page.evaluate('''()=>{let n=0;const base=performance.now(),costs=[];
const send=key=>{const e=new KeyboardEvent('keydown',{key,code:/[a-z]/i.test(key)?'Key'+key.toUpperCase():'Digit0',bubbles:true});Object.defineProperty(e,'timeStamp',{value:base+n++*25});const s=performance.now();window.dispatchEvent(e);costs.push(performance.now()-s);};
for(let i=0;i<5;i++){if(i===0)send('#');const s=document.querySelector('#romaji'),typed=s.querySelector('.av-typed').textContent;for(const k of s.textContent.slice(typed.length))send(k);}return costs;}''')
        page.wait_for_function("document.querySelector('#session-save-state')?.textContent.includes('このブラウザに保存しました')")
        data=page.evaluate(READ);meta=data['sessions'][0];events=data['events'][0]['events'];start=events[0]['t']
        clean=[{**{k:v for k,v in e.items() if k!='session'},'t':round(e['t']-start,6),
                'dt':round(e['dt'],6) if isinstance(e['dt'],(int,float)) and math.isfinite(e['dt']) else None} for e in events]
        records.append({'events':clean,'accuracy':meta['accuracy'],'kanaPerSec':meta['kanaPerSec'],'dict':meta['dict'],'mode':meta['mode']})
        input_costs.append({'motion':motion,**summary(costs)})
        assert len(events)==len(costs) and sum(not e['correct'] for e in events)==1
        c.close()
    (OUT/'input-comparison.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
    assert records[0]==records[1], 'See input-comparison.json for the first difference'
    CASES.append({'case':'effect-on-off-identical-results-and-all-input-log','passed':True,'keys':len(records[0]['events']),'dispatchMeasurements':input_costs})

    layouts=[]
    for size in [(320,568),(390,844),(640,480),(800,600)]:
        c,page=fresh(size=size)
        layouts.append({'size':size,'geometry':geometry(page)})
        action(page,'pause');action(page,'map');page.locator('[data-view=training]').click();action(page,'start-passage')
        layouts.append({'size':size,'long':True,'geometry':geometry(page)})
        if size==(390,844):page.screenshot(path=str(OUT/'06-long-mobile.png'),full_page=True)
        c.close()
    CASES.append({'case':'small-viewports-and-long-text-protected','passed':True,'layouts':layouts})

    for kind,kwargs in [('low',{'low':True}),('reduced',{'reduced':'reduce'}),('off',{'motion':0})]:
        c,page=fresh(virtual=True,**kwargs)
        action(page,'pause');action(page,'map');page.locator('[data-view=training]').click();action(page,'start-passage')
        page.keyboard.type(guide(page)[:80]);page.clock.run_for(16)
        state=snapshot(page)
        assert state['particles'] <= (4 if kind=='low' else 0)
        assert 'translate(0 0)' in state['body']
        assert float(page.locator('.combat-bolt').get_attribute('opacity'))==0
        page.clock.run_for(1300)
        assert snapshot(page)['phase']=='windup' and snapshot(page)['trajectory']==1
        assert float(page.locator('.combat-bolt').get_attribute('opacity'))==0
        page.clock.run_for(1400);assert snapshot(page)['phase']=='guard'
        assert snapshot(page)['guardMark']==1 and snapshot(page)['impactMark']==0
        page.screenshot(path=str(OUT/f'07-{kind}.png'))
        save_partial(page);assert len(page.evaluate(READ)['events'][0]['events'])==80
        CASES.append({'case':kind+'-no-moving-effects-and-80-keys-saved','passed':True,'snapshot':state})
        c.close()

    c,page=fresh(virtual=True)
    action(page,'pause');action(page,'map');page.locator('[data-view=training]').click();action(page,'start-passage')
    base_nodes=snapshot(page)['nodes']
    # Native progress drives a sentence boundary: no synthetic combat event.
    for _ in range(160):
        page.keyboard.type(guide(page)[0]);page.clock.run_for(16)
        if '節目' in page.locator('#seal-note').inner_text():break
    else:raise AssertionError('No sentence milestone')
    assert snapshot(page)['nodes']==base_nodes and snapshot(page)['particles']<=12
    assert snapshot(page)['badge']==1 and snapshot(page)['badgeText']=='節目'
    page.screenshot(path=str(OUT/'08-sentence-milestone.png'))
    save_partial(page);data=page.evaluate(READ)
    assert data['sessions'][0]['mode']=='practice' and all(e['correct'] for e in data['events'][0]['events'])
    CASES.append({'case':'native-passage-milestone-bounded-pool','passed':True,'keys':len(data['events'][0]['events'])})
    c.close()

    measurements=[]
    for motion in [1,0]:
        c,page=fresh(motion=motion)
        page.keyboard.type(guide(page)[0]);page.wait_for_timeout(3400)
        values=page.evaluate('qaFrameCosts.slice(-160)')
        measurements.append({'motion':motion,**summary(values)})
        c.close()
    assert not ERRORS, ERRORS
    result={'browser':browser.version,'cases':CASES,'realRafCallbackCosts':measurements,'errors':ERRORS,
            'artificialDataOnly':True,'physicalLatencyMeasured':False,'gpuFrameCostMeasured':False}
    (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'casesPassed':len(CASES),'results':str(OUT/'results.json'),'measurements':measurements}))
    browser.close()
