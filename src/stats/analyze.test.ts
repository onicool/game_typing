import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { FINGER } from './layout';
import { loadEvents, loadSessions, saveSession } from './store';
import type { StoredKey } from './types';

function event(from = 'k', to = 'y', dt = 100, overrides: Partial<StoredKey> = {}): StoredKey {
  return {
    session: 'round-1', t: 100, key: to, code: `Key${to.toUpperCase()}`,
    correct: true, expected: [to], prevKey: from, dt,
    wordStart: false, afterMiss: false, intended: null, mode: 'benchmark', dict: 'jp-core',
    ...overrides,
  };
}

function repeated(from: string, to: string, dt: number, n: number): StoredKey[] {
  return Array.from({ length: n }, (_, i) => event(from, to, dt, { t: i * dt }));
}

describe('weakness analysis', () => {
  it('ranks a frequent 120ms slower bigram first with high severity', () => {
    const report = analyze([
      ...repeated('k', 'y', 220, 200), ...repeated('j', 'o', 100, 400),
      ...repeated('l', 'u', 100, 400), ...repeated('f', 'j', 100, 400),
    ]);
    expect(report.vulns[0]).toMatchObject({ kind: 'bigram', label: 'k→y' });
    expect(['HIGH', 'CRITICAL']).toContain(report.vulns[0].severity);
    expect(report.vulns[0].impact).toBeGreaterThan(60);
    expect(report.overallLatencyMs).toBe(100);
    expect(report.vulns.map(v => v.impact)).toEqual([...report.vulns.map(v => v.impact)].sort((a, b) => b - a));
    expect(report.vulns.some(v => v.kind === 'key' && v.label === 'y')).toBe(false);
  });

  it('does not rate pure timing noise or a couple of chance slips as HIGH or worse', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pairs = ['ka', 'ki', 'ku', 'ou', 'su', 'sh', 'hi', 'ta', 'to', 'no', 'ni', 'ai'];
    const events: StoredKey[] = [];
    for (let i = 0; i < 1200; i++) {
      const [from, to] = pairs[i % pairs.length];
      events.push(event(from, to, 85 + rnd() * 25, { t: i * 100 }));
    }
    // two chance slips on one frequent pair
    events.push(event('o', 'q', 100, { correct: false, intended: 'u', expected: ['u'] }));
    events.push(event('o', 'q', 100, { correct: false, intended: 'u', expected: ['u'] }));
    const report = analyze(events);
    expect(report.vulns.filter(v => v.severity === 'HIGH' || v.severity === 'CRITICAL')).toEqual([]);
  });

  it('keeps sparse targets investigating and shrinks their log latency', () => {
    const report = analyze([...repeated('k', 'y', 500, 3), ...repeated('j', 'o', 100, 200)]);
    const vuln = report.vulns.find(v => v.label === 'k→y')!;
    const pair = report.bigrams.find(b => b.from === 'k' && b.to === 'y')!;
    expect(vuln.severity).toBe('INVESTIGATING');
    expect(vuln.n).toBe(3);
    expect(vuln.excessMs).toBeGreaterThan(0);
    expect(vuln.excessMs).toBeLessThan(400);
    expect(pair.latencyMs).toBeGreaterThan(100);
    expect(pair.latencyMs).toBeLessThan(250);
  });

  it('attributes misses to intended keys/pairs, never the accidentally pressed key', () => {
    const report = analyze([
      ...repeated('k', 'y', 100, 10), ...repeated('j', 'o', 100, 100),
      event('k', 'z', 200, { t: 1200, correct: false, intended: 'y' }),
      event('k', 'x', 250, { t: 1250, correct: false, intended: 'y' }),
      event('k', 'y', 600, { t: 1800, afterMiss: true }),
      event('k', '?', 200, { t: 1900, correct: false, intended: null }),
    ]);
    const key = report.keys.find(k => k.key === 'y')!;
    const pair = report.bigrams.find(b => b.from === 'k' && b.to === 'y')!;
    expect(key.misses).toBe(2);
    expect(key.n).toBe(13);
    expect(report.keys.some(k => ['z', 'x', '?'].includes(k.key))).toBe(false);
    // shrunk toward the baseline, but the attributed pair still sits above the overall miss rate
    expect(pair.missRate).toBeGreaterThan(3 / 114);
    expect(pair.missRate).toBeLessThan(2 / 21);
    expect(pair.latencyMs).toBeCloseTo(100);
    expect(report.accuracy).toBeCloseTo(111 / 114);
  });

  it('returns a zero report for empty input or an unmatched dictionary', () => {
    const empty = { sample: 0, sessions: 0, overallLatencyMs: 0, accuracy: 0,
      keys: [], bigrams: [], vulns: [], trend: [] };
    expect(analyze([])).toEqual(empty);
    expect(analyze([event()], { dict: 'missing' })).toEqual(empty);
  });

  it('excludes boundaries, recoveries, interruptions and invalid dt from latency only', () => {
    const report = analyze([
      event('k', 'y', 100), event('k', 'y', 200),
      event('k', 'y', 2000, { wordStart: true }), event('k', 'y', 2000, { afterMiss: true }),
      ...[0, -1, 3000, 5000, NaN, Infinity].map(dt => event('k', 'y', dt)),
    ]);
    expect(report.sample).toBe(10);
    expect(report.keys[0].n).toBe(10);
    expect(report.overallLatencyMs).toBe(150);
    expect(report.bigrams[0].latencyMs).toBeCloseTo(Math.sqrt(100 * 200));
    expect(report.accuracy).toBe(1);
  });

  it('uses separate hands/fingers and a global group for unknown symbols safely', () => {
    expect(Object.keys(FINGER)).toHaveLength(41);
    for (const key of 'abcdefghijklmnopqrstuvwxyz0123456789-,./;') expect(FINGER[key]).toBeDefined();
    expect(FINGER.f.hand).not.toBe(FINGER.j.hand);
    expect(FINGER.f.finger).toBe(FINGER.j.finger);
    const report = analyze([
      ...repeated('f', 'j', 100, 30), ...repeated('j', 'u', 300, 30),
      ...repeated('🤖', '§', 200, 10), event('__proto__', 'constructor', 200),
      event('k', '§', 500, { wordStart: true }),
    ]);
    expect(report.keys.some(k => k.key === '§')).toBe(true);
    for (const stat of [...report.keys, ...report.bigrams]) {
      expect(Number.isFinite(stat.latencyMs)).toBe(true);
      expect(Number.isFinite(stat.missRate)).toBe(true);
    }
    const rightSameFinger = report.vulns.find(v => v.label === 'j→u')!;
    expect(rightSameFinger.excessMs).toBeLessThan(50);
  });

  it('keeps key incoming weights fixed instead of following prompt frequencies', () => {
    const a = analyze([...repeated('k', 'y', 220, 800), ...repeated('j', 'y', 100, 800)]);
    const b = analyze([...repeated('k', 'y', 220, 8000), ...repeated('j', 'y', 100, 800)]);
    const keyA = a.keys.find(k => k.key === 'y')!;
    const keyB = b.keys.find(k => k.key === 'y')!;
    // Include controls to fix the matched group prior, then swap incoming mix.
    const controls = [...repeated('l', 'u', 100, 30000), ...repeated('h', 'u', 100, 30000),
      ...repeated('a', 'y', 100, 30000)];
    const fixedA = analyze([...controls, ...repeated('k', 'y', 220, 800), ...repeated('j', 'y', 100, 800)]);
    const fixedB = analyze([...controls, ...repeated('k', 'y', 220, 8000), ...repeated('j', 'y', 100, 800)]);
    expect(Math.abs(fixedA.keys.find(k => k.key === 'y')!.latencyMs
      - fixedB.keys.find(k => k.key === 'y')!.latencyMs)).toBeLessThan(Math.abs(keyB.latencyMs - keyA.latencyMs));
  });

  it('retains a key-level weakness spread across several incoming transitions', () => {
    const events: StoredKey[] = [];
    for (const from of Object.keys(FINGER)) {
      for (const to of Object.keys(FINGER)) events.push(...repeated(from, to, to === 'y' ? 220 : 100, 20));
    }
    const report = analyze(events);
    expect(report.vulns[0]).toMatchObject({ kind: 'key', label: 'y', severity: 'CRITICAL' });
    expect(report.keys.find(k => k.key === 'y')!.latencyMs).toBeGreaterThan(170);
  });

  it('uses per-session recovery medians even for unordered, interleaved input', () => {
    const controls = repeated('j', 'o', 100, 100);
    const misses = Array.from({ length: 10 }, (_, i) => event('k', 'z', 100, {
      session: `miss-${i}`, t: 100, correct: false, intended: 'y',
    }));
    const accepted = misses.map(m => event('k', 'y', 500, { session: m.session, t: 500, afterMiss: true }));
    const clean = repeated('k', 'y', 100, 10);
    const a = analyze([...controls, ...accepted, ...misses, ...clean]);
    const b = analyze([...controls, ...accepted.map(e => ({ ...e, t: 900 })), ...misses, ...clean]);
    const va = a.vulns.find(v => v.label === 'k→y')!;
    const vb = b.vulns.find(v => v.label === 'k→y')!;
    expect(va.excessMs).toBeCloseTo(0);
    expect(va.missExcess).toBeGreaterThan(0);
    expect(vb.impact).toBeCloseTo(2 * va.impact);
  });

  it('uses the 600ms recovery fallback when misses remain unresolved', () => {
    const report = analyze([
      ...repeated('j', 'o', 100, 100), ...repeated('k', 'y', 100, 10),
      ...Array.from({ length: 10 }, () => event('k', 'z', 100, {
        session: 'unrecovered', correct: false, intended: 'y',
      })),
    ]);
    const vuln = report.vulns.find(v => v.label === 'k→y')!;
    expect(vuln.impact).toBeCloseTo(1000 * (10 / 110) * 600 * vuln.missExcess);
  });

  it('filters dictionaries and uses input session order, never comparing session-local timestamps', () => {
    const report = analyze([
      event('k', 'y', 100, { session: 'older', t: 90000 }),
      event('k', 'y', 150, { session: 'newer', t: 10 }),
      event('k', 'y', 999, { session: 'other', dict: 'en' }),
    ], { dict: 'jp-core' });
    expect(report.sample).toBe(2);
    expect(report.sessions).toBe(2);
    expect(report.trend.map(t => t.session)).toEqual(['older', 'newer']);
    expect(report.trend.map(t => t.latencyMs)).toEqual([100, 150]);
    expect(report.trend.every(t => t.kanaPerSec === undefined)).toBe(true);
  });

  it('handles no clean transitions without invented latency', () => {
    const report = analyze([
      event('k', 'y', NaN, { wordStart: true }),
      event('k', 'z', 100, { correct: false, intended: 'y' }),
    ]);
    expect(report.overallLatencyMs).toBe(0);
    expect(report.keys[0].latencyMs).toBe(0);
    expect(report.bigrams[0].latencyMs).toBe(0);
    expect(report.vulns.every(v => v.impact === 0)).toBe(true);
  });

  it('keeps stable target ids and limits vulnerabilities to the top twelve', () => {
    const events = Array.from({ length: 30 }, (_, i) => event('k', String(i), 100 + i, { t: i * 100 }));
    const first = analyze(events), second = analyze([...events].reverse());
    expect(first.vulns).toHaveLength(12);
    for (const vuln of first.vulns) {
      expect(vuln.id).toMatch(/^VULN-\d{4}$/);
      expect(second.vulns.find(v => v.label === vuln.label)?.id).toBe(vuln.id);
    }
  });

  it('analyzes 200k events in less than 300ms without mutating input', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const events = Array.from({ length: 200000 }, (_, i) => event(
      letters[i % 26], letters[Math.floor(i / 26) % 26], 80 + i % 160,
      { session: `perf-${Math.floor(i / 2000)}`, t: (i % 2000) * 150 },
    ));
    analyze(events.slice(0, 2000)); // Warm the JIT; fixture construction is not timed.
    const start = performance.now();
    const report = analyze(events);
    const elapsed = performance.now() - start;
    expect(report.sample).toBe(200000);
    expect(report.sessions).toBe(100);
    expect(report.bigrams).toHaveLength(26 * 26);
    expect(elapsed).toBeLessThan(300);
    expect(events[0].t).toBe(0);
    expect(events[199999].t).toBe(1999 * 150);
  });
});

describe('storage memory fallback (no IndexedDB dependency)', () => {
  it('saves, replaces, filters and chronologically loads defensive copies', async () => {
    const meta = (session: string, dict: string, endedAt: number) => ({
      session, dict, mode: 'benchmark', kanaPerSec: 4, accuracy: 0.9, endedAt,
    });
    const later = event('k', 'y', 100, { session: 'store-later', dict: 'storage-test' });
    await saveSession([later], meta(later.session, later.dict, 200));
    later.expected.push('mutated');
    const earlier = event('j', 'o', 100, { session: 'store-earlier', dict: 'storage-test' });
    await saveSession([earlier], meta(earlier.session, earlier.dict, 100));
    await saveSession([event('a', 'b', 100, { session: 'store-other', dict: 'other-dict' })], meta('store-other', 'other-dict', 50));
    let loaded = await loadEvents('storage-test');
    expect(loaded.map(e => e.session)).toEqual(['store-earlier', 'store-later']);
    expect(loaded[1].expected).toEqual(['y']);
    loaded[1].expected.push('changed');
    expect((await loadEvents('storage-test'))[1].expected).toEqual(['y']);
    expect((await loadSessions('storage-test')).map(s => s.endedAt)).toEqual([100, 200]);
    const replacement = event('f', 'j', 100, { session: 'store-later', dict: 'storage-test' });
    await saveSession([replacement], meta(replacement.session, replacement.dict, 300));
    loaded = await loadEvents('storage-test');
    expect(loaded).toHaveLength(2);
    expect(loaded[1].key).toBe('j');
    expect(await loadEvents('absent')).toEqual([]);
  });
});
