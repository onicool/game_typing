"""Native long-practice saves across bounded cache and artificial read/write loss.

Usage: python checks/history_fallback_check.py LOCAL_URL NEW_OUTPUT
Fresh context + unique QA DB mapping; never reads or changes a real user DB.
"""
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL,out=sys.argv[1:3];OUT=Path(out)
assert urlparse(URL).hostname in ('127.0.0.1','localhost')
assert not OUT.exists(), 'Preserve earlier evidence'
OUT.mkdir(parents=True)
INIT='''const nativeOpen=indexedDB.open.bind(indexedDB);
window.qaDbName=sessionStorage.getItem('qa-db')||'qa-history-fallback-'+crypto.randomUUID();sessionStorage.setItem('qa-db',qaDbName);
indexedDB.open=(name,...args)=>nativeOpen(name==='icebreaker-stats'?qaDbName:name,...args);
window.qaReadBlocked=false;window.qaWriteBlocked=false;window.qaNativeTx=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readonly'&&qaReadBlocked)throw new DOMException('QA read denied','SecurityError');
if(args[1]==='readwrite'&&qaWriteBlocked)throw new DOMException('QA quota','QuotaExceededError');return qaNativeTx.apply(this,args);};
localStorage.setItem('icebreaker.sound','false');'''
READ='''async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
const read=n=>new Promise((ok,no)=>{const tx=qaNativeTx.call(db,n,'readonly'),r=tx.objectStore(n).getAll();let a;r.onsuccess=()=>a=r.result;tx.oncomplete=()=>ok(a);tx.onabort=no;});
const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return {events,sessions};}'''
errors=[];guides=[];reports=[]
def canonical(data):return json.dumps(data,sort_keys=True,ensure_ascii=False)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    c=b.new_context(viewport={'width':1366,'height':768});c.add_init_script(INIT)
    page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL)
    page.evaluate("document.querySelector('#start-passage').click()")
    def save(persistent):
        guide=page.evaluate("document.querySelector('#romaji').textContent")[:16];guides.append(guide)
        page.keyboard.type(guide,delay=10);page.keyboard.press('Escape')
        page.evaluate("document.querySelector('#pause-finish').click()")
        page.wait_for_function("!document.querySelector('#session-save-state').textContent.includes('保存中')")
        status=page.evaluate("document.querySelector('#session-save-state').textContent")
        assert ('このブラウザに保存しました' in status) if persistent else ('一時保持のみ' in status),status
    def report(expected,partial):
        # From a result, Escape returns to title; native R opens this dictionary.
        page.keyboard.press('Escape');page.keyboard.press('r')
        page.wait_for_function("!!document.querySelector('#report .rp-head')")
        sample=page.evaluate("document.querySelectorAll('#report .rp-counters > div')[2].textContent")
        assert ''.join(ch for ch in sample if ch.isdigit())==str(expected),(sample,expected)
        text=page.evaluate("document.querySelector('#report [role=status]')?.textContent||''")
        assert bool(text)==partial,text
        if partial:assert '直近5件' in text and '未保存分はすべて保持' in text
        reports.append({'keys':expected,'partial_notice':partial,'text':text})
        if partial:page.screenshot(path=str(OUT/f'partial-{expected}.png'))
        page.keyboard.press('Escape');page.evaluate("document.querySelector('#start-passage').click()")
    for i in range(12):
        if i:page.keyboard.press('Space')
        save(True)
    original=page.evaluate(READ);assert len(original['events'])==len(original['sessions'])==12
    original_ids={m['session'] for m in original['sessions']}
    report(12*16,False)
    # The newly ready passage has no input; save one more round before reporting.
    save(True);page.evaluate('qaReadBlocked=true');report(5*16,True)
    assert len(page.evaluate(READ)['sessions'])==13  # raw audit read bypasses the injected denial
    page.evaluate('qaReadBlocked=false;qaWriteBlocked=true')
    for i in range(8):
        if i:page.keyboard.press('Space')
        save(False)
    page.evaluate('qaReadBlocked=true');report((5+8)*16,True)
    assert len(page.evaluate(READ)['sessions'])==13
    page.evaluate('qaReadBlocked=false;qaWriteBlocked=false');save(True)
    recovered=page.evaluate(READ);assert len(recovered['events'])==len(recovered['sessions'])==22
    for name in ['events','sessions']:
        assert canonical([r for r in recovered[name] if r['session'] in original_ids])==canonical(original[name])
    ordered=sorted(recovered['events'],key=lambda r:r['endedAt'])
    assert [''.join(e['key'] for e in r['events']) for r in ordered]==guides
    assert all(e['correct'] and e['key'] in e['expected'] for r in ordered for e in r['events'])
    report(22*16,False);page.reload()
    assert canonical(page.evaluate(READ))==canonical(recovered)
    assert not errors,errors
    result={'browser':b.version,'native_saved_rounds':22,'keys':22*16,'failed_write_rounds_retained':8,
        'original12_exactly_preserved':True,'all_full_records_reload_match':True,'all_guides_match_saved_keys':True,
        'reports':reports,'records_sha256':hashlib.sha256(canonical(recovered).encode()).hexdigest(),'page_errors':errors,
        'limits':'Fresh synthetic profile / native long-practice input / injected failures; no actual quota/privacy change or user data.'}
    (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
    c.close();b.close()
