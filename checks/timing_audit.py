"""Serial browser controls for software timing. No latency budget is asserted."""
import json
import math
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5179'
OUT = Path('/tmp/game-typing-qa')
OUT.mkdir(parents=True, exist_ok=True)
rows = []

INIT = '''try {localStorage.setItem('icebreaker.sound','false');
  localStorage.setItem('icebreaker.effects.motion','0');} catch {}
  window.qaCollect=false;window.qaNoAppLoop=false;
  window.qaHandler=[];window.qaNext=[];window.qaQueue=[];window.qaLoop=[];
  const nativeRAF=window.requestAnimationFrame.bind(window);window.qaNativeRAF=nativeRAF;
  let appCallback=null;
  window.requestAnimationFrame=function(cb){
    if(!appCallback)appCallback=cb;
    return nativeRAF(t=>{
      if(cb===appCallback&&window.qaNoAppLoop)return;
      const start=performance.now();cb(t);
      if(cb===appCallback&&window.qaCollect)window.qaLoop.push(performance.now()-start);
    });
  };
  const original=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
    if(this===window&&type==='keydown'&&typeof listener==='function'){
      const handler=listener;listener=function(e){
        const playing=document.querySelector('#stage')&&!document.querySelector('#stage').classList.contains('overlay-open');
        const record=window.qaCollect&&playing&&e.isTrusted&&e.key.length===1&&!e.repeat;
        const start=performance.now();handler.call(this,e);
        if(record){window.qaHandler.push(performance.now()-start);window.qaQueue.push(Math.max(0,start-e.timeStamp));
          nativeRAF(()=>window.qaNext.push(performance.now()-start));}
      };
    }
    return original.call(this,type,listener,options);
  };
'''


def summary(values):
    if not values:
        return {'n': 0}
    values = sorted(values)
    return {'n': len(values), **{label: round(values[math.ceil(len(values)*q)-1], 3)
                                 for label, q in [('p50_ms', .5), ('p95_ms', .95), ('p99_ms', .99)]},
            'max_ms': round(values[-1], 3)}


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for repeat in range(2):
        for condition in ['blank-idle', 'app-idle', 'app-typing', 'app-typing-loop-bypassed', 'app-typing-known-load']:
            context = browser.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='reduce')
            context.add_init_script(INIT)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            if condition == 'blank-idle':
                # about:blank has no app, storage, app handlers, or rendering loop.
                page.goto('about:blank')
                page.evaluate('''()=>{window.qaCollect=false;window.qaHandler=[];window.qaNext=[];window.qaQueue=[];window.qaLoop=[];
                  window.qaNativeRAF??=requestAnimationFrame.bind(window);}''')
            else:
                page.goto(URL)
                page.keyboard.press('d')
                page.evaluate('''()=>{window.qaRandom=Math.random;Math.random=()=>8/2**31;}''')
                page.keyboard.press('Space')
                page.evaluate('Math.random=window.qaRandom')
                if condition == 'app-typing-loop-bypassed':
                    page.evaluate('window.qaNoAppLoop=true')
                page.wait_for_timeout(250)
            page.evaluate('''()=>{window.qaGaps=[];window.qaFrameTimestamps=[];window.qaProbe=true;window.qaCollect=true;
              let last=null,lastT=null;const probe=t=>{if(!qaProbe)return;const now=performance.now();
                if(last!==null){qaGaps.push(now-last);qaFrameTimestamps.push(t-lastT);}last=now;lastT=t;qaNativeRAF(probe);};qaNativeRAF(probe);
              window.qaBegin=performance.now();}''')
            if condition == 'app-typing-known-load':
                page.evaluate('''()=>{window.qaBusy=setInterval(()=>{const start=performance.now();while(performance.now()-start<40){}},160);}''')
            expected = 0
            if 'typing' in condition:
                for _ in range(25):
                    text = page.locator('#romaji').inner_text()
                    page.keyboard.type(text, delay=2)
                    expected += len(text)
                assert page.locator('#accuracy-note').inner_text() == 'ミス 0'
            elapsed = page.evaluate('performance.now()-qaBegin')
            page.wait_for_timeout(max(0, 1500-elapsed))
            page.evaluate('''()=>{window.qaCollect=false;window.qaProbe=false;if(window.qaBusy)clearInterval(window.qaBusy);}''')
            page.wait_for_timeout(100)
            data = page.evaluate('''()=>({handlers:qaHandler,next:qaNext,queue:qaQueue,loop:qaLoop,gaps:qaGaps,
              timestamps:qaFrameTimestamps,elapsed:performance.now()-qaBegin})''')
            assert len(data['handlers']) == expected == len(data['next'])
            assert not errors, errors
            row = {'repeat': repeat+1, 'condition': condition, 'elapsed_ms': round(data['elapsed'], 1),
                   'trusted_keys': expected, 'handler': summary(data['handlers']), 'browser_timestamp_to_handler': summary(data['queue']),
                   'handler_start_to_next_callback': summary(data['next']), 'callback_execution_gaps': summary(data['gaps']),
                   'rAF_timestamp_gaps': summary(data['timestamps']), 'app_loop_sync_work': summary(data['loop'])}
            rows.append(row)
            print(json.dumps({'repeat': repeat+1, 'condition': condition, 'keys': expected,
                              'handler_p95_ms': row['handler'].get('p95_ms'), 'next_p99_ms': row['handler_start_to_next_callback'].get('p99_ms'),
                              'idle_or_typing_gap_p99_ms': row['callback_execution_gaps'].get('p99_ms')}, ensure_ascii=False), flush=True)
            context.close()
    browser_version = browser.version
    browser.close()

result = {'browser': browser_version, 'viewport': '1280x720', 'headless': True, 'reduced_motion': True,
          'audio': 'muted', 'runs': rows,
          'controls': '25 seeded English words, CDP keys with 2 ms requested pacing; 1.5 s minimum capture. Loop bypass omits the app RAF callback (scene AND clock), not just canvas. Known load is a synthetic 40 ms spin every 160 ms. Conditions run serially in fresh contexts.',
          'limits': 'Software headless scheduling/handler measurements only; no actual paint/device latency. Shared-host and automation load are uncontrolled. Two repeats cannot establish a product defect or a causal bottleneck.'}
(OUT / 'timing-audit-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
