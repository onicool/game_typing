"""Local artificial outages against real Chromium IndexedDB, never user data.

App checks use the production preview. A separate audit-only module verifies
same-ID retries and race ordering against native transactions, without app hooks.
"""
import json
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183'
OUT = Path('/tmp/game-typing-qa/idb-recovery-cycle')
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', '''
import { build } from 'vite';
await build({configFile:false,build:{lib:{entry:'checks/storage-fixtures.ts',formats:['es'],fileName:()=> 'storage.js'},outDir:'/tmp/game-typing-qa/idb-recovery-cycle/fixture',emptyOutDir:false,minify:false}});
'''], check=True)
FIXTURE = (OUT / 'fixture/storage.js').read_text()
INIT = '''window.qaNativeIDB=indexedDB;window.qaRawOpen=indexedDB.open.bind(indexedDB);
window.qaFault=null;window.qaOpenCalls=0;window.qaConnections=[];window.qaAbandoned=[];
window.qaRawTx=IDBDatabase.prototype.transaction;window.qaAbortNext=false;
window.qaHold=false;window.qaDone=[];window.qaWrites=0;
localStorage.setItem('icebreaker.sound','false');
indexedDB.open=(...args)=>{qaOpenCalls++;
 if(qaFault==='throw')throw new DOMException('QA temporary denial','SecurityError');
 if(qaFault==='error'||qaFault==='blocked'){
  const req={error:new DOMException('QA temporary outage','UnknownError')};qaAbandoned.push(req);
  const kind=qaFault;queueMicrotask(()=>req[kind==='error'?'onerror':'onblocked']?.(new Event(kind)));
  return req;
 }
 const req=qaRawOpen(...args);req.addEventListener('success',()=>qaConnections.push(req.result));return req;
};
IDBDatabase.prototype.transaction=function(...args){const tx=qaRawTx.apply(this,args);
 if(args[1]==='readwrite'){qaWrites++;
  if(qaHold){for(const type of ['complete','abort','error'])Object.defineProperty(tx,'on'+type,{set(handler){
   tx.addEventListener(type,()=>{let run=qaDone.find(run=>run.tx===tx);
    if(!run){const callbacks=[];run=()=>callbacks.splice(0).forEach(fn=>fn());
     run.tx=tx;run.callbacks=callbacks;qaDone.push(run);}
    run.callbacks.push(()=>handler.call(tx));});}});}
  if(qaAbortNext){qaAbortNext=false;queueMicrotask(()=>tx.abort());}
}return tx;
};
window.qaAwaitDone=()=>new Promise((resolve,reject)=>{const limit=performance.now()+5000;
 const poll=()=>qaDone.length?resolve():performance.now()>limit?reject(new Error('QA completion timeout')):setTimeout(poll,0);poll();});
'''
SEED = '''async()=>{
 const db=await new Promise((resolve,reject)=>{const r=qaRawOpen('icebreaker-stats',1);
  r.onupgradeneeded=()=>{for(const name of ['events','sessions']){
   const s=r.result.createObjectStore(name,{keyPath:'session'});s.createIndex('dict','dict',{unique:false});}};
  r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
 const meta={session:'qa-preserved',dict:'jp-core',mode:'practice',kanaPerSec:1,accuracy:1,endedAt:1};
 const event={...meta,t:0,key:'q',code:'KeyQ',correct:true,expected:['q'],prevKey:null,dt:0,
  wordStart:true,afterMiss:false,intended:null,wordId:'qa-original',afterPause:false};
 const record={session:meta.session,dict:meta.dict,endedAt:meta.endedAt,events:[event]};
 await new Promise((resolve,reject)=>{const tx=qaRawTx.call(db,['events','sessions'],'readwrite');
  tx.objectStore('events').put(record);tx.objectStore('sessions').put(meta);tx.oncomplete=resolve;tx.onabort=reject;});
 db.close();window.qaOriginal={meta,record};
}'''
READ = '''async()=>{
 const db=await new Promise((resolve,reject)=>{const r=qaRawOpen('icebreaker-stats',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
 const read=name=>new Promise((resolve,reject)=>{const tx=qaRawTx.call(db,name,'readonly'),r=tx.objectStore(name).getAll();
  let rows;r.onsuccess=()=>rows=r.result;tx.oncomplete=()=>resolve(rows);tx.onabort=reject;});
 const [events,sessions]=await Promise.all(['events','sessions'].map(read));db.close();return {events,sessions};
}'''


def start(page):
    page.keyboard.press('Space')
    page.wait_for_selector('#ready-help:not(.hidden)')
    guide = page.locator('#romaji').inner_text()
    page.keyboard.type(guide, delay=3)
    assert page.locator('#accuracy-note').inner_text() == 'ミス 0'
    return guide


def finish(page):
    page.evaluate('''()=>{const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});
      Object.defineProperty(e,'timeStamp',{value:performance.now()+60001});window.dispatchEvent(e);}''')
    page.wait_for_selector('#result-screen:not(.hidden)')


def wait_saved(page, persistent):
    page.wait_for_function("!document.querySelector('#session-save-state').textContent.includes('保存中')")
    status = page.locator('#session-save-state').inner_text()
    assert ('このブラウザに保存しました' in status) if persistent else ('一時保持のみ' in status), status
    return status


def verify_disk(saved, original, guides):
    assert next(x for x in saved['sessions'] if x['session'] == 'qa-preserved') == original['meta']
    assert next(x for x in saved['events'] if x['session'] == 'qa-preserved') == original['record']
    assert len(saved['sessions']) == len(saved['events']) == len(guides) + 1
    records = sorted((x for x in saved['events'] if x['session'] != 'qa-preserved'), key=lambda r: r['endedAt'])
    assert [''.join(e['key'] for e in r['events']) for r in records] == guides
    assert all(e['correct'] for r in records for e in r['events'])


def verify_reload(page, saved):
    page.reload()
    # Native key logs use NaN for the first-key interval. Python's NaN != NaN;
    # canonical serialization compares every stored field and that sentinel.
    assert json.dumps(page.evaluate(READ), sort_keys=True) == json.dumps(saved, sort_keys=True)


rows = {'app': [], 'native_store': []}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    rows['browser'] = browser.version
    for case in ['throw', 'missing', 'error', 'blocked-late-success', 'transaction-abort',
                 'closed-connection', 'unexpected-close', 'versionchange', 'repeated-outage']:
        context = browser.new_context(reduced_motion='reduce')
        context.add_init_script(INIT)
        page = context.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL); page.evaluate(SEED); original = page.evaluate('qaOriginal')
        if case in ['closed-connection', 'unexpected-close', 'versionchange']:
            page.keyboard.press('r')
            page.wait_for_function("!document.querySelector('#report').textContent.includes('ANALYZING')")
            page.keyboard.press('Escape')
            page.evaluate('''kind=>{const db=qaConnections[0];if(kind==='versionchange')db.dispatchEvent(new Event('versionchange'));
              else{db.close();if(kind==='unexpected-close')db.dispatchEvent(new Event('close'));}}''', case)
        else:
            page.evaluate('''kind=>{if(kind==='missing')Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});
              else if(kind==='transaction-abort')qaAbortNext=true;
              else qaFault=kind==='blocked-late-success'?'blocked':kind==='repeated-outage'?'throw':kind;}''', case)
        guides = [start(page)]; finish(page)
        first_persistent = case in ['unexpected-close', 'versionchange']
        first_status = wait_saved(page, first_persistent)
        assert len(page.evaluate(READ)['sessions']) == (2 if first_persistent else 1), case
        if case == 'repeated-outage':
            guides.append(start(page)); finish(page); wait_saved(page, False)
            assert len(page.evaluate(READ)['sessions']) == 1
        page.evaluate("()=>{qaFault=null;Object.defineProperty(window,'indexedDB',{configurable:true,value:qaNativeIDB});}")
        guides.append(start(page)); finish(page); recovered_status = wait_saved(page, True)
        page.wait_for_function('count=>document.querySelectorAll("#recent-sessions .session-row").length===count', arg=len(guides)+1)
        saved = page.evaluate(READ); verify_disk(saved, original, guides)
        if case == 'blocked-late-success':
            calls = page.evaluate('qaOpenCalls')
            page.evaluate('''async()=>{for(const req of qaAbandoned){req.result=await new Promise(resolve=>{
              const r=qaRawOpen('icebreaker-stats',1);r.onsuccess=()=>resolve(r.result);});req.onsuccess();}}''')
            guides.append(start(page)); finish(page); wait_saved(page, True)
            assert page.evaluate('qaOpenCalls') == calls, 'Old abandoned success invalidated the healthy connection'
            saved = page.evaluate(READ); verify_disk(saved, original, guides)
        verify_reload(page, saved)
        page.keyboard.press('r')
        page.wait_for_function("!document.querySelector('#report').textContent.includes('ANALYZING')")
        assert not errors, (case, errors)
        rows['app'].append({'case': case, 'passed': True, 'first_status': first_status,
                            'recovered_status': recovered_status, 'disk_sessions': len(saved['sessions']),
                            'original_unchanged': True, 'exact_typed_keys_and_reload': True, 'page_errors': errors})
        context.close()

    for aborted in [False, True]:
        context = browser.new_context(reduced_motion='reduce'); context.add_init_script(INIT)
        page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL); page.evaluate(SEED); original = page.evaluate('qaOriginal')
        page.evaluate('abort=>{qaHold=true;qaAbortNext=abort;}', aborted)
        guides = [start(page)]; finish(page); page.wait_for_function('qaDone.length===1')
        assert '保存中' in page.locator('#session-save-state').inner_text(), ('aborted', aborted)
        guides.append(start(page)); finish(page)
        current_chain = page.locator('#r-chain').inner_text()
        page.evaluate('()=>{qaDone.shift()();}'); page.wait_for_function('qaDone.length===1')
        assert '保存中' in page.locator('#session-save-state').inner_text(), 'Old completion changed the new result status'
        assert page.locator('#r-chain').inner_text() == current_chain
        page.evaluate('()=>{qaDone.shift()();}'); wait_saved(page, True)
        saved = page.evaluate(READ); verify_disk(saved, original, guides)
        verify_reload(page, saved)
        assert not errors, errors
        rows['app'].append({'case': 'delayed-abort-after-retry' if aborted else 'delayed-complete-after-retry',
                            'passed': True, 'disk_sessions': 3, 'old_completion_did_not_change_current_result': True,
                            'original_unchanged': True, 'exact_typed_keys_and_reload': True, 'page_errors': errors})
        context.close()

    # Isolated source module: true native put/abort/complete ordering and retry
    # identity, which normal gameplay cannot exercise with its unique session IDs.
    context = browser.new_context(); context.add_init_script(INIT)
    page = context.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/__qa__/storage.js', lambda route: route.fulfill(body=FIXTURE, content_type='text/javascript'))
    page.route('**/__qa__/blank', lambda route: route.fulfill(body='<html></html>', content_type='text/html'))
    page.goto(URL+'/__qa__/blank'); page.evaluate(SEED)
    page.evaluate("async()=>{window.qaStore=await import('/__qa__/storage.js');}")
    result = page.evaluate('''async()=>{
      const meta={session:'qa-duplicate',dict:'jp-core',mode:'practice',kanaPerSec:1,accuracy:1,endedAt:2};
      const event={...meta,t:0,key:'a',code:'KeyA',correct:true,expected:['a'],prevKey:null,dt:0,wordStart:true,afterMiss:false,intended:null};
      qaFault='throw';const first=await qaStore.saveSession([event],meta);qaFault=null;
      const recovered=await qaStore.saveSession([{...event,key:'b'}],{...meta,accuracy:.5});
      qaHold=true;let oldSettled=false,newSettled=false;
      const old=qaStore.saveSession([{...event,key:'c'}],meta).then(status=>{oldSettled=true;return status;});
      await qaAwaitDone();
      const newer=qaStore.saveSession([{...event,key:'d'}],{...meta,accuracy:.25}).then(status=>{newSettled=true;return status;});
      if(oldSettled||newSettled)throw new Error('Commit status resolved before its completion notification');
      qaDone.shift()();const olderStatus=await old;
      await qaAwaitDone();
      if(newSettled)throw new Error('Old completion resolved new save');
      const memoryKeys=(await qaStore.loadEvents()).filter(e=>e.session===meta.session).map(e=>e.key);
      qaDone.shift()();const latestStatus=await newer;
      return {first,recovered,olderStatus,latestStatus,memoryKeys};
    }''')
    assert result == {'first': 'memory', 'recovered': 'persistent', 'olderStatus': 'persistent',
                      'latestStatus': 'persistent', 'memoryKeys': ['d']}, result
    saved = page.evaluate(READ)
    assert len(saved['events']) == len(saved['sessions']) == 2
    assert next(r for r in saved['events'] if r['session'] == 'qa-duplicate')['events'][0]['key'] == 'd'
    assert next(m for m in saved['sessions'] if m['session'] == 'qa-duplicate')['accuracy'] == .25
    verify_reload(page, saved)
    assert not errors, errors
    rows['native_store'].append({'case': 'same-id-recovery-and-in-flight-replacement', 'passed': True,
                                 'statuses': result, 'disk_sessions': 2, 'no_duplicate_or_stale_overwrite': True})
    context.close(); browser.close()
(OUT / 'results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
print(json.dumps({'browser': rows['browser'], 'app_passed': [row['case'] for row in rows['app']],
                  'native_store': rows['native_store'], 'results': str(OUT / 'results.json')}, ensure_ascii=False, indent=2))
