import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL=sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
Path('/tmp/game-typing-qa').mkdir(parents=True, exist_ok=True)
results=[]
def focus_id(page):
    return page.evaluate('document.activeElement.id')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1280,'height':720},reduced_motion='reduce')
    page=context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    page.keyboard.press('Tab')
    assert focus_id(page)=='sound-toggle'
    assert page.locator('#dict-name').inner_text()=='日本語'
    page.keyboard.press('Space')
    assert focus_id(page)=='sound-toggle'
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='true'
    page.keyboard.press('Tab')
    assert focus_id(page)=='sound-volume'
    page.keyboard.press('ArrowLeft')
    assert page.locator('#sound-volume').input_value()=='0.95'
    assert focus_id(page)=='sound-volume'
    page.keyboard.press('Home'); assert page.locator('#sound-volume').input_value()=='0'
    page.keyboard.press('End'); assert page.locator('#sound-volume').input_value()=='1'
    page.keyboard.press('ArrowLeft')
    assert page.locator('#sound-volume').evaluate("e => getComputedStyle(e).outlineStyle")=='solid'
    page.keyboard.press('d')
    assert page.locator('#dict-name').inner_text()=='日本語'
    page.keyboard.press('Shift+Tab'); assert focus_id(page)=='sound-toggle'
    page.keyboard.press('Escape'); assert focus_id(page)!='sound-toggle'
    page.keyboard.press('d'); assert page.locator('#dict-name').inner_text()=='English'
    page.reload()
    assert page.locator('#dict-name').inner_text()=='English'
    assert page.locator('#sound-volume').input_value()=='0.95'
    assert page.locator('#sound-toggle').get_attribute('aria-pressed')=='true'
    results.append({'case':'tab-native-sound-range-shift-tab-dictionary-shortcut-and-reload','passed':True})

    page.keyboard.press('s')
    # Navigate using actual browser Tab events until the first visible effect control.
    for _ in range(8):
        page.keyboard.press('Tab')
        if page.evaluate("document.activeElement.dataset.effect === 'shake'"): break
    assert page.evaluate("document.activeElement.dataset.effect === 'shake'")
    before=page.locator('#setting-shake').inner_text()
    page.keyboard.press('Space')
    assert page.locator('#setting-shake').inner_text()!=before
    assert page.evaluate("document.activeElement.dataset.effect === 'shake'")
    page.screenshot(path='/tmp/game-typing-qa/keyboard-settings-focus-1280.png')
    page.keyboard.press('Tab'); assert page.evaluate("document.activeElement.dataset.effect === 'flash'")
    page.keyboard.press('Shift+Tab'); assert page.evaluate("document.activeElement.dataset.effect === 'shake'")
    page.keyboard.press('Escape')
    assert not page.locator('#settings-screen').is_visible()
    assert page.evaluate("document.activeElement.tagName === 'BODY'")
    results.append({'case':'settings-controls-tab-space-retained-focus-escape','passed':True})

    page.keyboard.press('Space')
    page.wait_for_selector('#ready-help:not(.hidden)')
    guide=page.locator('#romaji').inner_text()
    page.keyboard.press('Tab'); assert focus_id(page)=='pause-trigger'
    page.keyboard.press('Tab'); assert focus_id(page)=='sound-toggle'
    page.keyboard.press('Space'); page.keyboard.press('d')
    page.keyboard.press('Tab'); assert focus_id(page)=='sound-volume'
    page.keyboard.press('ArrowLeft'); page.keyboard.press('a'); page.keyboard.press('Space')
    assert focus_id(page)=='sound-volume'
    assert page.locator('#romaji').inner_text()==guide
    assert page.locator('#accuracy-note').inner_text()=='ミス 0'
    assert page.locator('#chain').inner_text()=='0'
    assert page.locator('#timer').inner_text()=='RUN 00:60 / 最初のキーでスタート'
    page.screenshot(path='/tmp/game-typing-qa/keyboard-play-focus-1280.png')
    page.keyboard.press('Escape')
    assert focus_id(page)=='input-panel'
    assert not page.locator('#pause-screen').is_visible()
    page.keyboard.press('Escape')
    page.wait_for_selector('#pause-screen:not(.hidden)')
    assert focus_id(page)=='pause-resume'
    page.keyboard.press('Enter')
    assert focus_id(page)=='input-panel'
    page.keyboard.type(guide,delay=5)
    assert page.locator('#chain').inner_text()!='0'
    assert page.locator('#accuracy-note').inner_text()=='ミス 0'
    assert not errors,errors
    results.append({'case':'control-keys-excluded-from-round-and-escape-resume','passed':True,'page_errors':errors})
    context.close(); browser.close()
Path('/tmp/game-typing-qa/keyboard-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
