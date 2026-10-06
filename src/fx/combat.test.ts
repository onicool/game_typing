import { describe, expect, it } from 'vitest';
import { combatPhase, crossedMilestone, COMBAT_CYCLE_MS, COMBAT_CONTACT_MS } from './combat';
import type { Word } from '../content/words';

describe('theatrical combat has predictable cues without deadlines', () => {
  it('orders anticipation, approach, guard and recovery with explicit boundaries', () => {
    for (const [time, expected] of [[0, 'idle'], [1199, 'idle'], [1200, 'windup'],
      [2299, 'windup'], [2300, 'approach'], [2679, 'approach'], [2680, 'guard'],
      [3279, 'guard'], [3280, 'recover'], [5199, 'recover'], [5200, 'idle']] as const) {
      expect(combatPhase(time).phase).toBe(expected);
      expect(combatPhase(time).progress).toBeGreaterThanOrEqual(0);
      expect(combatPhase(time).progress).toBeLessThan(1);
    }
  });
  it('alternates shield impact without randomness or missed-input conditions', () => {
    expect(combatPhase(COMBAT_CYCLE_MS + 2700).phase).toBe('impact');
    expect(combatPhase(COMBAT_CYCLE_MS * 2 + 2700).phase).toBe('guard');
    expect(combatPhase(-1).phase).toBe('idle');
  });
  it('keeps contact visible for 600ms without lengthening the whole cycle', () => {
    expect(COMBAT_CONTACT_MS).toBe(600);
    expect(combatPhase(2680 + COMBAT_CONTACT_MS - 1).phase).toBe('guard');
    expect(combatPhase(COMBAT_CYCLE_MS + 2680 + COMBAT_CONTACT_MS - 1).phase).toBe('impact');
    expect(combatPhase(COMBAT_CYCLE_MS).phase).toBe('idle');
  });
});
describe('passage milestones use actual kana progress', () => {
  const word: Word = { display: '仮の文', reading: 'ソラ。ミチ。ヒカリ。', segments: [
    { display: '空。', reading: 'ソラ。' }, { display: '道。', reading: 'ミチ。' },
    { display: '光。', reading: 'ヒカリ。' },
  ] };
  it('fires only when a non-final sentence boundary is crossed', () => {
    expect(crossedMilestone(word, 1, 2)).toBe(false);
    expect(crossedMilestone(word, 2, 3)).toBe(true);
    expect(crossedMilestone(word, 3, 3)).toBe(false);
    expect(crossedMilestone(word, 3, 4)).toBe(false);
    expect(crossedMilestone(word, 5, 6)).toBe(true);
    expect(crossedMilestone(word, 9, 10)).toBe(false);
  });
  it('does not turn ordinary word completion into a second milestone', () => {
    expect(crossedMilestone({ display: '空', reading: 'そら' }, 1, 2)).toBe(false);
    expect(crossedMilestone({ display: '空', reading: 'そら', segments: [{ display: '空', reading: 'そら' }] }, 1, 2)).toBe(false);
  });
});
