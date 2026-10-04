import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBaselines, updateBaselines } from './baselines';
import type { KeyLog } from '../game/round';

const event = (dt: number, overrides: Partial<KeyLog> = {}): KeyLog => ({
  t: 100, key: 'a', code: 'KeyA', correct: true, expected: ['a'], prevKey: 'k',
  dt, wordStart: false, afterMiss: false, intended: null, ...overrides,
});
function mockStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } });
  return data;
}
afterEach(() => vi.unstubAllGlobals());

describe('persistent personal baselines', () => {
  it('uses geometric means, keeps dictionaries separate, and returns independent snapshots', () => {
    mockStorage();
    updateBaselines('jp-test', [event(100), event(400)]);
    expect(loadBaselines('jp-test').get('ka')!.n).toBe(2);
    expect(loadBaselines('jp-test').get('ka')!.meanLog).toBeCloseTo(Math.log(200));
    expect(loadBaselines('en-test').size).toBe(0);
    const snapshot = loadBaselines('jp-test');
    snapshot.get('ka')!.meanLog = 0;
    expect(loadBaselines('jp-test').get('ka')!.meanLog).toBeCloseTo(Math.log(200));
  });

  it('excludes misses, boundaries, recovery, pause, invalid timings and other dictionaries', () => {
    mockStorage();
    updateBaselines('jp-test', [event(100), event(900, { correct: false }), event(900, { wordStart: true }),
      event(900, { afterMiss: true }), event(900, { afterPause: true }), event(100, { prevKey: null }),
      ...[NaN, Infinity, 0, -10, 3000].map(dt => event(dt))]);
    updateBaselines('jp-test', [{ ...event(900), dict: 'other', session: 'other', mode: 'benchmark' }]);
    expect(loadBaselines('jp-test').get('ka')).toEqual({ n: 1, meanLog: Math.log(100) });
  });

  it('caps effective count at 200 while adapting to later timings', () => {
    mockStorage();
    updateBaselines('jp-test', Array.from({ length: 500 }, () => event(100)));
    const before = loadBaselines('jp-test').get('ka')!;
    expect(before.n).toBe(200);
    updateBaselines('jp-test', [event(400)]);
    const after = loadBaselines('jp-test').get('ka')!;
    expect(after.n).toBe(200);
    expect(after.meanLog).toBeCloseTo(Math.log(100) + Math.log(4) / 200);
  });

  it('fails soft for unavailable storage and ignores malformed persisted data', () => {
    const data = mockStorage();
    const key = 'icebreaker-baselines-v1:jp-test';
    data.set(key, '{broken');
    expect(loadBaselines('jp-test').size).toBe(0);
    data.set(key, JSON.stringify([['ka', { n: 800, meanLog: Math.log(100) }],
      ['bad', { n: -1, meanLog: 1 }], ['bad2', { n: 8, meanLog: null }], ['bad3', {}], null]));
    expect([...loadBaselines('jp-test')]).toEqual([['ka', { n: 200, meanLog: Math.log(100) }]]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); } });
    expect(loadBaselines('jp-test').size).toBe(0);
    expect(() => updateBaselines('jp-test', [event(100)])).not.toThrow();
  });
});
