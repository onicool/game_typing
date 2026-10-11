"""Finite, actual Chromium motion checks. Evidence stays outside the repository."""
import json
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
INIT = """
const open=indexedDB.open.bind(indexedDB), db='motion-check-'+crypto.randomUUID();
indexedDB.open=(name,...args)=>open(name==='icebreaker-stats'?db:name,...args);
localStorage.setItem('icebreaker.sound','false'); Math.random=()=>.25;
"""

def guide(page):
    return page.locator('#romaji').inner_text()[len(page.locator('#romaji .av-typed').inner_text()):]

def actor(page, name):
    return page.locator('.side-'+name).evaluate('e=>({...e.dataset,transform:e.getAttribute("transform")})')

with sync_playwright() as p:
    browser = launch_chromium(p)

    def fresh(character='elna', missing=False, low=False):
        context = browser.new_context(viewport={'width':1366,'height':768})
        context.add_init_script(INIT + f"localStorage.setItem('icebreaker.angel.character',JSON.stringify('{character}'));" + ("localStorage.setItem('icebreaker.graphics.low','true');" if low else ''))
        if missing:
            context.route('**/battle-art/motion/*.webp', lambda route: route.abort())
        page = context.new_page(); page.set_default_timeout(15000)
        requests=[]
        page.on('request', lambda r: requests.append(r.url))
        page.on('pageerror', lambda e: ERRORS.append(str(e)))
        page.clock.install(time=0); page.clock.pause_at(1000)
        page.goto(URL); page.locator('[data-action="combat-practice"]').click()
        page.wait_for_function("['ready','fallback','static'].includes(document.querySelector('.side-vector').dataset.artReady)")
        return context, page, requests

    for character, moves, combos in [('elna',['thrust','sweep','rise','reverse'],['helix','burst']),('towa',['jab','cross','uppercut','palm'],['double','nova'])]:
        c,page,_=fresh(character)
        assert page.locator('.side-vector').get_attribute('data-art-ready')=='ready'
        phases=[]
        for move in moves:
            page.keyboard.type(guide(page)[:1]); elapsed=0; frames=[]
            assert actor(page,'enemy')['motion']=='hit'
            for at in [16,64,112,160,208,288]:
                page.clock.run_for(at-elapsed); elapsed=at
                a=actor(page,'player'); assert a['motion']==move,a
                frames.append((int(a['frame']),a['phase']))
                page.locator('.av-combat-scene').screenshot(path=str(OUT/f'{character}-{move}-{a["frame"]}.png'))
            assert [f[0] for f in frames]==list(range(6)),frames
            phases.append({'move':move,'frames':frames})
            page.clock.run_for(64)
        page.keyboard.type(guide(page))
        assert actor(page,'player')['motion']==combos[0]
        assert actor(page,'player')['reaction']=='combo'
        page.clock.run_for(500); page.keyboard.type(guide(page)[:1])
        assert actor(page,'player')['motion']=='guard'
        page.clock.run_for(64)
        assert actor(page,'player')['reaction']=='guard'
        page.keyboard.type(guide(page))
        assert actor(page,'player')['reaction']=='parry'
        assert actor(page,'enemy')['motion']=='deflect'
        page.clock.run_for(500); page.keyboard.type(guide(page))
        assert actor(page,'player')['motion']==combos[1]
        CASES.append({'character':character,'normals':phases,'combos':combos,'guardAndParry':True})
        c.close()

    c,page,_=fresh()
    page.keyboard.type(guide(page)); page.clock.run_for(500)
    contacts={}; phases=set()
    for _ in range(1600):
        page.clock.run_for(16); enemy=actor(page,'enemy')
        if enemy.get('reaction')=='enemy':
            phases.add((enemy['motion'],enemy['phase']))
            if enemy['phase']=='contact' and enemy['motion'] not in contacts:
                contacts[enemy['motion']]=enemy
                assert actor(page,'player')['reaction']=='hit'
                if enemy['motion']=='melee': assert 'translate(-230' in enemy['transform'],enemy
                page.locator('.av-combat-scene').screenshot(path=str(OUT/f'enemy-{enemy["motion"]}.png'))
        if len(contacts)==3 and ('volley','ready') in phases: break
    assert set(contacts)=={'shot','melee','volley'},contacts
    for move in contacts:
        assert all((move,phase) in phases for phase in ['windup','accelerate','contact','follow','recover','ready']),(move,phases)
    CASES.append({'enemyContacts':contacts,'allSixPhases':True})
    c.close()

    for missing,low in [(True,False),(False,True)]:
        c,page,requests=fresh(missing=missing,low=low)
        assert page.locator('.side-vector').get_attribute('data-art-ready')==('static' if low else 'fallback')
        page.keyboard.type(guide(page)[:4])
        assert page.locator('.side-vector').get_attribute('data-accepted')=='4'
        assert actor(page,'player')['pose']==('idle' if low else 'attack')
        if low: assert not any('/battle-art/motion/' in u or '/battle-art/effects/' in u for u in requests)
        CASES.append({'missingAssets':missing,'low':low,'accepted':4})
        c.close()
    version=browser.version; browser.close()

assert not ERRORS,ERRORS
result={'browser':version,'cases':CASES,'pageErrors':ERRORS,'physicalLatencyMeasured':False,'gpuCostMeasured':False}
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
