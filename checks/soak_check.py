"""Finite real-wall-time Chromium soak, fresh artificial data and local URL only.

Usage: python checks/soak_check.py URL OUTPUT_DIRECTORY [seconds, default 1200]
Do not edit/rebuild the served build while running. No accelerated app clock,
video capture, per-key traces or strong references to audio/image objects.
"""
import hashlib
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5191'
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/game-typing-qa/soak-cycle/baseline')
SECONDS = int(sys.argv[3]) if len(sys.argv) > 3 else 1200
assert urlparse(URL).hostname in ('127.0.0.1', 'localhost'), 'Local previews only'
assert 30 <= SECONDS <= 1800, 'Finite duration required'
assert not OUT.exists(), 'Preserve previous evidence; choose a fresh output directory'
OUT.mkdir(parents=True, exist_ok=True)
INIT = '''window.qaImages=0; window.qaImageRefs=[];
const NativeImage=Image;window.Image=class extends NativeImage{constructor(...args){super(...args);qaImages++;qaImageRefs.push(new WeakRef(this));}};
window.qaHold=false;window.qaDeferred=[];window.qaWrites=0;
const nativeTx=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){const tx=nativeTx.apply(this,args);
 if(args[1]==='readwrite'){qaWrites++;if(qaHold)Object.defineProperty(tx,'oncomplete',{set(fn){
 tx.addEventListener('complete',()=>qaDeferred.push(()=>fn.call(tx)));}});}return tx;};
localStorage.setItem('icebreaker.sound','true');
localStorage.setItem('icebreaker.volume','0.2');
window.qaVisibility=[];document.addEventListener('visibilitychange',()=>qaVisibility.push(document.visibilityState));
'''
COUNTS = '''async()=>{if(!(await indexedDB.databases()).some(d=>d.name==='icebreaker-stats'))return {events:0,sessions:0,keys:0};
const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const tx=db.transaction(['events','sessions'],'readonly');let counts={},keys=0;
for(const name of ['events','sessions']){const r=tx.objectStore(name).count();r.onsuccess=()=>counts[name]=r.result;}
const cursor=tx.objectStore('events').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){keys+=c.value.events.length;c.continue();}};
await new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=no;});db.close();return {...counts,keys};}'''
READ = '''async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const read=n=>new Promise((ok,no)=>{const tx=db.transaction(n,'readonly'),r=tx.objectStore(n).getAll();let a;r.onsuccess=()=>a=r.result;tx.oncomplete=()=>ok(a);tx.onabort=no;});
const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return {events,sessions};}'''
rows=[];activities=[];errors=[];assets=[];audio_nodes=set();contexts=set();created=destroyed=0
started=time.monotonic();typed=0;retries=0;pauses=0;complete=0;long_count=0

def elapsed(): return round(time.monotonic()-started, 2)
def emit(kind, **data):
    row={'elapsed_s':elapsed(),'kind':kind,**data};rows.append(row)
    with (OUT/'progress.jsonl').open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps(row,ensure_ascii=False),flush=True)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1366,'height':768});context.add_init_script(INIT)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda r:assets.append({'url':r.url,'status':r.status}) if '/stages/' in r.url else None)
    cdp=context.new_cdp_session(page);cdp.send('Performance.enable');cdp.send('WebAudio.enable')
    def node_created(e):
        global created
        created+=1;audio_nodes.add(e['node']['nodeId'])
    def node_destroyed(e):
        global destroyed
        destroyed+=1;audio_nodes.discard(e['nodeId'])
    cdp.on('WebAudio.audioNodeCreated',node_created);cdp.on('WebAudio.audioNodeWillBeDestroyed',node_destroyed)
    cdp.on('WebAudio.contextCreated',lambda e:contexts.add(e['context']['contextId']))
    cdp.on('WebAudio.contextWillBeDestroyed',lambda e:contexts.discard(e['contextId']))
    page.goto(URL);page.wait_for_selector('#title-screen:not(.hidden)')

    def visible(selector):return page.locator(selector).is_visible()
    def resume():
        if visible('#pause-screen'):
            page.locator('#pause-resume').click();page.locator('#input-panel').focus()
    def pause():
        global pauses
        if not visible('#pause-screen') and not visible('#result-screen') and not visible('#title-screen'):
            page.locator('#input-panel').focus();page.keyboard.press('Escape');pauses+=1
    def saved():
        page.wait_for_function("document.querySelector('#session-save-state').textContent.includes('このブラウザに保存しました')")
    def type_keys(n):
        global typed
        remaining=page.locator('#romaji').evaluate("e=>e.textContent.slice(e.querySelector('.typed')?.textContent.length||0)")
        keys=remaining[:n];page.keyboard.type(keys,delay=100);typed+=len(keys)
        return keys
    def sample(label, gc=False):
        was_play=not visible('#title-screen') and not visible('#result-screen') and not visible('#pause-screen')
        if gc:pause();page.wait_for_timeout(2200)
        disk=page.evaluate(COUNTS)
        raw=dict((m['name'],m['value']) for m in cdp.send('Performance.getMetrics')['metrics'])
        if gc:cdp.send('HeapProfiler.collectGarbage');page.wait_for_timeout(120)
        metrics=dict((m['name'],m['value']) for m in cdp.send('Performance.getMetrics')['metrics'])
        counters=cdp.send('Memory.getDOMCounters')
        images=page.evaluate('({created:qaImages,live:qaImageRefs.filter(r=>r.deref()).length})')
        emit('sample',label=label,post_gc=gc,heap_raw=raw.get('JSHeapUsedSize'),heap=metrics.get('JSHeapUsedSize'),
             heap_total=metrics.get('JSHeapTotalSize'),dom=counters,audio={'created':created,'destroyed':destroyed,'live':len(audio_nodes),'contexts':len(contexts)},
             images=images,disk=disk,typed=typed,completed=complete,retries=retries,pauses=pauses,errors=list(errors))
        if was_play:resume()

    sample('initial',True);next_sample=30;next_gc=240;cycle=2 if SECONDS<180 else 0;race_done=False;hidden_done=False
    emit('start',browser=browser.version,target_seconds=SECONDS,url=URL)
    while elapsed()<SECONDS:
        if visible('#result-screen'):
            saved();complete+=1
            page.keyboard.press('Escape')
        if visible('#title-screen'):
            if cycle%3==2:page.locator('#start-passage').click();long_count+=1
            else:
                while page.locator('#dict-name').inner_text()!='日本語':page.keyboard.press('d')
                page.keyboard.press('Space')
            page.locator('#input-panel').focus();cycle+=1
        round_start=elapsed();is_long='PRACTICE' in page.locator('#timer').inner_text()
        while not visible('#result-screen') and elapsed()<SECONDS:
            resume();type_keys(7)
            if not hidden_done and elapsed()>90:
                pause();before={'timer':page.locator('#timer').inner_text(),'typed':page.locator('#romaji .typed').inner_text()}
                # Actual Chromium lifecycle transitions, not a synthetic hidden flag.
                cdp.send('Page.setWebLifecycleState',{'state':'frozen'});page.wait_for_timeout(3000)
                cdp.send('Page.setWebLifecycleState',{'state':'active'});page.wait_for_timeout(100)
                after={'timer':page.locator('#timer').inner_text(),'typed':page.locator('#romaji .typed').inner_text()}
                assert before==after,(before,after)
                emit('lifecycle',states=page.evaluate('qaVisibility'),actual_hidden=page.evaluate('document.hidden'),frozen_s=3,
                     unchanged=before==after,note='Explicit pause before actual freeze; no physical OS suspend')
                hidden_done=True;resume()
            if is_long and not race_done and elapsed()>150:
                page.evaluate('qaHold=true');pause();page.locator('#pause-finish').click()
                page.wait_for_function('qaDeferred.length===1');page.keyboard.press('Space');page.locator('#input-panel').focus()
                new_keys=type_keys(17);pause();page.locator('#pause-finish').click()
                page.evaluate('qaDeferred.shift()()');page.wait_for_function('qaDeferred.length===1')
                assert '保存中' in page.locator('#session-save-state').inner_text()
                page.evaluate('qaHold=false;qaDeferred.shift()()');saved();complete+=1
                emit('save_race',old_completion_did_not_overwrite_new_result=True,new_keys=new_keys,queued_callbacks=page.evaluate('qaDeferred.length'))
                race_done=True;break
            if elapsed()>=next_sample:
                gc=elapsed()>=next_gc
                sample('periodic',gc);next_sample=elapsed()+30
                if gc:next_gc+=240
            if is_long and elapsed()-round_start>32 and cycle%2==0:
                pause();page.locator('#pause-finish').click();break
            if not is_long and cycle%4==0 and elapsed()-round_start>20:
                pause();page.locator('#pause-retry').click();page.locator('#input-panel').focus();retries+=1
                # One abandon/retry in this benchmark, then let the real clock finish.
                cycle+=1;round_start=elapsed()
        if visible('#result-screen'):
            saved();complete+=1;page.screenshot(path=str(OUT/'latest-result.png'));page.keyboard.press('Escape')
    pause()
    if visible('#pause-finish'):
        page.locator('#pause-finish').click();saved();complete+=1
    sample('final',True)
    page.screenshot(path=str(OUT/'final-paused.png'))
    stored=page.evaluate(READ);serialized=json.dumps(stored,sort_keys=True,ensure_ascii=False)
    assert len(stored['events'])==len(stored['sessions']) and len(stored['events'])>0
    ids={m['session'] for m in stored['sessions']};assert ids=={r['session'] for r in stored['events']}
    page.reload();assert json.dumps(page.evaluate(READ),sort_keys=True,ensure_ascii=False)==serialized
    summary={'elapsed_s':elapsed(),'target_s':SECONDS,'browser':browser.version,'typed_keys':typed,'saved_sessions':len(ids),
             'saved_keys':sum(len(r['events']) for r in stored['events']),'retry_count':retries,'pause_count':pauses,
             'passage_runs':long_count,'race_checked':race_done,'freeze_checked':hidden_done,'errors':errors,
             'assets':assets,'full_records_reload_match':True,'records_sha256':hashlib.sha256(serialized.encode()).hexdigest(),
             'measurement_limits':['One headless Chromium/software host, no physical input/audio listening/OS sleep',
                 'Freeze uses explicit pause; actual visibility-state coverage is recorded, not inferred',
                 'CDP WebAudio observes native node notifications; GC is induced only at labelled samples',
                 'Persisted session history intentionally grows; no app history is deleted']}
    assert not errors,errors
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    (OUT/'records.json').write_text(serialized)
    emit('done',**summary);context.close();browser.close()
