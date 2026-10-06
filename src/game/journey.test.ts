import { describe, expect, it } from 'vitest';
import { Round } from './round';
import { normalizeReading } from '../engine/romaji';
import { PLACES, RecentSpeed, journeyDictionary, journeySource } from './journey';

describe('finite angel routes reuse Round', () => {
  it.each(PLACES.map((p, i) => [p.key, i] as const))('%s preserves two previews and all accepted kana beyond 60 seconds', (_, i) => {
    const dict = journeyDictionary(i), r = new Round(dict, {}, { mode: 'journey', source: journeySource(dict), baselines: new Map() });
    let t = 0;
    for (let n = 0; n < 5; n++) {
      expect(r.word).toBe(dict.words[n]);
      expect(r.nextWord).toBe(dict.words[(n + 1) % 5]);
      expect(r.followingWord).toBe(dict.words[(n + 2) % 5]);
      const guide = r.session.guide;
      for (const key of guide) r.input(key, t += 1100);
      expect(r.finished).toBe(n === 4);
    }
    const kana = dict.words.reduce((sum, w) => sum + normalizeReading(w.reading).length, 0);
    expect(r.elapsedMs(t)).toBeGreaterThan(60000);
    expect(r.totalKana()).toBe(kana);
    expect(r.result().kanaPerSec).toBeCloseTo(kana / ((t - 1100) / 1000));
    expect(r.input('x', t + 1).late).toBe(true);
    expect(r.wordsDone).toBe(5);
    expect(r.log.every(e => e.correct && e.expected.includes(e.key))).toBe(true);
  });
  it('freezes a partial finish while paused and excludes the resumed timing gap', () => {
    const d = journeyDictionary(0), r = new Round(d, {}, { mode: 'journey', source: journeySource(d), baselines: new Map() });
    r.input('s', 100); r.input('o', 200); r.pause(300); r.resume(100300);
    r.input('r', 100400);
    expect(r.log.at(-1)?.afterPause).toBe(true);
    expect(Number.isNaN(r.log.at(-1)!.dt)).toBe(true);
    r.pause(100500); r.finish(900000);
    expect(r.endT).toBe(100500); expect(r.elapsedMs(900000)).toBe(400);
    expect(r.wordsDone).toBe(0); expect(r.totalKana()).toBe(1);
  });
  it.each([0, -1, Infinity, NaN, 1.5])('rejects invalid word limit %s', wordLimit => {
    expect(() => new Round(journeyDictionary(0), {}, { mode: 'journey', wordLimit })).toThrow();
  });
  it('resets the live key-rate window after pause and shows zero when idle', () => {
    const speed = new RecentSpeed(); speed.accepted(100, false); speed.accepted(300, false);
    expect(speed.value(300)).toBe(5); expect(speed.value(2301)).toBe(0);
    speed.accepted(100000, true); expect(speed.value(100000)).toBe(0);
    speed.accepted(100200, false); expect(speed.value(100200)).toBe(5);
    speed.accepted(100200, false); expect(speed.value(100200)).toBe(5);
  });
});
