"""Local artificial audio faults: trusted keys, pause/resume and exact saved logs.

No personal records, microphone access, audio output claims or OS device changes.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
OUT = Path('/tmp/game-typing-qa/audio-cycle')
OUT.mkdir(parents=True, exist_ok=True)
CASES = ['normal', 'muted-constructor-fault', 'missing', 'constructor-fault',
         'graph-fault', 'node-fault', 'gain-fault', 'resume-rejection', 'closed-context']
INIT = '''window.qaContexts=[];window.qaConstructs=0;window.qaGains=[];
const NativeContext=AudioContext;
window.AudioContext=class extends NativeContext {
  constructor(options){window.qaConstructs++;super(options);qaContexts.push(this);
    const gain=this.createGain.bind(this);
    this.createGain=()=>{const n=gain();qaGains.push(n);return n;};
  }
};
'''
SAVE = '''async()=>{const db=await new Promise((resolve,reject)=>{
 const r=indexedDB.open('icebreaker-stats',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
 const read=store=>new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();
 r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
 const events=await read('events'),sessions=await read('sessions');db.close();
 return {events:events.flatMap(r=>r.events).map(e=>({key:e.key,code:e.code,correct:e.correct,
 expected:e.expected,wordId:e.wordId,wordStart:e.wordStart,afterPause:!!e.afterPause})),sessions};}'''
rows = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    version = browser.version
    reference = None
    for case in CASES:
        context = browser.new_context(viewport={'width': 800, 'height': 600}, reduced_motion='reduce')
        setup = INIT
        if case in ['muted-constructor-fault', 'constructor-fault']:
            setup += "window.AudioContext=class{constructor(){qaConstructs++;throw new Error('QA constructor');}};"
        if case == 'muted-constructor-fault':
            setup += "localStorage.setItem('icebreaker.sound','false');"
        if case == 'missing':
            setup += 'window.AudioContext=undefined;'
        if case == 'graph-fault':
            setup += "NativeContext.prototype.createDelay=()=>{throw new Error('QA graph');};"
        context.add_init_script(setup)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL)
        page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>1499/2**31;}')
        page.keyboard.press('Space')
        page.evaluate('()=>{Math.random=qaRandom;}')
        assert page.locator('#ready-help').is_visible(), case
        first = page.locator('#romaji').inner_text()
        assert first == 'chirimotsumorebayamatonaru', (case, first)
        page.keyboard.type(first[:3], delay=3)
        if case == 'node-fault':
            page.evaluate("()=>{qaContexts[0].createOscillator=()=>{throw new Error('QA oscillator');};}")
        if case == 'gain-fault':
            page.evaluate("()=>{qaGains[0].gain.cancelAndHoldAtTime=()=>{throw new Error('QA gain');};}")
            page.locator('#sound-volume').fill('0.5')
            page.locator('#sound-volume').dispatch_event('input')
            page.keyboard.press('Escape')  # Leave the native control before typing.
        # Window blur and hidden visibility events are artificial. Real browser
        # keyboard input and modal focus are used; this is not an OS sleep test.
        page.evaluate("()=>{window.dispatchEvent(new Event('blur'));}")
        assert page.locator('#pause-screen').is_visible(), case
        assert page.evaluate("document.activeElement.id==='pause-resume'"), case
        paused_timer = page.locator('#timer').inner_text()
        page.evaluate("()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}")
        page.wait_for_timeout(150)
        assert page.locator('#timer').inner_text() == paused_timer, case
        page.evaluate("()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));}")
        if case == 'resume-rejection':
            page.evaluate("async()=>{await qaContexts[0].suspend();qaContexts[0].resume=()=>Promise.reject(new Error('QA resume'));}")
        if case == 'closed-context':
            page.evaluate('async()=>{await qaContexts[0].close();}')
        page.keyboard.press('Enter')
        assert not page.locator('#pause-screen').is_visible(), case
        assert page.evaluate("document.activeElement.id==='input-panel' || document.activeElement===document.body"), case
        page.keyboard.type(first[3:], delay=3)
        assert page.locator('#chain').inner_text() == str(len(first)), case
        if case not in ['normal', 'muted-constructor-fault', 'closed-context']:
            assert '利用不可' in page.locator('#sound-state').inner_text(), case
            assert '現在利用不可' in page.locator('#sound-toggle').get_attribute('aria-label'), case
            assert page.locator('#sound-toggle').get_attribute('aria-pressed') == 'false', case
            bounds = page.locator('#sound-state').bounding_box()
            assert bounds and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 800, case
            if case == 'node-fault':
                page.screenshot(path=str(OUT / 'audio-unavailable-800x600.png'))
        if case in ['node-fault', 'gain-fault', 'resume-rejection']:
            page.locator('#sound-toggle').click()
            page.locator('#sound-toggle').click()
            assert page.locator('#sound-state').inner_text() == '[ 音声 ON ]', case
            assert page.evaluate('qaConstructs') == 2, case
        for _ in range(2):
            guide = page.locator('#romaji').inner_text()
            page.keyboard.type(guide, delay=3)
        assert page.locator('#accuracy-note').inner_text() == 'ミス 0', case
        page.evaluate('''()=>{const e=new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true});
          Object.defineProperty(e,'timeStamp',{value:performance.now()+65000});document.activeElement.dispatchEvent(e);}''')
        page.wait_for_function("!document.querySelector('#result-screen').classList.contains('hidden') && !document.querySelector('#session-save-state').textContent.includes('保存中')")
        saved = page.evaluate(SAVE)
        assert len(saved['sessions']) == 1 and saved['sessions'][0]['mode'] == 'practice', case
        assert all(event['correct'] for event in saved['events']), case
        assert sum(event['afterPause'] for event in saved['events']) == 1, case
        assert reference is None or saved['events'] == reference, case
        reference = saved['events']
        constructs = page.evaluate('qaConstructs')
        assert constructs == (0 if case in ['muted-constructor-fault', 'missing'] else
                              2 if case in ['node-fault', 'gain-fault', 'resume-rejection', 'closed-context'] else 1), case
        assert not errors, (case, errors)
        sound_preference = page.evaluate("localStorage.getItem('icebreaker.sound')")
        assert sound_preference == ('false' if case == 'muted-constructor-fault' else
                                    'true' if case in ['node-fault', 'gain-fault', 'resume-rejection'] else None), case
        save_state = page.locator('#session-save-state').inner_text()
        page.reload()
        page.keyboard.press('Space')
        page.wait_for_function("document.querySelector('#ready-help') && !document.querySelector('#ready-help').classList.contains('hidden')")
        assert page.evaluate(SAVE)['events'] == saved['events'], case
        rows.append({'case': case, 'passed': True, 'keys': len(saved['events']), 'input_matches_normal': True,
                     'contexts_before_reload': constructs, 'page_errors': errors, 'save_state': save_state,
                     'pause_and_reload_preserved_records': True})
        context.close()
    browser.close()
result = {'browser': version, 'cases': rows, 'limits': 'Artificial faults/blur/visibility/deadline; no real device outage, OS sleep, audio listening, Safari or Firefox.'}
(OUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps(result, ensure_ascii=False, indent=2))
