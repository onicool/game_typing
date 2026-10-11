import { describe, expect, it } from 'vitest';
import { Battle, type BattleConfig, type InputView } from './battle';
const config: BattleConfig = { character: 'elna', difficulty: 'standard', bossHp: 240, seed: 12 };
const view: InputView = { current: { index: 8, kana: 10 }, remainingKana: 10,
  previews: [{ index: 9, kana: 10 }, { index: 10, kana: 12 }] };
function boss(overrides: Partial<BattleConfig> = {}) { const b = new Battle({ ...config, ...overrides }); b.startBoss(0); return b; }
const done = (b: Battle, index: number, gameMs: number, kana = 10, clean = true) => b.wordDone({ index, kana, clean, gameMs }, view);
function missAttack(b: Battle, at: number) { b.tick(at, view); const due = b.snapshot().attack!.dueAt; return { events: b.tick(due + 1, view), time: due + 1 }; }

describe('game-time counterattacks', () => {
  it('never attacks before boss start and starts the first windup at exactly 3 seconds', () => {
    const b = new Battle(config); expect(b.tick(100000, view)).toEqual([]); b.startBoss(5000);
    expect(b.tick(7999, view)).toEqual([]); expect(b.tick(8000, view)[0].type).toBe('windup');
    expect(b.snapshot().attack!.marked).toEqual([9]);
    b.startBoss(10000); expect(b.snapshot().attack!.startedAt).toBe(8000);
  });
  it.each([-1, 0, 1])('resolves a marked word at deadline %+i ms without relying on render order', offset => {
    const b = boss(); b.tick(3000, view); const due = b.snapshot().attack!.dueAt;
    const tick = b.tick(due + offset, view); const events = done(b, 9, due + offset);
    expect([...tick, ...events].some(e => e.type === 'parry')).toBe(offset <= 0);
    expect(b.snapshot().stats.cracks).toBe(offset > 0 ? 1 : 0);
    expect(b.snapshot().stats.resolved).toBe(1);
  });
  it('does not count a canceled windup when victory and its deadline coincide', () => {
    const b = boss({ bossHp: 10 }); b.tick(3000, view); const due = b.snapshot().attack!.dueAt;
    expect(b.tick(due, view)).toEqual([]);
    expect(done(b, 8, due).at(-1)?.type).toBe('victory');
    expect(b.snapshot().stats.resolved).toBe(0); expect(b.snapshot().attack).toBe(null);
    expect(b.tick(due + 100, view)).toEqual([]);
  });
  it('keeps one attack fixed through phase change and marks two words every third phase-2 attack', () => {
    const b = boss({ bossHp: 100 }); b.tick(3000, view); const original = b.snapshot().attack;
    done(b, 8, 3100, 30); expect(b.snapshot().phase).toBe(2); expect(b.snapshot().attack).toEqual(original);
    let at = original!.dueAt + 1; b.tick(at, view);
    for (let i = 1; i <= 3; i++) {
      at += 4000; b.tick(at, view); const attack = b.snapshot().attack!;
      expect(attack.marked).toEqual(i === 3 ? [9, 10] : [9]);
      if (i === 3) {
        done(b, 9, at + 10, 1, false); expect(b.snapshot().stats.parries).toBe(0);
        done(b, 10, at + 20, 1, false); expect(b.snapshot().stats.parries).toBe(1);
      } else { at = attack.dueAt + 1; b.tick(at, view); }
    }
  });
  it('standard resets once per broken barrier and challenge defeats at the third crack', () => {
    for (const difficulty of ['standard', 'challenge'] as const) {
      const b = boss({ difficulty }); let at = 3000;
      for (let i = 0; i < 3; i++) { const result = missAttack(b, at); at = result.time + (difficulty === 'standard' ? 5000 : 3000); }
      const state = b.snapshot(); expect(state.stats.cracks).toBe(3); expect(state.hp).toBe(240);
      expect(state.stats.resets).toBe(difficulty === 'standard' ? 1 : 0);
      expect(state.outcome).toBe(difficulty === 'standard' ? null : 'lost');
      expect(b.tick(at - 1, view)).toEqual([]);
      expect(b.snapshot().stats.cracks).toBe(3);
    }
  });
  it('computes fallback, bounds and the 1.1x necessary-input-time floor', () => {
    const duration = (difficulty: BattleConfig['difficulty'], speed: number, remaining = 10) => {
      const b = boss({ difficulty, initialKanaPerSec: speed }); b.tick(3000, { ...view, remainingKana: remaining });
      return b.snapshot().attack!.dueAt - 3000;
    };
    expect(duration('standard', 2)).toBe(16000);
    expect(duration('challenge', 2)).toBe(11500);
    expect(duration('standard', 1000)).toBe(5000);
    expect(duration('challenge', 1000)).toBe(3500);
    expect(duration('standard', .1)).toBeCloseTo(220000);
    expect(duration('standard', NaN)).toBe(16000);
    const b = boss({ initialKanaPerSec: 3 }); b.routeWordDone({ kana: 5, durationMs: 0 }); expect(b.snapshot().kanaPerSec).toBe(3);
    b.routeWordDone({ kana: 6, durationMs: 2000 }); expect(b.snapshot().kanaPerSec).toBe(5.5);
    b.routeWordDone({ kana: 10, durationMs: 1000 }); b.routeWordDone({ kana: 2, durationMs: 1000 }); expect(b.snapshot().kanaPerSec).toBe(4.5);
  });
  it('has identical results with the same game-time inputs across a physical pause', () => {
    const sequence = () => { const b = boss(); b.routeWordDone({ kana: 10, durationMs: 4000 }); b.tick(3000, view);
      done(b, 8, 4000); b.tick(5000, view); done(b, 9, 6000); return b.snapshot(); };
    expect(sequence()).toEqual(sequence()); // A physical pause supplies no new game time or tick.
  });
});

describe('character abilities use clean words and kana', () => {
  it.each([[7, true, 8.75, null], [8, true, 14.4, 'judgment'], [8, false, 8, null]] as const)
  ('elna: %i kana, clean=%s', (kana, clean, amount, special) => {
    const b = boss(); expect(done(b, 8, 1000, kana, clean)[0]).toEqual({ type: 'damage', amount, special });
  });
  it('towa resets the streak on a miss, triggers every three clean words and restores one crack', () => {
    const b = boss({ character: 'towa' }); const missed = missAttack(b, 3000);
    done(b, 8, missed.time + 1); done(b, 9, missed.time + 2, 10, false);
    expect(b.snapshot().ringStreak).toBe(0);
    done(b, 10, missed.time + 3); done(b, 11, missed.time + 4);
    const events = done(b, 12, missed.time + 5);
    expect(events).toContainEqual({ type: 'damage', amount: 22.5, special: 'ring' });
    expect(events).toContainEqual({ type: 'restore', cracks: 0 });
    expect(b.snapshot().stats.specials).toBe(1); expect(b.snapshot().ringStreak).toBe(0);
    expect(done(b, 12, missed.time + 6)).toEqual([]);
  });
  it('snapshots cannot mutate the rules', () => {
    const b = boss(); b.tick(3000, view); const s = b.snapshot(); s.hp = 0; s.attack!.marked.push(77); s.stats.resets = 99;
    expect(b.snapshot().hp).toBe(240); expect(b.snapshot().attack!.marked).toEqual([9]); expect(b.snapshot().stats.resets).toBe(0);
  });
});
