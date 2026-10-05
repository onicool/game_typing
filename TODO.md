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

## Quality priorities (small cycles before new modes)

The existing target is a desktop browser, Japanese romaji / English, local-only
storage, and the current cyber-space visual style. These are acceptance goals,
not claims of parity with paid products. Resume only when higher-priority work
is waiting; keep each cycle on a local branch until publishing is requested.

| Order | Quality area | Next measurable acceptance target |
|---|---|---|
| 1 | Saving / recovery | Completed locally: committed-session status and malformed-setting protection. Next: recovery/export options that preserve original records, plus schema/version and cross-tab behavior. |
| 2 | Keyboard UX / accessibility | Completed locally: Tab/range controls, focus outlines, and score isolation. Next: dialog focus entry/return, screen-reader behavior, and native menu actions; this is not a full accessibility audit. |
| 3 | Input accuracy / latency | Extend spelling, IME, repeat, modifier, and pause browser regressions. Measure key-handler and visible feedback p50/p95/p99 on declared hardware; assess the existing 16 ms design target after measurement. |
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

## Next
- [ ] Defense mode (DESIGN.md §2.2)
- [ ] Bigram frequency table from a real corpus (impact still uses the player's own benchmark mix)
- [ ] Reaction time (word shown → first key) reported separately from finger time
- [ ] Dive run structure: 3 sectors, counter words, modules, MIRROR
