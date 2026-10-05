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
