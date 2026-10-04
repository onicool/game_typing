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

## Next
- [ ] Defense mode (DESIGN.md §2.2)
- [ ] Bigram frequency table from a real corpus (impact still uses the player's own benchmark mix)
- [ ] Reaction time (word shown → first key) reported separately from finger time
- [ ] Dive run structure: 3 sectors, counter words, modules, MIRROR
