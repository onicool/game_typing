import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL=sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
OUT=Path('/tmp/game-typing-qa')
OUT.mkdir(parents=True, exist_ok=True)
BAD={'icebreaker.dict':'-1','icebreaker.prefs':'null','icebreaker.sound':'"false"',
     'icebreaker.volume':'2','icebreaker.effects.shake':'{broken','icebreaker.effects.flash':'null',
     'icebreaker.effects.motion':'[]','icebreaker.pb.jp-core':'"fast"',
     'icebreaker-baselines-v1:jp-core':'[["ka",{"n":8,"meanLog":5}],["damaged",null]]'}
results=[]

def settings(page):
    return page.evaluate('(keys) => Object.fromEntries(keys.map(key => [key,localStorage.getItem(key)]))',list(BAD))

def start_and_type(page):
    page.keyboard.press('Space')
    page.wait_for_selector('#ready-help:not(.hidden)')
    guide=page.locator('#romaji').inner_text()
    page.keyboard.type(guide,delay=5)
    assert page.locator('#chain').inner_text() != '0'

def finish(page):
    page.evaluate('''() => {
      const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});
      Object.defineProperty(e,'timeStamp',{value:performance.now()+60001});
      window.dispatchEvent(e);
    }''')
    page.wait_for_selector('#result-screen:not(.hidden)')
    page.wait_for_function("!document.querySelector('#session-save-state').textContent.includes('保存中')")

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1280,'height':720},reduced_motion='reduce')
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    page.evaluate('(data) => { for(const [key,raw] of Object.entries(data)) localStorage.setItem(key,raw); }',BAD)
    page.reload()
    page.wait_for_selector('#settings-storage-state:not(.hidden)')
    assert page.locator('#dict-name').inner_text()=='日本語'
    assert page.locator('#title-best').inner_text()==''
    assert page.locator('#sound-volume').input_value()=='1'
    page.keyboard.press('m') # bad setting works in-page, original stays intact
    page.keyboard.press('s'); page.keyboard.press('1'); page.keyboard.press('Escape')
    start_and_type(page); finish(page)
    assert settings(page)==BAD
    page.screenshot(path=str(OUT/'settings-corrupt-result-1280.png'))
    page.reload()
    assert settings(page)==BAD
    assert page.locator('#dict-name').inner_text()=='日本語'
    assert page.locator('#sound-volume').input_value()=='1'
    assert '元の保存内容は保持' in page.locator('#settings-storage-state').inner_text()
    assert not errors,errors
    # Reopen a new browser context using only this synthetic persisted state.
    state=context.storage_state(); context.close()
    context=browser.new_context(storage_state=state,viewport={'width':1280,'height':720})
    page=context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    assert settings(page)==BAD
    start_and_type(page); finish(page)
    assert settings(page)==BAD
    assert not errors,errors
    results.append({'case':'corrupt-values-reload-and-new-context','passed':True,'original_bytes_preserved':True,'page_errors':errors})
    # External repair is artificial user data preparation, never app logic.
    repaired={'icebreaker.dict':'1','icebreaker.prefs':'{"し":"si"}','icebreaker.sound':'false',
              'icebreaker.volume':'0.35','icebreaker.effects.shake':'0','icebreaker.effects.flash':'0.5',
              'icebreaker.effects.motion':'0','icebreaker.pb.jp-core':'2.5',
              'icebreaker-baselines-v1:jp-core':'[["ka",{"n":8,"meanLog":5}]]'}
    page.evaluate('(data)=>{for(const [key,raw] of Object.entries(data)) localStorage.setItem(key,raw);}',repaired)
    page.reload()
    assert page.locator('#dict-name').inner_text()=='English'
    assert page.locator('#sound-volume').input_value()=='0.35'
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='true'
    assert not page.locator('#settings-storage-state').is_visible()
    page.keyboard.press('m'); page.reload()
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='false'
    assert not page.locator('#settings-storage-state').is_visible()
    results.append({'case':'external-repair-then-explicit-save-and-reload','passed':True})
    context.close()

    # Real native storage with deterministic write failure and subsequent recovery.
    context=browser.new_context()
    context.add_init_script('''const nativeSet=Storage.prototype.setItem;
      window.qaFailWrites=false;
      Storage.prototype.setItem=function(...args) {
        if (window.qaFailWrites && args[0].startsWith('icebreaker.')) throw new DOMException('Synthetic quota','QuotaExceededError');
        return nativeSet.apply(this,args);
      };''')
    page=context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    page.keyboard.press('m') # persist false
    page.evaluate('window.qaFailWrites=true')
    page.keyboard.press('m') # temporary true
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='false'
    assert page.evaluate("localStorage.getItem('icebreaker.sound')")=='false'
    assert page.locator('#settings-storage-state').is_visible()
    page.screenshot(path=str(OUT/'settings-write-failure.png'))
    page.reload()
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='true'
    assert not page.locator('#settings-storage-state').is_visible()
    page.keyboard.press('m'); page.reload()
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='false'
    assert not errors,errors
    results.append({'case':'write-failure-memory-reload-recovery','passed':True,'page_errors':errors})
    context.close()
    context=browser.new_context()
    context.add_init_script("""const originalStorage = window.localStorage;
      window.qaNativeStorage = originalStorage;
      if (sessionStorage.getItem('qa-read-blocked') === null) {
        originalStorage.setItem('icebreaker.dict','1');
        originalStorage.setItem('icebreaker.sound','true');
        originalStorage.setItem('icebreaker.volume','0.4');
        sessionStorage.setItem('qa-read-blocked','yes');
      }
      Object.defineProperty(window,'localStorage',{get() {
        if (sessionStorage.getItem('qa-read-blocked') === 'yes') throw new DOMException('Synthetic restriction','SecurityError');
        return originalStorage;
      }});""")
    page=context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    assert page.locator('#dict-name').inner_text()=='日本語'
    assert page.locator('#sound-volume').input_value()=='1'
    assert page.locator('#settings-storage-state').is_visible()
    page.keyboard.press('m')
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='true'
    assert page.evaluate("qaNativeStorage.getItem('icebreaker.sound')")=='true'
    start_and_type(page); finish(page)
    assert page.evaluate("qaNativeStorage.getItem('icebreaker.volume')")=='0.4'
    page.evaluate("sessionStorage.setItem('qa-read-blocked','no')")
    page.reload()
    assert page.locator('#dict-name').inner_text()=='English'
    assert page.locator('#sound-volume').input_value()=='0.4'
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='false'
    assert not page.locator('#settings-storage-state').is_visible()
    assert not errors,errors
    results.append({'case':'read-access-denied-preservation-and-reload-recovery','passed':True,'page_errors':errors})
    context.close()
    browser.close()
(OUT/'settings-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
