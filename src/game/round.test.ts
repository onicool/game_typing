import { describe, expect, it } from 'vitest';
import { Round, ROUND_MS } from './round';
import type { Dictionary } from '../content/words';

const LONG = 'かきくけこさしすせそたちつてと';
const dict = (reading = LONG, id = 'jp-test'): Dictionary => ({ id, name: 't', label: 't', words: [{ display: reading, reading }] });

/** Types the guide of the current word key by key; interval(i) gives the gap before key i. */
function typeKeys(r: Round, count: number, interval: (i: number) => number, start = 0, transform = (k: string) => k) {
  let t = start;
  for (let i = 0; i < count; i++) {
    const s = r.session;
    const k = s.guide[s.typed.length];
    t += interval(i);
    r.input(transform(k), t);
  }
  return t;
}

describe('Round', () => {
  it('ignores keys after the deadline even before the next frame', () => {
    const r = new Round(dict('あい'), {});
    r.input('a', 0);
    const out = r.input('i', ROUND_MS + 1);
    expect(out.late).toBe(true);
    expect(out.accepted).toBe(false);
    expect(r.finished).toBe(true);
    expect(r.wordsDone).toBe(0);
    expect(r.input('i', ROUND_MS + 2).late).toBe(true);
  });

  it('zero-length intervals do not poison overclock', () => {
    const r = new Round(dict(), {});
    r.input('k', 0);
    r.input('a', 0); // same timestamp
    typeKeys(r, 120, () => 100, 0);
    expect(r.stage).toBeGreaterThan(0);
  });

  it('final speed counts the half-typed last word', () => {
    const r = new Round(dict('あいう'), {});
    r.input('a', 0);
    r.input('i', 100);
    r.input('x', ROUND_MS); // ends the round
    expect(r.result().kanaPerSec).toBeCloseTo(2 / 60, 5);
  });

  it('letter case does not change rhythm detection for kana', () => {
    const lower = new Round(dict(), {});
    const upper = new Round(dict(), {});
    const gap = (i: number) => (i % 2 ? 60 : 140);
    typeKeys(lower, 150, gap);
    typeKeys(upper, 150, gap, 0, (k) => k.toUpperCase());
    expect(upper.stage).toBe(lower.stage);
    expect(upper.log.every((e) => e.key === e.key.toLowerCase())).toBe(true);
  });

  it('a sustained slowdown loses overclock', () => {
    const r = new Round(dict(), {});
    const t = typeKeys(r, 120, () => 100);
    expect(r.stage).toBeGreaterThan(0);
    typeKeys(r, 80, () => 400, t);
    expect(r.stage).toBe(0);
  });

  it('erratic rhythm brings stage 1 down to 0', () => {
    const r = new Round(dict(), {});
    const t = typeKeys(r, 120, () => 100);
    expect(r.stage).toBeGreaterThan(0);
    typeKeys(r, 120, (i) => (i % 2 ? 20 : 600), t);
    expect(r.stage).toBe(0);
  });

  it('criticals are faster than the transition baseline with a positive gain', () => {
    const r = new Round(dict(), {});
    let t = typeKeys(r, 100, () => 120);
    let crit = 0;
    for (let i = 0; i < 30; i++) {
      const k = r.session.guide[r.session.typed.length];
      t += i % 5 === 4 ? 40 : 120;
      const out = r.input(k, t);
      if (out.critical) {
        crit++;
        expect(out.criticalGainMs).toBeGreaterThan(0);
      }
    }
    expect(crit).toBeGreaterThan(0);
  });

  it('attributes misses to the key eventually typed', () => {
    const r = new Round(dict('か'), {});
    r.input('q', 0);
    r.input('q', 10);
    r.input('k', 20);
    expect(r.log.filter((e) => !e.correct).every((e) => e.intended === 'k')).toBe(true);
  });

  it('keeps case for literal (English) attribution', () => {
    const r = new Round({ id: 'en-test', name: 't', label: 't', words: [{ display: 'Ab', reading: 'Ab' }] }, {});
    r.input('a', 0);
    r.input('A', 10);
    expect(r.log[0].intended).toBe('A');
  });
});
