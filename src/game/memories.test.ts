import { describe, expect, it } from 'vitest';
import { CHAPTER_VERSION } from '../content/chapters';
import type { SessionMeta } from '../stats/store';
import { collectMemories, MEMORIES, MEMORY_VERSION, memoryBits, mergeMemories } from './memories';

const meta: SessionMeta = { session: 'chapter', dict: 'jp-angel-heaven', mode: 'journey', kanaPerSec: 2, accuracy: 1,
  endedAt: 1000, character: 'elna', difficulty: 'standard', scope: 'chapter', routeVersion: CHAPTER_VERSION,
  outcome: 'cleared', bossAttempts: 100, bossAccuracy: 1, bossParries: 1, bossResolved: 1, bossCracks: 0, bossResets: 0 };
const stamped = (m: SessionMeta) => ({ ...m, memoryVersion: MEMORY_VERSION, memoryBits: memoryBits(m) });
const ids = (rows: unknown[]) => Object.keys(collectMemories(rows).owned);

describe('21 permanent journey memories', () => {
  it('shares the existing 21 IDs with supported seraph full clears but not unknown hard rules', () => {
    const hard = { ...meta,difficulty:'seraph' as const,seraphVersion:1 };
    expect(ids([stamped(hard),stamped(meta)])).toHaveLength(3);
    for(const seraphVersion of [undefined,0,2,NaN])expect(ids([{ ...stamped(hard),seraphVersion }])).toEqual([]);
    expect(ids([stamped({ ...hard,scope:'boss' })])).toEqual([]);
  });
  it('has exactly three stable IDs per place and twenty-one obtainable slots', () => {
    expect(MEMORIES).toHaveLength(21); expect(new Set(MEMORIES.map(m => m.id)).size).toBe(21);
    for (let i = 0; i < 7; i++) expect(MEMORIES.filter(m => m.place === i).map(m => m.bit)).toEqual([1, 2, 4]);
    expect(MEMORIES.filter(m => m.implemented)).toHaveLength(21);
    expect(MEMORIES.filter(m => !m.implemented).every(m => m.text === '' && m.condition.includes('実装後'))).toBe(true);
  });
  it.each(['jp-angel-heaven', 'jp-angel-town', 'jp-angel-road', 'jp-angel-canal', 'jp-angel-theatre', 'jp-angel-snow', 'jp-angel-city'])('awards all three on a valid full chapter %s', dict => {
    expect(memoryBits({ ...meta, dict })).toBe(7); expect(ids([stamped({ ...meta, dict })])).toHaveLength(3);
  });
  it('uses inclusive accuracy and real resolved parries, never canceled attacks', () => {
    expect(memoryBits({ ...meta, accuracy: .95 })).toBe(7);
    expect(memoryBits({ ...meta, accuracy: .949999 })).toBe(5);
    for (const patch of [{ bossParries: 0, bossResolved: 0 }, { bossCracks: 1 }, { bossResolved: 2 },
      { bossParries: undefined }, { bossAttempts: NaN }, { bossAccuracy: 2 }, { bossResets: -1 },
      { bossAttempts: 0, bossAccuracy: null }, { bossResets: 1 }, { bossParries: 101, bossResolved: 101 }])
      expect(memoryBits({ ...meta, ...patch })).toBe(3);
  });
  it.each([
    { scope: 'boss' }, { scope: 'route' }, { mode: 'practice' }, { mode: 'patch' }, { mode: 'benchmark' },
    { mode: 'passage' }, { outcome: 'lost' }, { outcome: 'quit' }, { routeVersion: 1 }, { routeVersion: 2.5 },
    { character: 'unknown' }, { difficulty: 'unknown' }, { accuracy: NaN }, { accuracy: 1.1 }, { endedAt: Infinity },
    { endedAt: -1 }, { endedAt: 8.64e15 + 1 }, { session: '' }, { scope: undefined }, { difficulty: undefined }, { endReason: 'user' },
  ])('does not grant from ambiguous, unfinished or broken records %j', patch => {
    expect(memoryBits({ ...meta, ...patch } as SessionMeta)).toBe(0);
    expect(ids([{ ...meta, ...patch }])).toEqual([]);
  });
  it('never awards unknown chapters even when records claim clears and collection bits', () => {
    for (const dict of ['unknown'].map(k => `jp-angel-${k}`)) {
      expect(memoryBits({ ...meta, dict })).toBe(0);
      expect(ids([{ ...stamped(meta), dict }])).toEqual([]);
    }
  });
  it('restores compatible unstamped chapters without modifying the old records', () => {
    const old: SessionMeta = { ...meta, bossParries: undefined, bossResolved: undefined, bossAttempts: undefined };
    const original = structuredClone(old);
    expect(ids([old])).toEqual(['heaven:1', 'heaven:2']); expect(old).toEqual(original);
    expect(Object.hasOwn(old, 'memoryBits')).toBe(false);
    expect(ids([{ ...meta, routeVersion: 1, scope: 'route' }])).toEqual([]);
  });
  it('keeps known stamped awards across chapter upgrades without guessing unstamped future rules', () => {
    const future = { ...meta, routeVersion: CHAPTER_VERSION + 1 };
    expect(ids([future])).toEqual([]); expect(ids([stamped(future)])).toHaveLength(3);
  });
  it.each([
    { memoryVersion: 0 }, { memoryVersion: 2 }, { memoryVersion: undefined }, { memoryBits: undefined },
    { memoryBits: 0 }, { memoryBits: 8 }, { memoryBits: 3 }, { memoryBits: '7' }, { memoryBits: 7.1 },
  ])('preserves malformed or unknown claims and never infers fallback awards %j', patch => {
    const row = { ...stamped(meta), ...patch }, original = structuredClone(row);
    expect(collectMemories([row])).toEqual({ owned: {}, unreadable: 1 }); expect(row).toEqual(original);
  });
  it('handles junk alongside valid records without losing recognized memories', () => {
    const result = collectMemories([null, [], 'old', {}, stamped(meta)]);
    expect(Object.keys(result.owned)).toHaveLength(3); expect(result.unreadable).toBe(3);
  });
  it('unions repeated clears, complementary conditions and both chapters without double counting', () => {
    const precise = { ...meta, bossParries: 0, bossResolved: 0 }, defended = { ...meta, session: 'defended', accuracy: .9 };
    const records = [precise, defended, precise, stamped({ ...meta, dict: 'jp-angel-town' })];
    const original = structuredClone(records), result = collectMemories(records);
    expect(Object.keys(result.owned)).toHaveLength(6); expect(records).toEqual(original);
    expect(result).toEqual(collectMemories(JSON.parse(JSON.stringify(records))));
  });
  it('merges tabs independently of ordering and returns defensive proof copies', () => {
    const a = collectMemories([meta]).owned, b = collectMemories([{ ...meta, session: 'earlier', endedAt: 100 }]).owned;
    expect(mergeMemories(a, b)).toEqual(mergeMemories(b, a));
    expect(mergeMemories(a, b, a)).toEqual(b);
    const copy = mergeMemories(a); copy['heaven:1'].session = 'changed'; expect(a['heaven:1'].session).toBe('chapter');
  });
  it('daily full clears qualify while Sera and boss returns keep their own metadata unchanged', () => {
    const day = stamped({ ...meta, dailyDate: '2026-10-08', dailyZone: 'UTC', dailyVersion: 1 });
    const practice = { ...meta, scope: 'boss', parentSession: day.session, trainingSession: 'practice', trainingWords: 10 };
    const original = structuredClone([day, practice]);
    expect(ids([day, practice])).toHaveLength(3); expect(ids([practice])).toEqual([]); expect([day, practice]).toEqual(original);
  });
  it('does not expire on calendar or timezone changes', () => {
    const old = stamped({ ...meta, endedAt: 0, dailyDate: '2000-01-01', dailyZone: 'Asia/Tokyo' });
    expect(ids([old])).toHaveLength(3);
  });
});
