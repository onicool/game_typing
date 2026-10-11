import { describe, expect, it } from 'vitest';
import { Duel, DUEL_TUNING } from './duel';
import type { InputView } from './battle';
import { Round } from './round';
import { TypingSession } from '../engine/romaji';
import { KNOWLEDGE_WORDS, KNOWLEDGE_PASSAGES } from '../content/knowledge';
const view = (keys = 40, index = 0): InputView => ({ current: { index, kana: keys }, remainingKana: keys, remainingKeys: keys,
  previews: [{ index: index + 1, kana: keys }, { index: index + 2, kana: keys }] });
const fresh = (keys = 40) => { const d = new Duel(2); d.startBoss(0); d.tick(0, view(keys)); return d; };
function complete(d: Duel, keys = 40, index = 0, at = 1000, clean = true) {
  for (let i = 0; i < keys; i++) d.acceptedKey(at, view(keys - i, index), i === keys - 1 ? view(keys, index + 1) : view(keys - i - 1, index));
  return d.wordDone({ index, kana: keys, clean, gameMs: at }, view(keys, index + 1));
}
describe('gentle first-stage duel', () => {
  it('gives every accepted letter damage, retained when an unfinished window expires', () => {
    const d = fresh(); d.acceptedKey(1, view(40), view(39));
    expect(d.snapshot().hp).toBe(DUEL_TUNING.bossHp - 1);
    const end = d.snapshot().duel!.endsAt;
    expect(d.tick(end + 1, view(39))).toEqual([]);
    expect(d.snapshot().hp).toBe(DUEL_TUNING.bossHp - 1);
    expect(d.snapshot().duel!.mode).toBe('defend');
  });
  it('allows corrected errors to finish a combo; clean completion is an extra bonus', () => {
    const corrected = fresh(), clean = fresh();
    expect(complete(corrected, 40, 0, 1000, false)).toContainEqual({ type: 'combo', clean: false });
    complete(clean);
    expect(corrected.snapshot().hp - clean.snapshot().hp).toBe(DUEL_TUNING.cleanBonus);
  });
  it('zero input takes small spaced packets and never a catch-up burst', () => {
    const d = fresh(); complete(d); const w = d.snapshot().duel!;
    expect(d.tick(w.nextAt - 1, view(40, 1))).toEqual([]);
    expect(d.tick(w.nextAt, view(40, 1))).toEqual([{ type: 'chip', amount: 2, guarded: false }]);
    expect(d.snapshot().duel!.guardHp).toBe(98);
    expect(d.tick(w.nextAt, view(40, 1))).toEqual([]);
    expect(d.tick(w.endsAt + 100000, view(40, 1))).toEqual([]);
    expect(d.snapshot().duel!.guardHp).toBe(98);
  });
  it('partial letters earn a proportional packet guard before whole-word completion', () => {
    const d = fresh(); complete(d); const w = d.snapshot().duel!;
    for (let i = 0; i < 20; i++) d.acceptedKey(2000, view(40 - i, 1), view(39 - i, 1));
    expect(d.tick(w.nextAt, view(20, 1))).toEqual([{ type: 'chip', amount: 0, guarded: true }]);
    expect(d.snapshot().duel!.guardHp).toBe(100);
    expect(d.snapshot().duel!.guarded).toBe(1);
  });
  it('completion in time parries, recovers tentative chip damage, and ignores clean status', () => {
    const d = fresh(); complete(d); const w = d.snapshot().duel!;
    d.tick(w.nextAt, view(40, 1));
    expect(complete(d, 40, 1, w.endsAt, false)).toContainEqual({ type: 'parry' });
    expect(d.snapshot().duel!.guardHp).toBe(100);
    expect(d.snapshot().stats.parries).toBe(1); expect(d.snapshot().stats.cracks).toBe(0);
  });
  it('the exact deadline accepts completion but a later key starts the next window', () => {
    const exact = fresh(), late = fresh(); const end = exact.snapshot().duel!.endsAt;
    exact.tick(end, view()); expect(complete(exact, 40, 0, end)).toContainEqual({ type: 'combo', clean: true });
    late.tick(end + 1, view()); expect(complete(late, 40, 0, end + 1)).toContainEqual({ type: 'parry' });
  });
  it('scales short/long windows with text length and has no maximum that penalizes passages', () => {
    const short = fresh(1), long = fresh(1000);
    expect(short.snapshot().duel!.endsAt).toBe(8000);
    expect(long.snapshot().duel!.endsAt).toBe(400000);
    expect(long.snapshot().duel!.packets).toBe(8);
  });
  it.each([['short', KNOWLEDGE_WORDS], ['long', KNOWLEDGE_PASSAGES]] as const)('lets every actual %s text finish at the same 2.5 accepted keys/second', (_kind, words) => {
    for (const word of words) {
      const session = new TypingSession(word.reading), keys = session.guide;
      const d = fresh(keys.length), deadline = d.snapshot().duel!.endsAt;
      for (let i = 0; i < keys.length; i++) {
        const at = i * 400;
        d.tick(at, view(keys.length - i));
        expect(session.input(keys[i]).accepted).toBe(true);
        d.acceptedKey(at, view(keys.length - i), i === keys.length - 1 ? view(40, 1) : view(session.guide.length - session.typed.length));
      }
      expect(session.complete).toBe(true);
      expect(deadline).toBeGreaterThanOrEqual(keys.length * 400);
      expect(d.wordDone({ index: 0, kana: word.reading.length, clean: true, gameMs: (keys.length - 1) * 400 }, view(40, 1)))
        .toContainEqual({ type: 'combo', clean: true });
    }
  });
  it('adjusts guard targets for alternate romaji instead of requiring the original spelling', () => {
    const d = fresh(3); complete(d, 3); d.acceptedKey(1001, view(3, 1), view(1, 1));
    expect(d.snapshot().duel!.target).toBe(2);
    d.acceptedKey(1002, view(1, 1), view(3, 2));
    expect(d.snapshot().duel!.accepted).toBe(2); expect(d.snapshot().duel!.target).toBe(2);
    expect(d.wordDone({ index: 1, kana: 1, clean: false, gameMs: 1002 }, view(3, 2))).toContainEqual({ type: 'parry' });
  });
  it('extends time for longer accepted spellings without moving an announced packet', () => {
    const d = fresh(30); complete(d, 30); const before = d.snapshot().duel!;
    d.acceptedKey(1001, view(30, 1), view(39, 1));
    const after = d.snapshot().duel!;
    expect(after.target).toBe(40); expect(after.endsAt).toBe(17000);
    expect(after.nextAt).toBe(before.nextAt);
    d.acceptedKey(1002, view(39, 1), view(20, 1));
    expect(d.snapshot().duel!.endsAt).toBe(17000);
  });
  it('duplicate word callbacks do not repeat bonuses and completed battles freeze', () => {
    const d = fresh(); complete(d); const hp = d.snapshot().hp;
    expect(d.wordDone({ index: 0, kana: 40, clean: true, gameMs: 1100 }, view(40, 1))).toEqual([]);
    expect(d.snapshot().hp).toBe(hp);
    for (let i = 1; i < 7; i++) complete(d, 40, i, 1100 + i);
    expect(d.snapshot().outcome).toBe('cleared');
    const done = d.snapshot(); d.tick(1000000, view()); d.acceptedKey(1000000, view(), view());
    expect(d.snapshot()).toEqual(done);
  });
  it('a paused Round excludes hidden-tab time and cannot deliver all packets on resume', () => {
    const r = new Round({ id: 'jp-duel-fixture', name: 'fixture', label: 'かな', words: [{ display: 'し', reading: 'し' }] }, {}, { mode: 'journey', wordLimit: 99, baselines: new Map(), seed: 1 });
    r.input('s', 1000); const d = fresh(40); complete(d); const before = d.snapshot();
    r.pause(2000); r.resume(62000);
    d.tick(r.elapsedMs(62100), view(40, 1));
    expect(r.elapsedMs(62100)).toBe(1100);
    expect(d.snapshot().duel!.remaining).toBe(before.duel!.remaining);
    expect(d.snapshot().duel!.guardHp).toBe(100);
  });
});
