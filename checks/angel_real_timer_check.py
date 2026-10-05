"""One real-clock 60-second benchmark in an isolated, artificial Chromium DB."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL, destination = sys.argv[1:3]
assert urlparse(URL).hostname in ('localhost', '127.0.0.1')
OUT = Path(destination)
assert not OUT.exists(), 'Preserve previous evidence'
OUT.mkdir(parents=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1366,'height':768},reduced_motion='reduce')
    context.add_init_script('''localStorage.setItem('icebreaker.sound','false');
      const open=indexedDB.open.bind(indexedDB),name='qa-angel-real-timer-'+crypto.randomUUID();
      indexedDB.open=(id,...args)=>open(id==='icebreaker-stats'?name:id,...args);
      window.qaFirstKey=null;window.qaResultAt=null;
      window.addEventListener('keydown',e=>{if(e.isTrusted&&e.key.length===1&&e.target.id==='input-panel')qaFirstKey??=e.timeStamp;},true);
      new MutationObserver(()=>{if(document.getElementById('session-save-state'))qaResultAt??=performance.now();}).observe(document,{childList:true,subtree:true});''')
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.locator('[data-view=training]').click();page.locator('#training-dict').select_option('0')
    page.locator('[data-action=start-training]').click();keys=[]
    for _ in range(4):
        text=page.locator('#romaji').inner_text();keys.extend(text);page.keyboard.type(text,delay=5)
    # Normal browser clock/rAF continue. The shell yields while this runs.
    page.wait_for_function('qaResultAt!==null',timeout=65000)
    page.wait_for_function("document.querySelector('#session-save-state').textContent.includes('このブラウザに保存しました')")
    duration=page.evaluate('qaResultAt-qaFirstKey')
    assert 60000 <= duration < 62000,duration
    rows=page.evaluate('''async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);r.onerror=no;});
     const read=n=>new Promise((ok,no)=>{const tx=db.transaction(n,'readonly'),r=tx.objectStore(n).getAll();let a;r.onsuccess=()=>a=r.result;tx.oncomplete=()=>ok(a);tx.onabort=no;});
     const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return{events,sessions};}''')
    assert len(rows['events'])==len(rows['sessions'])==1
    events=rows['events'][0]['events'];meta=rows['sessions'][0]
    assert ''.join(e['key'] for e in events)==''.join(keys) and all(e['correct'] for e in events)
    assert meta['mode']=='benchmark' and meta['accuracy']==1
    page.screenshot(path=str(OUT/'real-60-second-result.png'))
    assert not errors,errors
    result={'passed':True,'browser':browser.version,'real_elapsed_to_result_ms':duration,'native_keys':len(keys),'mode':meta['mode'],'page_errors':errors,'physical_device_latency_not_measured':True}
    (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False));context.close();browser.close()
