"""Finite, isolated JS callback measurements; not physical latency or GPU cost.

Run after other browser checks: python checks/stage1_frame_cost_check.py LOCAL_URL NEW_JSON
The instrumentation is identical to stage1_combat_check.py, with three fresh pairs.
"""
import ast
import json
import statistics
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from browser_support import launch_chromium

url, output = sys.argv[1:3]
assert urlparse(url).hostname in ('localhost', '127.0.0.1')
destination = Path(output)
assert not destination.exists(), 'Preserve earlier evidence'
source = ast.parse(Path(__file__).with_name('stage1_combat_check.py').read_text())
init = next(ast.literal_eval(n.value) for n in source.body
            if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'INIT' for t in n.targets))
measurements, errors = [], []
with sync_playwright() as p:
    browser = launch_chromium(p)
    for repeat in range(3):
        for motion in (1, 0):
            context = browser.new_context(viewport={'width':1366, 'height':768})
            context.add_init_script(init + f"localStorage.setItem('icebreaker.effects.motion','{motion}');")
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: errors.append('external request')
                    if urlparse(r.url).hostname not in ('localhost', '127.0.0.1') else None)
            page.goto(url)
            page.locator('[data-view=journey]').click()
            page.locator('[data-place="0"]').click()
            page.locator('[data-action="start-journey"]').click()
            page.keyboard.type(page.locator('#romaji').inner_text()[0])
            page.wait_for_timeout(3400)
            values = sorted(page.evaluate('qaFrameCosts.slice(-160)'))
            assert len(values) == 160
            measurements.append({'repeat':repeat+1, 'motion':motion, 'samples':len(values),
                'medianMs':statistics.median(values), 'p95Ms':values[int((len(values)-1)*.95)], 'maxMs':max(values)})
            context.close()
    version = browser.version
    browser.close()
assert not errors, errors
result = {'browser':version, 'measurements':measurements, 'errors':errors,
          'artificialDataOnly':True, 'physicalLatencyMeasured':False, 'gpuFrameCostMeasured':False}
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(result))
