import { describe, expect, it } from 'vitest';
import { chapterDictionary } from '../content/chapters';
import type { SessionMeta } from '../stats/store';
import type { StoredKey } from '../stats/types';
import { PatchSource } from '../stats/select';
import { Battle } from './battle';
import { ChapterSource } from './chapter';
import { Round } from './round';
import { bossFields, bossPracticeDictionary, compareBossRecords, readBossMeasure, trainingBossSource, trainingFocus } from './training';

const event = (from: string, key: string, dt: number, i: number): StoredKey => ({ session: 'before', dict: 'jp-angel-town', mode: 'practice', t: i * 300,
  key, code: '', correct: true, expected: [key], prevKey: from, dt, wordStart: false, afterMiss: false, intended: null });
const before: SessionMeta = { session: 'before', dict: 'jp-angel-town', mode: 'practice', endedAt: 1, kanaPerSec: 2, accuracy: .95,
  character: 'elna', difficulty: 'challenge', seed: 42, scope: 'chapter', outcome: 'lost', routeVersion: 2,
  bossAttempts: 10, bossAccuracy: .8, bossParries: 1, bossResolved: 4, bossCracks: 3, bossResets: 0 };
const after: SessionMeta = { ...before, session: 'after', scope: 'boss', outcome: 'cleared', parentSession: 'before', trainingSession: 'practice',
  bossAccuracy: 1, bossParries: 3, bossResolved: 3, bossCracks: 0 };

describe('Sera practice and the return to the same boss', () => {
  it('compares the same supported seraph rules and refuses missing or different hard versions', () => {
    const a = { ...before,difficulty:'seraph' as const,seraphVersion:1 }, b = { ...after,difficulty:'seraph' as const,seraphVersion:1 };
    expect(compareBossRecords(a,b)).not.toBeNull();
    for(const seraphVersion of [undefined,0,2,NaN]) expect(compareBossRecords(a,{ ...b,seraphVersion })).toBeNull();
    expect(compareBossRecords(a,after)).toBeNull();
    expect(compareBossRecords({ ...a,seraphVersion:2 },{ ...b,seraphVersion:2 })).toBeNull();
  });
  it('measures supplied boss attempts and uses null for no input, without mutating the original record', () => {
    const battle = new Battle({ character: 'elna', difficulty: 'standard', seed: 42, bossHp: 240 }).snapshot();
    expect(bossFields([{ correct: true }, { correct: false }, { correct: true }], battle)).toMatchObject({ bossAttempts: 3, bossAccuracy: 2 / 3 });
    expect(bossFields([], battle)).toMatchObject({ bossAttempts: 0, bossAccuracy: null });
    const original = structuredClone(before); expect(compareBossRecords(before, after)).toMatchObject({ before: { accuracy: .8 }, after: { accuracy: 1 } });
    expect(before).toEqual(original);
  });
  it('does not display missing, invalid, or incomparable old records as improvement', () => {
    for (const patch of [{ difficulty: 'standard' as const }, { character: 'towa' as const }, { dict: 'jp-angel-heaven' }, { seed: 43 },
      { routeVersion: 1 }, { parentSession: 'other' }, { trainingSession: undefined }, { scope: 'chapter' as const }])
      expect(compareBossRecords(before, { ...after, ...patch })).toBeNull();
    expect(readBossMeasure({ ...before, bossAttempts: undefined })).toBeNull();
    expect(readBossMeasure({ ...before, bossAccuracy: NaN })).toBeNull();
    expect(readBossMeasure({ ...before, bossParries: 5 })).toBeNull();
    expect(readBossMeasure({ ...before, bossAttempts: 0, bossAccuracy: null })?.accuracy).toBeNull();
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('practices only that boss pool and keeps its dictionary at place %i', place => {
    const full = chapterDictionary(place), practice = bossPracticeDictionary(place);
    expect(practice.words).toEqual(full.words.slice(20)); expect(practice.id).toBe(full.id);
    const source = new PatchSource(practice.words, practice.id, [], {}, { seed: 42 });
    const picks = Array.from({ length: 100 }, () => source.next());
    expect(picks.every(p => p.id.startsWith(`${practice.id}:`) && practice.words.some(w => w.display === p.word.display && w.reading === p.word.reading))).toBe(true);
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('replays full-chapter and boss-only orders after training at place %i', place => {
    for (const seed of [0, 42, 0xffffffff]) for (const bossOnly of [true, false]) {
      const original = new ChapterSource(seed, bossOnly, place);
      if (!bossOnly) for (let i = 0; i < 8; i++) original.next();
      const returned = trainingBossSource(seed, bossOnly, place);
      expect(Array.from({ length: 40 }, () => returned.next())).toEqual(Array.from({ length: 40 }, () => original.next()));
    }
  });
  it('chooses an observed target available in the boss pool and falls back safely for tiny samples or unavailable spellings', () => {
    const events = [...Array.from({ length: 200 }, (_, i) => event('s','h',220,i)), ...Array.from({ length: 400 }, (_, i) => event('k','a',100,i+200))];
    const dict = bossPracticeDictionary(1), focus = trainingFocus(events, dict, {});
    expect(focus?.label).toBe('s→h'); expect(focus?.n).toBeGreaterThanOrEqual(8);
    expect(trainingFocus(events.slice(0, 3), dict, {})).toBeUndefined();
    expect(trainingFocus(events, { ...dict, words: [{ display: '空', reading: 'そら' }] }, {})).toBeUndefined();
    const source = new PatchSource(dict.words, dict.id, [focus!], {}, { seed: 42, focus: focus!.label });
    expect(Array.from({ length: 40 }, () => source.next()).some(p => p.role === 'weak' && p.target === focus!.label)).toBe(true);
  });
  it('suggests a repeatedly missed, resolved key even without clean timing, but never attributes unresolved mistakes', () => {
    const misses = Array.from({ length: 8 }, (_, i) => ({ ...event('k','#',NaN,i), expected: ['s'], intended: 's', correct: false, wordStart: true }));
    expect(trainingFocus(misses, bossPracticeDictionary(1), {})).toMatchObject({ label: 's', n: 8, severity: 'INVESTIGATING' });
    expect(trainingFocus(misses.map(e => ({ ...e, intended: null })), bossPracticeDictionary(1), {})).toBeUndefined();
  });
  it('freezes timed practice at a paused finish, rejects extra input, and keeps the benchmark clock intact', () => {
    const dict = bossPracticeDictionary(1), r = new Round(dict, {}, { mode: 'patch', seed: 42 });
    r.input(r.session.guide[0], 100);r.pause(1100);r.finish(9000);
    expect(r.finished).toBe(true); expect(r.elapsedMs(10000)).toBe(1000);
    const count = r.log.length;r.input(r.session.guide[1], 11000);expect(r.log).toHaveLength(count);
    const empty = new Round(dict, {}, { mode: 'patch', seed: 42 });empty.finish(10);expect(empty.finished).toBe(true);expect(empty.elapsedMs(100)).toBe(0);
    const benchmark = new Round(dict, {}, { mode: 'benchmark', seed: 42 });benchmark.input(benchmark.session.guide[0],100);benchmark.finish(9000);expect(benchmark.finished).toBe(false);
  });
});
