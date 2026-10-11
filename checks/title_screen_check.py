"""Check the title-to-side-battle flow using isolated artificial records."""
import json
import os
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
ERRORS, CASES = [], []
INIT = '''
const open=indexedDB.open.bind(indexedDB);
const db=sessionStorage.getItem('title-check-db')||'title-check-'+crypto.randomUUID();
sessionStorage.setItem('title-check-db',db);
indexedDB.open=(name,...args)=>open(name==='icebreaker-stats'?db:name,...args);
if(!sessionStorage.getItem('title-check-initialized')) {
  localStorage.setItem('icebreaker.angel.character',JSON.stringify('towa'));
  localStorage.setItem('icebreaker.sound','false');
  localStorage.setItem('title-check-preserved','unchanged');
  sessionStorage.setItem('title-check-initialized','true');
}
Math.random=()=>.25;
'''
SEED = '''async()=>{
  const db=await new Promise((ok,no)=>{const r=indexedDB.open('icebreaker-stats',1);
    r.onupgradeneeded=()=>{for(const name of ['sessions','events']) {
      const s=r.result.createObjectStore(name,{keyPath:'session'});s.createIndex('dict','dict',{unique:false});
    }};r.onerror=()=>no(r.error);r.onsuccess=()=>ok(r.result);
  });
  await new Promise((ok,no)=>{const tx=db.transaction(['sessions','events'],'readwrite');
    tx.objectStore('sessions').put({session:'title-preserved',dict:'jp-core',mode:'benchmark',kanaPerSec:1,accuracy:1,endedAt:1});
    tx.objectStore('events').put({session:'title-preserved',dict:'jp-core',endedAt:1,events:[]});
    tx.oncomplete=ok;tx.onerror=()=>no(tx.error);
  });db.close();
}'''
AUDIT = '''async()=>{
  const db=await new Promise(ok=>{const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>ok(r.result);});
  const rows=await Promise.all(['sessions','events'].map(name=>new Promise(ok=>{
    const r=db.transaction(name,'readonly').objectStore(name).getAll();r.onsuccess=()=>ok(r.result);
  })));db.close();return rows;
}'''


def remaining(page):
    return page.locator('#romaji').inner_text()[len(page.locator('#romaji .av-typed').inner_text()):]


with sync_playwright() as p:
    browser = launch_chromium(p, headless=os.environ.get('TITLE_CHECK_HEADFUL') != '1')

    def fresh():
        c=browser.new_context(viewport={'width':1366,'height':768})
        c.add_init_script(INIT)
        page=c.new_page();page.set_default_timeout(10000)
        page.on('pageerror',lambda e:ERRORS.append(str(e)))
        page.goto(URL)
        assert page.title()=='打天使（だてんし）'
        assert page.locator('#title-name').inner_text()=='打天使'
        assert page.locator('#angel-app').evaluate("e=>e.classList.contains('av-at-title')")
        assert not page.locator('.av-chrome').is_visible()
        assert not page.locator('.side-vector').count()
        assert page.evaluate("localStorage.getItem('icebreaker.angel.character')")=='"towa"'
        page.evaluate(SEED)
        return c,page

    def battle(page,character):
        assert page.locator('.av-combat-scene').get_attribute('data-character')==character
        page.wait_for_function("document.querySelector('.side-vector').dataset.artReady==='ready'")
        assert page.locator('.side-vector').get_attribute('data-accepted') in (None,'0')
        assert page.locator('.av-chrome').is_visible()
        assert page.locator('.av-brand').inner_text()=='打天使 だてんし'
        page.wait_for_function("document.querySelector('#bgm-player').currentTime>.1")
        assert page.locator('#bgm-player').evaluate('a=>!a.paused && a.loop && a.playbackRate===1 && !a.error')
        page.keyboard.type(remaining(page)[:4],delay=30)
        assert page.locator('.side-vector').get_attribute('data-accepted')=='4'
        assert page.locator('.side-player').get_attribute('data-pose')=='attack'

    c,page=fresh();before=page.evaluate(AUDIT)
    page.wait_for_function("[...document.querySelectorAll('.av-title img')].every(i=>i.complete&&i.naturalWidth>0)")
    page.screenshot(path=str(OUT/'title.png'),full_page=True)
    page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',repeat:true,bubbles:true}))")
    assert page.locator('#title-name').is_visible()
    page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',isComposing:true,bubbles:true}))")
    assert page.locator('#title-name').is_visible()
    page.locator('.av-title-settings').click()
    page.locator('#settings-dialog').focus()
    page.keyboard.press('Space')
    assert page.locator('#settings-dialog').is_visible()
    assert not page.locator('.side-vector').count()
    page.locator('#close-settings').click()
    page.locator('#title-name').focus()
    page.keyboard.press('Space');battle(page,'elna')
    page.screenshot(path=str(OUT/'space-elna-battle.png'),full_page=True)
    assert page.evaluate(AUDIT)==before
    page.keyboard.press('Escape');page.locator('#pause-title-home').click()
    assert page.locator('#title-name').is_visible()
    assert page.locator('#bgm-player').evaluate('a=>a.paused')
    assert page.evaluate(AUDIT)==before
    assert page.evaluate("localStorage.getItem('title-check-preserved')")=='unchanged'
    page.reload();assert page.locator('#title-name').is_visible()
    assert page.evaluate(AUDIT)==before
    CASES.append({'case':'space-default-elna-input-bgm-settings-return-reload-record-preserved'})
    c.close()

    c,page=fresh();page.locator('#title-start').click();battle(page,'elna')
    CASES.append({'case':'title-button-default-elna-input-bgm'});c.close()

    c,page=fresh();page.locator('.av-title-menu [data-view="characters"]').click()
    assert page.locator('[data-person="towa"]').get_attribute('aria-pressed')=='true'
    page.locator('[data-action="combat-practice"]').click();battle(page,'towa')
    CASES.append({'case':'character-menu-retains-towa-and-latest-battle'});c.close()

    for view,expected in [('journey','旅の地図'),('training','言葉を磨く'),('records','練習の記録')]:
        c,page=fresh();page.locator(f'.av-title-menu [data-view="{view}"]').click()
        assert page.locator('h1').inner_text()==expected
        page.locator('.av-chrome [data-view="title"]').click()
        assert page.locator('#title-name').is_visible()
        CASES.append({'case':'title-menu-'+view+'-and-return'});c.close()
    version=browser.version;browser.close()

assert not ERRORS,ERRORS
result={'browser':version,'visibleBrowser':os.environ.get('TITLE_CHECK_HEADFUL')=='1','url':URL,'cases':CASES,'pageErrors':ERRORS,'existingUserProfileUsed':False}
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
