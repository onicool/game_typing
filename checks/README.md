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
```

Both accept an optional local preview URL as the first argument. JSON results
and screenshots go to `/tmp/game-typing-qa`. The settings check covers invalid
original-byte preservation, reload/new-context reopening, external fixture
repair, failed writes, denied reads, and recovery. The keyboard check covers
Tab/Shift+Tab, sound/range/effect controls, retained focus, dictionary persistence,
and control keys excluded from typing. A synthetic timestamp advances round
completion, so neither check measures real 60-second runs or hardware latency.
