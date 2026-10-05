# TODO

## Done
- 2026-10-02: Codex review fixes (10 items), keystroke logs in IndexedDB, stats engine, vulnerability report
- 2026-10-03:
  - Word data: 450 JP (readings independently verified) + 300 EN, merged and de-duplicated
  - Patch (weakness training) mode: report → digits 1–8; 20-word blocks (12 ordinary / 6 weak / 2 probe), Thompson-style target sampling, probes reserved and unmarked; patch rounds excluded from weakness ranking
  - Persistent personal baselines for criticals/overclock (localStorage, frozen per round)
  - Pause (Esc / blur / hidden) with practice labelling; seeded benchmark word order
  - HUD: accuracy gauge instead of TRACE, firewall count, layer pips, time bar, chain/overclock announcements
  - Sound: always-available mute + volume, softer clicks, 3 rotating progressions
  - Settings (S): shake / flash / motion, prefers-reduced-motion defaults
  - Result: honest near-miss wording, last 5 sessions; report: speed + accuracy trend with EMA
  - Scene: packets bound to firewall generation, full reset, cached gradients, 4K canvas cap
- 2026-10-05 (local branch `improve/session-save-feedback`):
  - Session save status now distinguishes an IndexedDB transaction commit from memory-only retention; result screen announces the actual outcome and explains loss on reload/close.
  - Removed the unconditional saved claim for practice results. Late save completion cannot update another round's result.
  - 9 storage regressions added; 111 total tests and production build passed. Chromium checked normal persistence, unavailable IndexedDB, an aborted real write, interrupted practice without a prior best, and delayed completion after retry; normal data survived reload, failed writes did not. Result/status layout also fit 1280×720. Input and deadline data were synthetic.
- 2026-10-05, second local cycle on the same branch:
  - Reproduced crashes from a negative dictionary index, a string personal best, and null spelling preferences using artificial storage values. Settings now validate dictionary index, booleans, volume, effect levels, personal bests, and spelling preferences before use.
  - Invalid original bytes are preserved through startup, explicit setting changes, round completion, reload, and a new browser context. Changes to damaged keys work only in page memory. Storage reads/writes that fail are disclosed; defaults are never automatically persisted. Writes check the current disk value again, so corruption introduced after startup is protected too. After external repair/restored access, explicit changes can persist again.
  - Partially damaged personal baseline records can still supply recognised entries, but round-end updates cannot overwrite the original damaged record.
  - Tab/Shift+Tab use native focus navigation. Dictionary switching moved from Tab to D (shown on title). Sound/effect buttons retain keyboard focus; native volume arrow/Home/End keys work. Control keys are excluded from typing; Escape releases control focus and performs the usual pause/close action. Focus outlines added.
  - 28 new unit cases (139 total) and typechecked production build passed. Fresh-context Chromium checks covered malformed settings, reload/new-context reopening, externally repaired settings, failed writes, denied reads and recovery, keyboard focus/range/effect controls, dictionary persistence, and control keys excluded from scoring. Prior session-save browser checks also passed again. Screenshots inspected at 1280×720.
  - Reproducible settings/keyboard browser checks are retained in `checks/`; see `checks/README.md` for the existing environment prerequisites and local-only commands.
- 2026-10-05, third local cycle on the same branch:
  - Reproduced settings focus remaining on the body/background audio control, plus composing Enter resuming a paused round. Settings/pause dialogs now focus their first action, cycle Tab/Shift+Tab through visible enabled controls, make background siblings inert, and restore prior focus/inert state on close (body fallback for unavailable origins).
  - Added native settings open/close and pause/resume/retry/title controls. Enter/Space activate the focused modal button. During play, Escape from a control returns to typing; Escape from typing pauses; Escape in pause returns to title. The footer explains the control-to-input action.
  - IME/Process/229 checks precede menu commands. Paused/settings keys cannot reach the game. D remains a title-only dictionary shortcut outside controls; normal d in English benchmark/patch is accepted, while uppercase D remains a case-sensitive English miss. Repeats/modifiers/composition are excluded.
  - `checks/dialog_input_check.py` adds six browser scenarios: focus/modal isolation, original-focus return (including a hidden-origin fallback), native editing/empty controls, D by context, pause IME/repeat protection, and burst input/log equality. The final run verified 181 benchmark/practice keys and 9 patch keys exactly, with only the single deliberately incorrect uppercase D. Existing 139 unit tests, typechecked build, and earlier browser regressions passed.
  - Software-only headless timing is recorded separately in `/tmp/game-typing-qa/software-input-timing.json`: existing keydown-handler duration and next-rAF callback opportunity. It does not measure physical keyboard/display delay or actual paint. No timing instrumentation was added to production code.

## Quality priorities (small cycles before new modes)

The existing target is a desktop browser, Japanese romaji / English, local-only
storage, and the current cyber-space visual style. These are acceptance goals,
not claims of parity with paid products. Resume only when higher-priority work
is waiting; keep each cycle on a local branch until publishing is requested.

| Order | Quality area | Next measurable acceptance target |
|---|---|---|
| 1 | Saving / recovery | Completed locally: committed-session status and malformed-setting protection. Next: recovery/export options that preserve original records, plus schema/version and cross-tab behavior. |
| 2 | Keyboard UX / accessibility | Completed locally: Tab/range controls, modal focus entry/cycling/return, background isolation, native modal actions, and score isolation. Next: actual screen-reader behavior and remaining menu actions; this is not a full accessibility audit. |
| 3 | Input accuracy / latency | Completed locally: D-context, IME/repeat/modifier/pause, and burst-input/log regressions. Next: investigate delayed next-rAF tails under controlled load, extend spelling/IME on actual browsers, and measure visible feedback on declared hardware before assessing the 16 ms design target. |
| 4 | Training / feedback | Separate first-key reaction time from finger transitions; use synthetic data to prove pause, recovery, and word-boundary exclusions. Evaluate improvement on benchmark/probe data rather than patch scores. |
| 5 | Stability | Verify repeated rounds, large local histories, storage failures, blur/hidden recovery, and small desktop viewports before adding defense or run structures. |

### First-cycle validation limits

- The storage unit tests model unavailable/open-error/blocked storage, transaction completion/error/abort, synchronous put failure, snapshot isolation, dictionary separation, and same-session retry without duplicates.
- Browser verification used Chromium with fresh contexts; one full word was typed normally and the 60-second deadline was advanced with an artificial KeyboardEvent timestamp. It did not measure a real 60-second run or physical input/display latency.
- Safari/Firefox, screen-reader speech, sustained sessions, real disk-quota exhaustion, existing personal histories, and paid-product comparisons were not tested. No new dependency was added. No main, production, push, PR, or publication change was made.

### Second-cycle validation limits

- All persisted fixtures were synthetic and used isolated Chromium contexts. Reopening used a new context with copied artificial storage state; a physical OS/browser restart was not tested. Actual 60-second duration and hardware latency remain unmeasured.
- Read restrictions and quota failures were injected deterministically; no real user data was inspected, deleted, exported, or repaired. The application does not auto-repair damaged records. Explicit setting changes on damaged keys remain temporary until the original is externally repaired; the UI says so.
- Screen-reader announcements, dialog focus confinement/return, Safari/Firefox, cross-tab races, and storage eviction are still unverified. The initial keyboard browser check failed on a test expectation omitting the ready-timer suffix; after correcting that expectation it passed without an app code change.

### Third-cycle validation limits

- Chromium at 1280×720, synthetic data, artificial deadline, and synthetic composition/repeat/modifier flags. The fresh-context test injects temporary native text fields to verify the routing rule; these are not new product features. Actual OS IME composition, screen-reader speech, Safari/Firefox, device latency, and paint timing remain untested.
- The old keyboard check needed new expected focus targets for the new pause button and dialog entry. The new input-log assertion initially assumed Playwright `Shift+d` emitted uppercase D; its event was lowercase. Using the explicit uppercase `D` key corrected the fixture, and the exact-log check passed. No unresolved application test failure remains.
- Headless handler/next-rAF timing includes the test instrumentation and this environment's load. Delayed rAF tails were observed and remain a next investigation candidate; no paid-product comparison or latency guarantee is made.
- Final software sample: Chromium 151.0.7922.173, 1280×720, reduced motion, 171 trusted keystrokes over 30 words after warm-up. Modal/screenshot work was excluded from the capture interval. Handler p50/p95/p99/max = 1.2/2.0/2.8/7.2 ms; next-rAF callback = 5.9/10.6/75.2/79.6 ms. These are a single environment sample, not paint or device latency, and the rAF tail's cause is not identified.

## Next
- 2026-10-05 user requirement update — planning only; graphics implementation has not resumed.
  - Browser-first (Mac/PC), with stronger graphics in the existing neon/wireframe style. Three.js is an explicit candidate; current implementation remains Canvas2D with no new dependency. See DESIGN.md §7.5 / §8.
  - Preserve the implementation checkpoint `7c831e54e98974a08b45c49658e4b03938f8897d`. Higher-priority work still takes precedence; no preview or test process is running.
  - Next bounded proposal: first review small-window text legibility and capture the current scene; then compare one word-completion / packet-impact / firewall-opening effect using the same seed. Assess Three.js against improving Canvas2D before choosing a renderer. This is a proposal, not an implementation or installation approval.
  - Acceptance gates: opaque fixed DOM input; exact input/log/score equality; separate startup and continuous-input measurements; low-load and prefers-reduced-motion behavior; usable Canvas2D/static fallback on unavailable WebGL2, failed initialisation, or context loss; viewport/focus regressions; repeated-session resource stability. Record browser/GPU and distinguish callback timing from actual paint/device latency.
  - Keep source/main/production and original records intact. No push/PR/publication or new authentication/persistent permissions/paid services. Confirm installations beyond necessary official npm dependencies, external material transmission, and publishing before doing them. Use procedural graphics first.
- Fourth local cycle paused for the higher-priority hub trial publication request (2026-10-05). Changes were preserved without rollback or deletion.
  - Saved change: unchanged settings warnings no longer rewrite live-region text; a modal-local polite status and description expose settings failures inside the inert-isolated dialog. The background copy is hidden while a modal is open.
  - Completed checks before the interruption: 139 unit tests, typechecked production build, settings/keyboard/dialog browser regressions, and `quality_audit.py`. Five viewport sizes (1920×1080, 1366×768, 1024×768, 800×600, 768×1024), actual longest JP/EN guides, five recent sessions, error/retry/repeat paths, a synthetic 280-character engine paragraph, and 5,000 engine keys passed. Warning rewrites decreased from 13 to 1 per region; modal AX status count changed from 0 to 1; control names and ARIA references were checked.
  - Timing audit completed 10 serial fresh-context runs (five conditions × two repeats). Normal typing handler p95 was 1.2/1.1 ms; next-rAF p99 was 79.9/16.3 ms. Blank/idle, bypassed app loop, and known synthetic CPU load controls show that tail values vary with measurement/environment/workload. The isolated engine's last-500-key p95 was 0.2 ms at 5,000 keys. No reproducible input-handler bottleneck was established, so no speed optimisation was made.
  - No screen reader/TTS command or browser speech voice was available. AX/DOM validation is not an actual spoken test. Device latency, paint, Safari/Firefox, and real OS IME remain unverified.
  - Resume point: review the saved diff and audit outputs, then choose a small-window legibility improvement only when higher-priority work is idle. JP reading text scales to 8.53 px at 1024×768 and 6.67 px at 800×600; current word/guide geometry fits, but readability is not certified. Full custom paragraph UI is not implemented (engine-only stress test).
  - Evidence: `/tmp/game-typing-qa/quality-audit-results.json`, `timing-audit-results.json`, and `quality-*.png`. No test was left running; the final regression batch finished before the stop was handled. The preliminary timing fixture hit about:blank's storage restriction; its setup was corrected and all 10 controls then completed.
- [ ] Defense mode (DESIGN.md §2.2)
- [ ] Bigram frequency table from a real corpus (impact still uses the player's own benchmark mix)
- [ ] Reaction time (word shown → first key) reported separately from finger time
- [ ] Dive run structure: 3 sectors, counter words, modules, MIRROR
