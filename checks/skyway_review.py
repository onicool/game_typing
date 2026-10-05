"""Record the local production build at one fixed viewport; no compositing."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
URL=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5185'
OUT=Path('/tmp/game-typing-qa/asset-cycle/production-review');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 c=b.new_context(viewport={'width':1366,'height':768},record_video_dir=str(OUT/'video'),record_video_size={'width':1366,'height':768})
 c.add_init_script("localStorage.setItem('icebreaker.sound','false');localStorage.setItem('icebreaker.effects.shake','0.5');")
 page=c.new_page();errors=[];assets=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('response',lambda r:assets.append({'path':r.url.split('/')[-1],'status':r.status}) if '/stages/' in r.url else None)
 page.goto(URL);page.wait_for_function("document.querySelector('#title-screen')");page.wait_for_timeout(400)
 page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>1499/2**31;}');page.keyboard.press('Space');page.evaluate('Math.random=qaRandom');page.wait_for_timeout(300)
 for i in range(6):
  if i==2:
   page.keyboard.type('?');page.wait_for_timeout(250)
  preview=[page.locator('#next-word').inner_text(),page.locator('#following-word').inner_text()]
  guide=page.locator('#romaji').inner_text();page.keyboard.type(guide,delay=65);page.wait_for_timeout(140)
  assert page.locator('#word').inner_text()==preview[0] and page.locator('#next-word').inner_text()==preview[1]
  if i==0:page.screenshot(path=str(OUT/'production-breakthrough-1366.png'))
 page.keyboard.press('Escape');page.wait_for_timeout(650);page.keyboard.press('Enter');page.wait_for_timeout(400)
 page.screenshot(path=str(OUT/'production-flight-1366.png'))
 page.keyboard.press('Escape');page.keyboard.press('Escape');page.locator('#start-passage').click()
 guide=page.locator('#romaji').inner_text();page.keyboard.type(guide[:95],delay=40)
 page.screenshot(path=str(OUT/'production-long-1366.png'));page.wait_for_timeout(300)
 page.keyboard.press('Escape');page.wait_for_timeout(300);page.locator('#pause-finish').click()
 page.wait_for_function("document.querySelector('#session-save-state').textContent.includes('このブラウザに保存しました')")
 assert '途中終了' in page.locator('#r-mode').inner_text()
 page.screenshot(path=str(OUT/'production-partial-saved-1366.png'));page.wait_for_timeout(500)
 assert not errors,errors
 video=page.video;c.close();b.close()
 r={'production_url':URL,'viewport':[1366,768],'silent':True,'fixed_viewport':True,'six_native_words':True,'one_deliberate_miss':True,
    'pause_resume':True,'long_partial_keys':95,'partial_persisted':True,'assets':assets,'page_errors':errors,'video_webm':str(video.path())}
 assert len(assets)==2 and all(a['status']==200 for a in assets),assets
 (OUT/'results.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps(r,ensure_ascii=False,indent=2))
