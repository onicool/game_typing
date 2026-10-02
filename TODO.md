# TODO

## Done (2026-10-02)
- Codex review fixes (10 items): deadline enforced inside `Round.input()`, zero-length intervals ignored, final speed counts the half-typed word, case folding for kana dictionaries, overclock speed gate uses the round's best settled median, stage 1 can decay to 0, criticals measured against the transition baseline, Mozc spellings (gwi/kwi/hwa/vya/swe/zwi/tchi …), single n only before kana, title keys ignore auto-repeat
- Keystroke logs saved per round (IndexedDB, `src/stats/store.ts`)
- Stats engine (`src/stats/analyze.ts`, by Codex) and vulnerability report screen (`R` on title/result, `H` toggles slowness/miss heatmap)
- Severity uses a conservative (lower 95%) impact; miss prior sized to ~3 pseudo-misses, so chance slips and timing noise stay 調査中

## Next
- [ ] Defense mode (DESIGN.md §2.2): incoming intruders, auto-target nearest, core integrity, waves
- [ ] Patch (training) mode: word selection weighted by vulnerabilities + withheld probe words (DESIGN.md §4.5)
- [ ] Bigram frequency table from a real corpus (impact currently uses the player's own transition mix)
- [ ] Dive run structure: 3 sectors, counter words, modules, MIRROR
