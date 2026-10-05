"""Artificial UI/input regressions; software handler timing, never device latency."""
import json
import math
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
OUT = Path('/tmp/game-typing-qa')
OUT.mkdir(parents=True, exist_ok=True)
results = []


def active(page):
    return page.evaluate('document.activeElement.id')


def key_event(page, key, **flags):
    return page.evaluate('''({key, flags}) => document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true, ...flags}))''',
                         {'key': key, 'flags': flags})


def finish(page):
    page.evaluate('''() => {
      const e = new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true,cancelable:true});
      Object.defineProperty(e,'timeStamp',{value:performance.now()+60001});
      document.activeElement.dispatchEvent(e);
    }''')
    page.wait_for_selector('#result-screen:not(.hidden)')
    page.wait_for_function("!document.querySelector('#session-save-state').textContent.includes('保存中')")


def saved_events(page):
    return page.evaluate('''async () => {
      const db = await new Promise((resolve,reject) => {
        const r = indexedDB.open('icebreaker-stats',1);
        r.onsuccess=()=>resolve(r.result); r.onerror=reject;
      });
      const records = await new Promise((resolve,reject) => {
        const r=db.transaction('events','readonly').objectStore('events').getAll();
        r.onsuccess=()=>resolve(r.result); r.onerror=reject;
      });
      db.close(); return records.flatMap(r=>r.events);
    }''')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    initial_dict = page.locator('#dict-name').inner_text()
    key_event(page, 'd', repeat=True)
    key_event(page, 'D', isComposing=True)
    key_event(page, 'd', keyCode=229)
    assert page.locator('#dict-name').inner_text() == initial_dict
    page.evaluate('''() => {
      const input=document.createElement('input'); input.id='qa-title-text';
      document.querySelector('#title-screen .ov-box').append(input); input.focus();
    }''')
    page.keyboard.type('dD')
    assert page.locator('#qa-title-text').input_value() == 'dD'
    assert page.locator('#dict-name').inner_text() == initial_dict
    page.keyboard.press('Escape')
    page.keyboard.press('d')
    assert page.locator('#dict-name').inner_text() == 'English'
    results.append({'case': 'dictionary-shortcut-only-unmodified-noncomposing-title', 'passed': True})

    # Native opener/closer and original-focus restoration, plus prior inert state.
    page.evaluate("document.querySelector('.topbar').inert=true")
    page.locator('#open-settings').focus()
    page.keyboard.press('Enter')
    assert page.evaluate("document.activeElement.dataset.effect === 'shake'")
    assert page.evaluate("[...document.querySelector('#stage').children].every(e => e.id==='settings-screen' || e.inert)")
    assert not page.evaluate("document.querySelector('#sound-volume').focus(); document.activeElement.id==='sound-volume'")
    for expected in ['flash', 'motion', None, 'shake']:
        page.keyboard.press('Tab')
        if expected is None:
            assert active(page) == 'close-settings'
        else:
            assert page.evaluate('document.activeElement.dataset.effect') == expected
    page.keyboard.press('Shift+Tab')
    assert active(page) == 'close-settings'
    page.keyboard.press('Tab')
    before = page.locator('#setting-shake').inner_text()
    page.keyboard.press('Enter')
    assert page.locator('#setting-shake').inner_text() != before
    assert page.locator('#settings-screen').is_visible()
    page.keyboard.press('d')
    key_event(page, 'D', isComposing=True)
    assert page.locator('#dict-name').inner_text() == 'English'
    assert page.evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'d',bubbles:true,cancelable:true}))") is False
    assert page.locator('#dict-name').inner_text() == 'English'
    page.screenshot(path=str(OUT / 'dialog-settings-cycle-1280.png'))
    page.keyboard.press('Escape')
    assert active(page) == 'open-settings'
    assert page.evaluate("document.querySelector('.topbar').inert")
    assert not page.evaluate("document.querySelector('.footer').inert")
    page.keyboard.press('Space')
    page.locator('#close-settings').click()
    assert active(page) == 'open-settings'
    results.append({'case': 'settings-entry-cycle-background-isolation-native-activation-and-focus-return', 'passed': True})

    # Injected text editor checks the general native-input route; no product field is added.
    page.keyboard.press('Enter')
    effect_before = [page.locator(f'#setting-{name}').inner_text() for name in ['shake', 'flash', 'motion']]
    page.evaluate('''() => {
      const input=document.createElement('input'); input.id='qa-setting-text';
      document.querySelector('#settings-screen .ov-box').append(input); input.focus();
    }''')
    page.keyboard.type('dDS123rq')
    assert page.locator('#qa-setting-text').input_value() == 'dDS123rq'
    key_event(page, 'Enter', isComposing=True)
    assert page.locator('#settings-screen').is_visible()
    assert page.locator('#dict-name').inner_text() == 'English'
    assert effect_before == [page.locator(f'#setting-{name}').inner_text() for name in ['shake', 'flash', 'motion']]
    page.keyboard.press('Tab')
    assert page.evaluate("document.activeElement.dataset.effect === 'shake'")
    page.keyboard.press('Escape')
    assert active(page) == 'open-settings'
    # With all controls disabled, Tab falls back to the dialog itself.
    page.keyboard.press('Enter')
    page.evaluate("document.querySelectorAll('#settings-screen button, #qa-setting-text').forEach(e=>e.disabled=true)")
    page.keyboard.press('Tab')
    assert active(page) == 'settings-screen'
    page.keyboard.press('Escape')
    assert active(page) == 'open-settings'
    page.keyboard.press('Enter')
    page.evaluate("document.querySelector('#open-settings').hidden=true")
    page.keyboard.press('Escape')
    assert page.evaluate("document.activeElement.tagName==='BODY'")
    assert not errors, errors
    results.append({'case': 'settings-native-editor-composition-and-empty-tab-list', 'passed': True})
    context.close()

    # Instrument only the existing window keydown handler in an isolated test context.
    context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce')
    context.add_init_script('''window.qaMeasure=false; window.qaHandlerTimes=[]; window.qaNextFrameTimes=[];
      const original=EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener=function(type,listener,options) {
        if(this===window && type==='keydown' && typeof listener==='function') {
          const handler=listener;
          listener=function(e) {
            const control=e.target instanceof HTMLElement && e.target.closest('button,input,select,textarea,[contenteditable]');
            const playing=document.querySelector('#stage') && !document.querySelector('#stage').classList.contains('overlay-open');
            const measure=window.qaMeasure && playing && !control && e.isTrusted && e.key.length===1 && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing;
            const start=performance.now();
            handler.call(this,e);
            if(measure) {
              window.qaHandlerTimes.push(performance.now()-start);
              requestAnimationFrame(()=>window.qaNextFrameTimes.push(performance.now()-start));
            }
          };
        }
        return original.call(this,type,listener,options);
      };''')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    page.keyboard.press('d')
    # Freeze only the start command's random seed, restore before typing; the dictionary is unchanged.
    for seed in range(40):
        page.evaluate('''seed => { window.qaRestoreRandom=Math.random; Math.random=()=>seed / 2**31; }''', seed)
        page.keyboard.press('Space' if seed == 0 else 'r')
        page.evaluate('Math.random=window.qaRestoreRandom')
        guide = page.locator('#romaji').inner_text()
        if 'd' in guide:
            break
        page.keyboard.press('Escape')
    assert 'd' in guide, 'No seeded d word found'
    pos = guide.index('d')
    page.keyboard.type(guide[:pos], delay=0)
    before = int(page.locator('#chain').inner_text())
    page.keyboard.press('d')
    assert int(page.locator('#chain').inner_text()) == before + 1
    assert page.locator('#mode-label').inner_text().startswith('EN / DIRECT')
    assert page.evaluate("localStorage.getItem('icebreaker.dict')") == '1'
    page.keyboard.press('D')  # English is case-sensitive: one deliberate miss.
    assert page.locator('#accuracy-note').inner_text() == 'ミス 1'
    key_event(page, 'd', repeat=True)
    key_event(page, 'd', ctrlKey=True)
    key_event(page, 'd', isComposing=True)
    key_event(page, 'Process')
    key_event(page, 'd', keyCode=229)
    assert page.locator('#accuracy-note').inner_text() == 'ミス 1'
    expected = list(guide[:pos] + 'dD')
    snapshot = (page.locator('#romaji').inner_text(), page.locator('#chain').inner_text(), page.locator('#accuracy-note').inner_text())
    page.keyboard.press('Escape')
    assert active(page) == 'pause-resume'
    for key, flags in [('Enter', {'isComposing': True}), (' ', {'keyCode': 229}), ('r', {'repeat': True}), ('q', {'repeat': True})]:
        key_event(page, key, **flags)
        assert page.locator('#pause-screen').is_visible()
    page.keyboard.press('d')
    page.keyboard.press('D')
    assert snapshot == (page.locator('#romaji').inner_text(), page.locator('#chain').inner_text(), page.locator('#accuracy-note').inner_text())
    assert page.evaluate("localStorage.getItem('icebreaker.dict')") == '1'
    for target in ['pause-retry', 'pause-title-return', 'pause-resume']:
        page.keyboard.press('Tab'); assert active(page) == target
    page.keyboard.press('Shift+Tab'); assert active(page) == 'pause-title-return'
    page.keyboard.press('Tab')
    page.screenshot(path=str(OUT / 'dialog-pause-cycle-1280.png'))
    page.keyboard.press('Space')
    assert page.evaluate("document.activeElement.tagName==='BODY'")
    remainder = guide[pos + 1:]
    page.keyboard.type(remainder, delay=0)
    expected.extend(remainder)
    page.evaluate('window.qaMeasure=true')
    for _ in range(30):
        text = page.locator('#romaji').inner_text()
        assert text and text.islower()
        page.keyboard.type(text, delay=0)
        expected.extend(text)
    page.evaluate('window.qaMeasure=false')
    page.wait_for_timeout(100)  # Flush callbacks before modal/screenshot/storage work.
    finish(page)
    events = saved_events(page)
    actual = [event['key'] for event in events]
    if actual != expected:
        (OUT / 'input-log-mismatch.json').write_text(json.dumps({'actual': actual, 'expected': expected, 'events': events}, indent=2))
        print({'actual_length': len(actual), 'expected_length': len(expected), 'first_mismatch': next((i for i, pair in enumerate(zip(actual, expected)) if pair[0] != pair[1]), None), 'actual_start': actual[:20], 'expected_start': expected[:20]})
    assert actual == expected
    assert sum(not event['correct'] for event in events) == 1
    assert all(event['dict'] == 'en-core' for event in events)
    page.keyboard.press('d')
    assert page.locator('#result-screen').is_visible()
    results.append({'case': 'benchmark-d-caps-d-ignored-flags-pause-ime-and-burst-input',
                    'passed': True, 'seed': seed, 'logged_keys': len(events), 'known_misses': 1})

    # Return focus to the actual pause opener, then Escape releases it to typing.
    page.keyboard.press('Space')
    page.locator('#pause-trigger').focus()
    page.keyboard.press('Enter')
    assert active(page) == 'pause-resume'
    page.keyboard.press('Enter')
    assert active(page) == 'pause-trigger'
    page.keyboard.press('Escape')
    assert active(page) == 'input-panel'
    assert not page.locator('#pause-screen').is_visible()
    page.keyboard.press('Escape')
    page.keyboard.press('Escape')
    assert page.locator('#title-screen').is_visible()
    assert active(page) == 'input-panel'
    results.append({'case': 'pause-native-opener-focus-return-control-escape-and-dialog-escape', 'passed': True})

    # Real report -> patch route, then d remains a character rather than a shortcut.
    page.keyboard.press('r')
    page.wait_for_function("!document.querySelector('#report').textContent.includes('ANALYZING')")
    dict_raw = page.evaluate("localStorage.getItem('icebreaker.dict')")
    page.keyboard.press('d')
    assert page.locator('#report-screen').is_visible()
    assert page.evaluate("localStorage.getItem('icebreaker.dict')") == dict_raw
    # The preceding interrupted run is practice; report can still produce targets.
    page.keyboard.press('1')
    assert page.locator('#mode-label').inner_text().startswith('PATCH //')
    patch_keys = []
    found_d = False
    for _ in range(40):
        text = page.locator('#romaji').inner_text()
        page.keyboard.type(text, delay=0)
        patch_keys.extend(text)
        found_d |= 'd' in text
        if found_d:
            break
    assert found_d
    assert page.locator('#mode-label').inner_text().startswith('PATCH //')
    assert page.locator('#accuracy-note').inner_text() == 'ミス 0'
    assert page.evaluate("localStorage.getItem('icebreaker.dict')") == dict_raw
    finish(page)
    patch_events = [event for event in saved_events(page) if event['mode'] == 'patch']
    assert [event['key'] for event in patch_events] == patch_keys
    assert all(event['correct'] for event in patch_events)
    assert not errors, errors
    results.append({'case': 'report-d-ignored-and-patch-d-counted-as-input', 'passed': True, 'logged_patch_keys': len(patch_events)})

    page.wait_for_timeout(100)
    handlers = page.evaluate('window.qaHandlerTimes')
    frames = page.evaluate('window.qaNextFrameTimes')
    def percentiles(values):
        values = sorted(values)
        return {'n': len(values), **{label: round(values[max(0, math.ceil(len(values) * q) - 1)], 3)
                                    for label, q in [('p50_ms', .5), ('p95_ms', .95), ('p99_ms', .99)]},
                'max_ms': round(values[-1], 3)}
    assert len(handlers) == len(frames) and len(handlers) >= 100
    timings = {'browser': browser.version, 'viewport': '1280x720', 'reduced_motion': True,
               'headless': True, 'sampling': '30-word steady typing burst, after warm-up; no modal/screenshot work during capture', 'software_keydown_handler_duration': percentiles(handlers),
               'keydown_start_to_next_rAF_callback': percentiles(frames),
               'limits': 'Instrumented headless software timing; rAF is a callback opportunity, not paint. No physical keyboard/display latency measurement.'}
    (OUT / 'software-input-timing.json').write_text(json.dumps(timings, ensure_ascii=False, indent=2))
    context.close()
    browser.close()

(OUT / 'dialog-input-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({'cases': results, 'timings': timings}, ensure_ascii=False, indent=2))
