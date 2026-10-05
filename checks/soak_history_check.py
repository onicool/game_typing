"""Repeat report opening with only the artificial records from soak_check.py.

Usage: python checks/soak_history_check.py LOCAL_URL SOAK_OUTPUT NEW_OUTPUT
Fresh browser context. This does not use any existing profile or deployed data.
"""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

url, source, output = sys.argv[1:4]
assert urlparse(url).hostname in ('localhost', '127.0.0.1')
source, output = Path(source), Path(output)
assert not output.exists(), 'Preserve previous evidence; choose a fresh output'
assert json.loads((source/'summary.json').read_text())['full_records_reload_match']
records=json.loads((source/'records.json').read_text())
output.mkdir(parents=True)
snapshots=[];errors=[];durations=[]
seed='''async data=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);
r.onupgradeneeded=()=>{for(const n of ['events','sessions']){const s=r.result.createObjectStore(n,{keyPath:'session'});s.createIndex('dict','dict',{unique:false});}};
r.onsuccess=()=>ok(r.result);r.onerror=no;});
await new Promise((ok,no)=>{const tx=db.transaction(['events','sessions'],'readwrite');
for(const n of ['events','sessions'])for(const row of data[n])tx.objectStore(n).put(row);tx.oncomplete=ok;tx.onabort=no;});db.close();}'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    c=browser.new_context(viewport={'width':1366,'height':768})
    c.add_init_script("localStorage.setItem('icebreaker.sound','false');localStorage.setItem('icebreaker.dict','0');")
    page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url);page.evaluate(seed,records);cdp=c.new_cdp_session(page);cdp.send('Performance.enable')
    def sample(label):
        cdp.send('HeapProfiler.collectGarbage');page.wait_for_timeout(100)
        m={r['name']:r['value'] for r in cdp.send('Performance.getMetrics')['metrics']}
        snapshots.append({'label':label,'heap':m['JSHeapUsedSize'],**cdp.send('Memory.getDOMCounters')})
    expected=sum(len(r['events']) for r in records['events'] if r['dict']=='jp-core')
    for i in range(21):
        start=page.evaluate('performance.now()');page.keyboard.press('r')
        # Keep memory comparisons free of remote element handles and selector
        # helper caches. Initial selector-based probes retained 37 nodes/open;
        # the equivalent boolean/evaluated checks do not pin removed subtrees.
        page.wait_for_function("!!document.querySelector('#report .rp-head')")
        shown=page.evaluate("document.querySelectorAll('#report .rp-counters > div')[2].textContent")
        assert str(expected)==''.join(ch for ch in shown if ch.isdigit()), (shown,expected)
        durations.append(page.evaluate('performance.now()')-start)
        page.keyboard.press('Escape');assert page.evaluate("!document.querySelector('#title-screen').classList.contains('hidden')")
        if i in [0,10,20]:sample(f'after {i+1} opens')
    page.keyboard.press('r');page.wait_for_function("!!document.querySelector('#report .rp-head')");page.screenshot(path=str(output/'report.png'))
    assert not errors,errors
    result={'browser':browser.version,'history_sessions':len(records['sessions']),'jp_report_keys':expected,
        'open_close_cycles':21,'post_gc_samples':snapshots,'open_ms':durations,'page_errors':errors,
        'limits':'One artificial history; elapsed UI automation includes IO/driver/rendering. No latency budget or massive-history claim.'}
    (output/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
    c.close();browser.close()
