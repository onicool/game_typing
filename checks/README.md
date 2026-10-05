# Local browser regressions

These checks use only artificial data in fresh Chromium contexts. They do not
read an existing browser profile or contact a deployed game. The environment
used for this cycle already provided Python Playwright and `/usr/bin/chromium`;
these are optional verification prerequisites, not new project dependencies.

Build and run the local preview in one terminal:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5179 --strictPort
```

In another terminal:

```sh
python checks/settings_browser_check.py
python checks/keyboard_check.py
python checks/dialog_input_check.py
```

All accept an optional local preview URL as the first argument. JSON results
and screenshots go to `/tmp/game-typing-qa`. The settings check covers invalid
original-byte preservation, reload/new-context reopening, external fixture
repair, failed writes, denied reads, and recovery. The keyboard check covers
Tab/Shift+Tab, sound/range/effect controls, retained focus, dictionary persistence,
and control keys excluded from typing. A synthetic timestamp advances round
completion, so neither check measures real 60-second runs or hardware latency.

The dialog/input check verifies settings/pause focus entry and Tab cycling,
original-focus return, background inertness, disabled/empty controls, native
activation, and IME/repeat/modifier isolation. D switches dictionaries only on
the title outside native controls; d is normal typing in benchmark/patch, and
ignored as a shortcut in paused/settings/report/result states. A temporary text
editor is injected solely to test native-input isolation. During play, Escape
from a control returns to the typing panel; Escape from the typing surface
pauses; Escape in the pause dialog returns to title. Space/Enter activate the
currently focused modal button.

This check also records existing keydown-handler duration and time to the next
rAF callback over a 30-word steady typing burst after warm-up, excluding modal
and screenshot work from that capture interval. It uses an instrumented
headless Chromium context. The rAF callback is
not a paint measurement. Browser automation, shared-machine load, headless
rendering, timer precision, and instrumentation affect these numbers; they are
not physical keyboard-to-display latency or a product performance guarantee.

The fourth-cycle audits are saved for resumption after higher-priority work:

```sh
python checks/quality_audit.py
python checks/timing_audit.py
```

The quality audit builds the audit-only `fixtures.ts` with the existing Vite
installation into `/tmp`, then routes that public-source fixture into fresh
browser contexts. It checks five sizes, actual longest dictionary guides,
error/retry/repeat paths, AX names/references/live status, and isolated long-text
engine stress. It never uses an existing browser profile. Spoken screen-reader
behavior remains unconfirmed; paragraph UI is not part of the current product.

The timing audit compares blank/idle/typing, a test-only bypass of the app's RAF
callback (scene and clock), and deliberately injected CPU load. It runs serially
with two repeats and writes diagnostic JSON, without enforcing a latency budget.
Shared-host load, browser automation, and rendering affect results. It does not
measure paint or device latency and cannot by itself establish a product defect.

The resumed graphics cycle adds a bounded visual comparison:

```sh
# Before rebuilding, preserve the prior build under a new /tmp directory.
cp -a dist /tmp/game-typing-baseline-dist
python -m http.server 5180 --bind 127.0.0.1 --directory /tmp/game-typing-baseline-dist
# In separate terminals, build and preview the candidate on 5179, then:
python checks/graphics_check.py http://127.0.0.1:5179 http://127.0.0.1:5180
```

Use a fresh destination or the retained earlier baseline; do not copy the
candidate over the baseline. The completed baseline for this cycle is preserved
at `/tmp/game-typing-qa/graphics-cycle/before-dist` (runtime `7c831e54`).
The check records five-size A/B text geometry, real browser screenshots with
the same seed and typed prefix, and four frame steps around the fifth word's
firewall completion. Scripted rAF is used only for reproducible capture; the
normal serial timing samples use actual browser callbacks. No screenshots are
composited or edited, and A/B is a preference comparison rather than a statistical
experiment.

Eight renderer conditions verify exact persisted keys/accepted flags/expected
keys/word identity: normal, low load, reduced motion, unavailable WebGL, null or
throwing Canvas2D acquisition, simulated context loss/restore and injected draw
failure. Low-load keyboard activation, high-DPI backing-store dimensions, reload,
and preservation of damaged original settings are checked. Outputs are in
`/tmp/game-typing-qa/graphics-cycle/graphics-results.json` and adjacent PNGs.
The renderer remains Canvas2D; WebGL/Three.js was not implemented. No real
driver/context-loss event, physical input/display or paint latency, cold-start
budget, spoken accessibility, or Safari/Firefox measurement was performed.

Optional-audio resilience can be checked separately without rerunning graphics:

```sh
npm test -- --maxWorkers=1
npm run build
# Run the local preview, then in another terminal:
python checks/audio_check.py http://127.0.0.1:5179
python checks/keyboard_check.py http://127.0.0.1:5179
```

Nine fresh contexts cover normal/muted audio, missing/throwing constructors,
graph/node/gain faults, a rejected resume, and a closed context. Each types the
same seeded 34-key sequence, injects blur/hidden events, resumes via native modal
keyboard focus, saves an interrupted practice round and reloads. Key fields match
the normal condition exactly, with a single after-pause event, no page errors,
and unchanged sound preferences except deliberate controls. Three recoverable
faults also verify an explicit off → on retry. Results and the small-window
failure-notice screenshot are in `/tmp/game-typing-qa/audio-cycle/`.
These are artificial failures, not physical audio-device, OS sleep, sound
listening or cross-browser tests. The existing 300 ms analysis unit gate is
sensitive to shared-host contention: the initial parallel run took 325.92 ms;
the full 159-test run passed serially. No threshold was relaxed.

IndexedDB recovery and stale completion checks use the production preview:

```sh
npm test -- --maxWorkers=1
npm run build
python checks/idb_recovery_check.py http://127.0.0.1:5183
```

The check builds `storage-fixtures.ts` with installed Vite, serves it only through
a test route for an isolated native transaction race, and uses the preview UI for
11 other scenarios. It seeds an original artificial record; injects temporary
open failures, closed connections, transaction aborts and delayed completion;
restores access; and compares complete records after reload, including the NaN
first-key interval. It also checks that late abandoned success leaves the healthy
connection cached, same-ID retries remain unique, and old success/abort callbacks
leave the current result pending until its own save completes. Results are in
`/tmp/game-typing-qa/idb-recovery-cycle/results.json`.

Pending memory-only writes are retried at the next save; report reads reconnect
but do not automatically commit them. Reload/close before a successful retry still
loses memory-only data. No data clearing or schema reset is used. Actual full
disk/quota, browser permission changes, OS failures, other browsers and conflicting
cross-tab writers remain unverified. Unit fixtures model request-success before
transaction completion, which the earlier interrupted fixture got wrong; the
original assertions are retained. All 172 unit cases and the production build
passed, with the existing analysis performance threshold unchanged.

Long practice and two future queue items are checked independently:

```sh
python checks/passage_queue_check.py http://127.0.0.1:5183 http://127.0.0.1:5187
```

The second URL serves the retained `ba597cf` build in
`/tmp/game-typing-qa/passage-cycle/before-user-features/dist`. The check records
actual same-seed/partial-input screenshots before and after the queue change at
five sizes. It verifies readable fonts, wrapping, current-position visibility on
resize, 12-word JP/EN queue order against saved word IDs, pause/retries/dictionary
changes, original passage completion and partial finish, miss recovery, persistent
practice-only records and complete reload equality. `fixtures.ts` is an audit-only
route for source metadata. Results/screenshots stay under
`/tmp/game-typing-qa/passage-cycle/`; no upload occurs.

Round unit cases also type all four original passages beyond 60 seconds and
check uncapped duration, completion counts and pause/partial finish. The buffered
patch regression intentionally now preserves the shown word and clears an
invalidated target instead of silently substituting another word; probe holdouts
remain probes. No skip key or rhythm judgement was added. The final 179 unit cases
and build passed. The initial new fixture compared a WordStream dictionary copy
to the source object's identity; it now checks identity against the actually
selected word. UI regressions caught and resolved the long-helper/footer overlap
and readiness visibility. Physical input/paint, OS IME and other browsers remain
unverified; the captures are preference evidence, not a controlled efficacy study.


SKYWAY stage checks use the local Vite dev server, because the audit-only probe
imports the exact app Scene module (including any Vite HMR query) and inspects
existing state. No debug hooks ship in production. Serve the retained `e026e8b`
production build independently as the second URL:

```sh
npm run dev -- --host 127.0.0.1 --port 5184 --strictPort
python checks/skyway_check.py http://127.0.0.1:5184 http://127.0.0.1:5188
```

Results, actual PNGs and a raw silent browser video go to
`/tmp/game-typing-qa/skyway-cycle/`. Recording requires Playwright's ffmpeg
executable. In this environment the installed `/usr/bin/ffmpeg` was reused via
a task-local `playwright/ffmpeg-1011/ffmpeg-linux` link and that directory was
passed through `PLAYWRIGHT_BROWSERS_PATH`; no download/dependency was added.
The existing generated PNG is served locally from `public/stages/skyway.png`;
loading failure keeps a procedural sky, and Canvas loss keeps typing usable.
Checks cover accepted-key approach, six completions/six barriers/one stronger
breach, fixed input geometry, paused scene/pixel equality, motion-off/low-load
completion and both asset/Canvas fallback. Long/queue and keyboard/dialog/audio
checks were rerun with separate output directories to preserve earlier evidence.
The renderer stress fixture disables drawing-argument recording only for the
300-completion stress test, retaining all state/cap assertions and timeout.
The raw video is an actual browser recording with no scene compositing. Review
MP4 conversion uses installed ffmpeg. Physical keyboard/display/GPU latency,
sustained devices, cold start, listening, spoken readers and other browsers
remain unmeasured.
