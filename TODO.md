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

## Quality priorities (small cycles before new modes)

The existing target is a desktop browser, Japanese romaji / English, local-only
storage, and the current cyber-space visual style. These are acceptance goals,
not claims of parity with paid products. Resume only when higher-priority work
is waiting; keep each cycle on a local branch until publishing is requested.

| Order | Quality area | Next measurable acceptance target |
|---|---|---|
| 1 | Saving / recovery | This cycle: say saved only after both event and metadata stores commit; memory fallback remains usable and is disclosed. Next: validate malformed saved settings without a startup crash. |
| 2 | Keyboard UX / accessibility | Resolve global Tab capture, buttons excluded from Tab order, and range keys forcibly blurred. Verify keyboard access, focus visibility, and no control keys entering the typing score. |
| 3 | Input accuracy / latency | Extend spelling, IME, repeat, modifier, and pause browser regressions. Measure key-handler and visible feedback p50/p95/p99 on declared hardware; assess the existing 16 ms design target after measurement. |
| 4 | Training / feedback | Separate first-key reaction time from finger transitions; use synthetic data to prove pause, recovery, and word-boundary exclusions. Evaluate improvement on benchmark/probe data rather than patch scores. |
| 5 | Stability | Verify repeated rounds, large local histories, storage failures, blur/hidden recovery, and small desktop viewports before adding defense or run structures. |

### First-cycle validation limits

- The storage unit tests model unavailable/open-error/blocked storage, transaction completion/error/abort, synchronous put failure, snapshot isolation, dictionary separation, and same-session retry without duplicates.
- Browser verification used Chromium with fresh contexts; one full word was typed normally and the 60-second deadline was advanced with an artificial KeyboardEvent timestamp. It did not measure a real 60-second run or physical input/display latency.
- Safari/Firefox, screen-reader speech, sustained sessions, real disk-quota exhaustion, existing personal histories, and paid-product comparisons were not tested. No new dependency was added. No main, production, push, PR, or publication change was made.

## Next
- [ ] Defense mode (DESIGN.md §2.2)
- [ ] Bigram frequency table from a real corpus (impact still uses the player's own benchmark mix)
- [ ] Reaction time (word shown → first key) reported separately from finger time
- [ ] Dive run structure: 3 sectors, counter words, modules, MIRROR
