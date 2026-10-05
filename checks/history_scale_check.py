"""Bounded history/committed-cache audit with an isolated artificial database.

Usage: python checks/history_scale_check.py LOCAL_URL NEW_OUTPUT STORAGE_FIXTURE
Fixture: build checks/storage-fixtures.ts with existing Vite outside the repo.
No production exports/hooks, existing profiles, deleteDatabase, video or traces.
"""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL, out, fixture=sys.argv[1:4];OUT=Path(out);FIXTURE=Path(fixture).read_text()
assert urlparse(URL).hostname in ('127.0.0.1','localhost')
assert not OUT.exists(), 'Use a fresh output directory'
OUT.mkdir(parents=True)
INIT='''const nativeOpen=indexedDB.open.bind(indexedDB);
window.qaDbName=sessionStorage.getItem('qa-history-db')||'qa-history-scale-'+crypto.randomUUID();
sessionStorage.setItem('qa-history-db',qaDbName);window.qaWrites=0;
indexedDB.open=(name,...args)=>{if(name==='icebreaker-stats')name=qaDbName;return nativeOpen(name,...args);};
localStorage.setItem('icebreaker.sound','false');localStorage.setItem('icebreaker.dict','0');
'''
FACTORY='''()=>{window.qaMeta=i=>({session:'qa-'+String(i).padStart(8,'0'),dict:'jp-core',mode:'benchmark',kanaPerSec:3,accuracy:1,endedAt:1600000000000+i*60000});
window.qaEvents=meta=>Array.from({length:300},(_,j)=>{const keys='shinnkannsen',key=keys[j%keys.length];return {session:meta.session,dict:meta.dict,mode:meta.mode,
t:j*200,key,code:'Key'+key.toUpperCase(),correct:true,expected:[key],prevKey:j%11===0?null:keys[(j-1)%keys.length],dt:j===0?NaN:200,
wordStart:j%11===0,afterMiss:false,afterPause:false,intended:null,wordId:'qa-artificial-word'};});}'''
SEED='''async n=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);
r.onupgradeneeded=()=>{for(const name of ['events','sessions']){const s=r.result.createObjectStore(name,{keyPath:'session'});s.createIndex('dict','dict',{unique:false});}};
r.onsuccess=()=>ok(r.result);r.onerror=no;});
for(let start=0;start<n;start+=25)await new Promise((ok,no)=>{const tx=db.transaction(['events','sessions'],'readwrite');
for(let i=start;i<Math.min(start+25,n);i++){const meta=qaMeta(i);tx.objectStore('sessions').put(meta);tx.objectStore('events').put({session:meta.session,dict:meta.dict,endedAt:meta.endedAt,events:qaEvents(meta)});}
tx.oncomplete=ok;tx.onabort=no;});db.close();}'''
COUNTS='''async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const tx=db.transaction(['events','sessions'],'readonly'),result={};for(const name of ['events','sessions']){const r=tx.objectStore(name).count();r.onsuccess=()=>result[name]=r.result;}
await new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=no;});db.close();return result;}'''
report_rows=[];cache_rows=[];errors=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    def setup(audit=False):
        c=b.new_context(viewport={'width':1366,'height':768});c.add_init_script(INIT)
        page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        if audit:page.route('**/__qa__/storage.js',lambda r:r.fulfill(body=FIXTURE,content_type='text/javascript'))
        page.goto(URL);page.wait_for_function("!document.querySelector('#title-screen').classList.contains('hidden')")
        page.evaluate(FACTORY)
        if audit:page.evaluate("async()=>{window.qaStore=await import('/__qa__/storage.js')}")
        d=c.new_cdp_session(page);d.send('Performance.enable')
        return c,page,d
    def heap(page,d):
        d.send('HeapProfiler.collectGarbage');page.wait_for_timeout(120)
        metrics={m['name']:m['value'] for m in d.send('Performance.getMetrics')['metrics']}
        return {'heap':metrics['JSHeapUsedSize'],**d.send('Memory.getDOMCounters')}
    for n in [20,200,1000]:
        c,page,d=setup();page.evaluate(SEED,n);timings=[]
        baseline=heap(page,d)
        for i in range(3):
            start=page.evaluate('performance.now()');page.keyboard.press('r')
            page.wait_for_function("!!document.querySelector('#report .rp-head')")
            shown=page.evaluate("document.querySelectorAll('#report .rp-counters > div')[2].textContent")
            assert ''.join(ch for ch in shown if ch.isdigit())==str(n*300),(shown,n)
            timings.append(page.evaluate('performance.now()')-start)
            page.keyboard.press('Escape')
        stable=heap(page,d);assert page.evaluate(COUNTS)=={'events':n,'sessions':n}
        report_rows.append({'sessions':n,'keys':n*300,'open_ms':timings,'before_gc':baseline,'after_three_opens_gc':stable})
        print(json.dumps({'report':report_rows[-1]}),flush=True);c.close()
    c,page,d=setup(True);cache_rows.append({'saved':0,**heap(page,d)})
    prior=0
    for n in [20,200,1000]:
        measured=page.evaluate('''async bounds=>{const start=performance.now();for(let i=bounds[0];i<bounds[1];i++){
const meta=qaMeta(i);if(await qaStore.saveSession(qaEvents(meta),meta)!=='persistent')throw new Error('artificial write did not commit');}
return {elapsed_ms:performance.now()-start,events:await qaStore.loadEvents('jp-core').then(e=>e.length),sessions:await qaStore.loadSessions('jp-core').then(e=>e.length)};}''',[prior,n])
        assert measured['events']==n*300 and measured['sessions']==n
        assert page.evaluate(COUNTS)=={'events':n,'sessions':n}
        cache_rows.append({'saved':n,**measured,**heap(page,d)});prior=n
        print(json.dumps({'committed_cache':cache_rows[-1]}),flush=True)
    # Keep the isolated name across this reload. The app's page-memory cache clears,
    # while exactly the same native database and records remain accessible.
    page.reload();page.wait_for_function("!document.querySelector('#title-screen').classList.contains('hidden')")
    page.evaluate("async()=>{window.qaStore=await import('/__qa__/storage.js')}")
    after_reload=heap(page,d)
    assert page.evaluate(COUNTS)=={'events':1000,'sessions':1000}
    loaded=page.evaluate("async()=>({events:(await qaStore.loadEvents('jp-core')).length,sessions:(await qaStore.loadSessions('jp-core')).length})")
    assert loaded=={'events':300000,'sessions':1000}
    after_read=heap(page,d)
    assert not errors,errors
    result={'browser':b.version,'report':report_rows,'committed_cache':cache_rows,'reload_heap':after_reload,
            'reload_read_heap':after_read,'reload_all_records_match_counts':True,'errors':errors,
            'limits':['Artificial 300-key sessions: accelerated commits, not hours of actual play','1000 sessions represents accumulated history; one headless shared software host',
                      'Cold/warm UI automation times include IO/rendering; no device/paint latency','Fresh incognito contexts and a unique remapped QA DB; real user DB never opened']}
    (OUT/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));c.close();b.close()
