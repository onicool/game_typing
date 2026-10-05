"""Serial diagnostic normal-motion A/B timing; no paint or latency guarantee."""
import ast,json,math,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
URL=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5185'
BASE=sys.argv[2] if len(sys.argv)>2 else 'http://127.0.0.1:5188'
OUT=Path('/tmp/game-typing-qa/skyway-sentinel-cycle/timing');OUT.mkdir(parents=True,exist_ok=True)
# Reuse the existing instrumentation, with ordinary motion enabled by default.
module=ast.parse(Path('checks/graphics_check.py').read_text())
INIT=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MEASURE' for t in n.targets))

def stats(v):
 v=sorted(v)
 return {'n':len(v),**{label:round(v[math.ceil(len(v)*q)-1],3) for label,q in [('p50_ms',.5),('p95_ms',.95),('p99_ms',.99)]},'max_ms':round(v[-1],3)} if v else {'n':0}
rows=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for repeat in [1,2]:
  for tag,url,settings in [('before',BASE,''),('sentinel',URL,''),('sentinel-low',URL,"localStorage.setItem('icebreaker.graphics.low','true');")]:
   c=b.new_context(viewport={'width':1366,'height':768});c.add_init_script(INIT+settings)
   page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url);page.keyboard.press('d')
   page.evaluate('()=>{window.qaRandom=Math.random;Math.random=()=>8/2**31;}');page.keyboard.press('Space');page.evaluate('Math.random=qaRandom')
   page.wait_for_timeout(250)
   for _ in range(5):page.keyboard.type(page.locator('#romaji').inner_text(),delay=5)
   page.evaluate('qaCollect=true');sequence=[]
   for _ in range(30):
    guide=page.locator('#romaji').inner_text();sequence.append(guide);page.keyboard.type(guide,delay=5)
   page.evaluate('qaCollect=false');page.wait_for_timeout(100);data=page.evaluate('({handler:qaHandler,next:qaNext,draw:qaDraw})')
   assert not errors,errors
   rows.append({'repeat':repeat,'condition':tag,'sequence':sequence,'keys':sum(map(len,sequence)),
                'handler':stats(data['handler']),'next_raf':stats(data['next']),'app_raf_work':stats(data['draw']),'page_errors':errors});c.close()
 b.close()
for repeat in [1,2]:
 seq=[r['sequence'] for r in rows if r['repeat']==repeat];assert seq[0]==seq[1]==seq[2]
r={'rows':rows,'limits':'Serial headless Chromium, native trusted typing, ordinary motion, muted audio; software callback work only. No screenshots/video during sampling. Shared-host/browser/instrumentation load uncontrolled; two repeats cannot establish paint/device latency, real GPU performance or causal improvement.'}
(OUT/'results.json').write_text(json.dumps(r,indent=2));print(json.dumps([{k:v for k,v in row.items() if k!='sequence'} for row in rows],indent=2))
