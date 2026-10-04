import { describe, expect, it } from 'vitest';
import { BenchmarkSource, isProbeWord, PatchSource, targetsInWord, type Pick } from './select';
import { DICTIONARIES, wordId, WordStream, type Dictionary, type Word } from '../content/words';
import type { Vuln } from './types';

const dictId = 'jp-select';
const words: Word[] = Array.from({ length: 120 }, (_, i) => ({
  display: `word-${i}`, reading: i < 60 ? 'しかし' : 'しあいうえおかきくけこ',
}));
const vuln = (label = 's→i', overrides: Partial<Vuln> = {}): Vuln => ({
  id: 'VULN-0001', kind: 'bigram', label, excessMs: 40, missExcess: 0,
  impact: 100, severity: 'HIGH', n: 200, ...overrides,
});
const collect = (source: { next(): Pick }, n: number): Pick[] => Array.from({ length: n }, () => source.next());
const dictionary = (pool: Word[]): Dictionary => ({ id: dictId, words: pool, name: 'test', label: 'test' });

describe('seeded benchmark selection', () => {
  it('replays seeds, deduplicates displays and assigns stable ids/probabilities', () => {
    const dict = dictionary([...words, words[0]]);
    const a = collect(new BenchmarkSource(dict, 42), 240);
    expect(a).toEqual(collect(new BenchmarkSource(dict, 42), 240));
    expect(a.map(p => p.id)).not.toEqual(collect(new BenchmarkSource(dict, 43), 240).map(p => p.id));
    expect(new Set(a.slice(0, 120).map(p => p.id)).size).toBe(120);
    expect(a.every(p => p.role === 'ordinary' && p.target === null && p.prob === 1 / 120
      && p.id === wordId(dictId, p.word.display))).toBe(true);
    expect(DICTIONARIES.find(d => d.id === 'en-core')!.words.filter(w => w.display === 'signal')).toHaveLength(1);
  });

  it('balances short and long halves in blocks and observes an eight-pick cooldown', () => {
    const source = new WordStream(dictionary(words), 123);
    const picks = Array.from({ length: 360 }, () => source.next());
    for (let i = 0; i < picks.length; i++) {
      expect(picks.slice(Math.max(0, i - 8), i).some(p => p.id === picks[i].id)).toBe(false);
    }
    for (let i = 0; i < 120; i += 10) {
      expect(picks.slice(i, i + 10).filter(p => p.reading.length < 10)).toHaveLength(5);
    }
  });
});

describe('patch selection', () => {
  it('uses guide preferences for bigrams without changing literal English case', () => {
    expect(targetsInWord('し', { 'し': 'si' })).toEqual(['s', 'i', 's→i']);
    expect(targetsInWord('し', { 'し': 'shi' })).toContain('h→i');
    expect(targetsInWord('し', { 'し': 'shi' })).not.toContain('s→i');
    expect(targetsInWord('Ab', {})).toContain('A→b');
    const si = new PatchSource(words, dictId, [vuln()], { 'し': 'si' }, { seed: 4 });
    const shi = new PatchSource(words, dictId, [vuln()], { 'し': 'shi' }, { seed: 4 });
    expect(collect(si, 20).filter(p => p.role === 'weak')).toHaveLength(6);
    expect(collect(shi, 20).filter(p => p.role === 'weak')).toHaveLength(0);
    expect(shi.shortages).toBe(8); // No matching weak words or held-out confirmations.
    const hi = new PatchSource(words, dictId, [vuln('h→i')], { 'し': 'shi' }, { seed: 4 });
    expect(collect(hi, 20).filter(p => p.role === 'weak')).toHaveLength(6);
  });

  it('repeats 12 ordinary / 6 weak / 2 probe slots with all caps and replayable picks', () => {
    const source = new PatchSource(words, dictId, [vuln()], { 'し': 'si' }, { seed: 15 });
    const picks = collect(source, 400);
    expect(picks).toEqual(collect(new PatchSource(words, dictId, [vuln()], { 'し': 'si' }, { seed: 15 }), 400));
    for (let i = 0; i < picks.length; i += 20) {
      const block = picks.slice(i, i + 20);
      expect(block.filter(p => p.role === 'ordinary')).toHaveLength(12);
      expect(block.filter(p => p.role === 'weak')).toHaveLength(6);
      expect(block.filter(p => p.role === 'probe')).toHaveLength(2);
    }
    let weakRun = 0;
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      weakRun = p.role === 'weak' ? weakRun + 1 : 0;
      expect(weakRun).toBeLessThanOrEqual(2);
      expect(picks.slice(Math.max(0, i - 8), i).some(previous => previous.id === p.id)).toBe(false);
      expect(isProbeWord(p.id)).toBe(p.role === 'probe');
      expect(p.prob).toBeGreaterThan(0);
      expect(p.prob).toBeLessThanOrEqual(1);
      if (p.target) expect(targetsInWord(p.word.reading, { 'し': 'si' })).toContain(p.target);
    }
    const ordinary = picks.filter(p => p.role === 'ordinary');
    expect(ordinary.filter(p => p.word.reading.length < 10).length / ordinary.length).toBeGreaterThan(0.7);
    expect(source.shortages).toBe(0);
  });

  it('refreshes weak and probe eligibility when shared spelling preferences change', () => {
    const prefs = { 'し': 'si' };
    const source = new PatchSource(words, dictId, [vuln()], prefs, { seed: 4 });
    expect(collect(source, 20).filter(p => p.role === 'weak')).toHaveLength(6);

    prefs['し'] = 'shi';
    const changed = collect(source, 40);
    for (const pick of changed) {
      if (pick.target) expect(targetsInWord(pick.word.reading, prefs)).toContain(pick.target);
    }
    expect(changed.every(p => p.role === 'ordinary' && p.target === null)).toBe(true);
    expect(source.shortages).toBe(16);

    prefs['し'] = 'si';
    const restored = collect(source, 20);
    expect(restored.filter(p => p.role === 'weak')).toHaveLength(6);
    expect(restored.filter(p => p.role === 'probe')).toHaveLength(2);
  });

  it('admits newly matching words and holdouts after a preference change', () => {
    const prefs = { 'し': 'si' };
    const source = new PatchSource(words, dictId, [vuln('h→i')], prefs, { seed: 4 });
    expect(collect(source, 20).every(p => p.role === 'ordinary')).toBe(true);
    prefs['し'] = 'shi';
    const picks = collect(source, 20);
    expect(picks.filter(p => p.role === 'weak')).toHaveLength(6);
    expect(picks.filter(p => p.role === 'probe')).toHaveLength(2);
    for (const pick of picks) {
      if (pick.target) expect(targetsInWord(pick.word.reading, prefs)).toContain(pick.target);
    }
  });

  it('keeps probe choice independent of weakness scores/focus and prefers unseen matching ids', () => {
    const a = collect(new PatchSource(words, dictId, [vuln(), vuln('k→a')], { 'し': 'si' }, { seed: 17 }), 160).filter(p => p.role === 'probe');
    const b = collect(new PatchSource(words, dictId, [vuln('k→a', { impact: 20000 }), vuln('s→i', { n: 1 })],
      { 'し': 'si' }, { seed: 9, focus: 'k→a' }), 160).filter(p => p.role === 'probe');
    expect(a).toEqual(b);
    expect(a.every(p => p.target === 's→i' || p.target === 'k→a')).toBe(true);
    const poolSize = words.filter(w => isProbeWord(wordId(dictId, w.display))).length;
    expect(new Set(a.slice(0, poolSize).map(p => p.id)).size).toBe(Math.min(poolSize, a.length));
    const fraction = Array.from({ length: 10000 }, (_, i) => isProbeWord(`id-${i}`)).filter(Boolean).length / 10000;
    expect(fraction).toBeGreaterThan(0.13);
    expect(fraction).toBeLessThan(0.17);
  });

  it('explores uncertain targets and applies the fixed focus boost', () => {
    const vulns = [vuln(), vuln('k→a', { impact: 0, n: 1, severity: 'INVESTIGATING' })];
    const count = (focus?: string) => collect(new PatchSource(words, dictId, vulns, { 'し': 'si' }, { seed: 27, focus }), 1000)
      .filter(p => p.role === 'weak' && p.target === 'k→a').length;
    expect(count()).toBeGreaterThan(10);
    expect(count('k→a')).toBeGreaterThan(count());
  });

  it('falls back to ordinary when weak or probe pools are unavailable and counts shortages', () => {
    const nonProbes = words.filter(w => !isProbeWord(wordId(dictId, w.display)));
    const source = new PatchSource(nonProbes, dictId, [vuln('z→z')], {}, { seed: 3 });
    const picks = collect(source, 40);
    expect(picks.every(p => p.role === 'ordinary' && !isProbeWord(p.id))).toBe(true);
    expect(source.shortages).toBe(16);
    for (let i = 0; i < picks.length; i++) {
      expect(picks.slice(Math.max(0, i - 8), i).some(p => p.id === picks[i].id)).toBe(false);
    }
  });

  it('falls back when target words are on cooldown and preserves holdouts even for tiny pools', () => {
    const nonProbes = words.filter(w => !isProbeWord(wordId(dictId, w.display)));
    const pool = nonProbes.map((w, i) => ({ ...w, reading: i < 2 ? 'か' : 'あ' }));
    const source = new PatchSource(pool, dictId, [vuln('k→a')], {}, { seed: 3 });
    collect(source, 40);
    expect(source.shortages).toBeGreaterThan(4); // Two missing probes plus weak cooldown shortages per block.
    expect(source.cooldownRelaxations).toBe(0);
    const tiny = new PatchSource(pool.slice(0, 1), dictId, [], {}, { seed: 3 });
    expect(collect(tiny, 20).every(p => p.role === 'ordinary' && !isProbeWord(p.id))).toBe(true);
    expect(tiny.cooldownRelaxations).toBeGreaterThan(0);
    expect(() => new PatchSource(words.filter(w => isProbeWord(wordId(dictId, w.display))), dictId, [], {}, { seed: 3 }))
      .toThrow('non-probe');
  });
});
