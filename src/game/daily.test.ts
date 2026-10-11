import { describe, expect, it } from 'vitest';
import { CHAPTER_VERSION } from '../content/chapters';
import type { SessionMeta } from '../stats/store';
import { ChapterSource } from './chapter';
import { dailyAt, dailySummary, readDaily, DAILY_DICT, DAILY_VERSION } from './daily';

const day = dailyAt(new Date('2026-10-08T00:30:00Z'), 'UTC')!;
const meta: SessionMeta = { session: 'daily', dict: DAILY_DICT, mode: 'journey', endedAt: 42, kanaPerSec: 2, accuracy: 1,
  character: 'elna', difficulty: 'standard', scope: 'chapter', routeVersion: CHAPTER_VERSION, outcome: 'cleared',
  seed: day.seed, score: 9000, elapsedMs: 40000, dailyDate: day.date, dailyZone: day.zone, dailyVersion: DAILY_VERSION };

describe('local daily prayers', () => {
  it('separates supported seraph daily attempts from normal and future hard rules', () => {
    const hard = { ...meta, session:'hard', difficulty:'seraph' as const, seraphVersion:1, score:999999 };
    expect(dailySummary([meta,hard],day,'elna','standard')).toMatchObject({ attempts:1,clears:1,bestScore:9000 });
    expect(dailySummary([meta,hard],day,'elna','seraph')).toMatchObject({ attempts:1,clears:1,bestScore:999999 });
    for(const seraphVersion of [undefined,0,2,NaN])expect(readDaily({ ...hard,seraphVersion })).toBeNull();
  });
  it('uses the local calendar date, keeping the same date independent of zone', () => {
    // Published local rule-1 seeds before the road chapter must stay reproducible.
    expect(day.seed).toBe(3560041198);
    expect(dailyAt(new Date('2026-10-08T00:30:00Z'),'America/Los_Angeles')?.seed).toBe(3476153103);
    const now = new Date('2026-10-08T00:30:00Z');
    expect(dailyAt(now, 'America/Los_Angeles')?.date).toBe('2026-10-07');
    expect(dailyAt(now, 'Asia/Tokyo')).toMatchObject({ date: day.date, seed: day.seed });
    expect(dailyAt(now, 'Asia/Kathmandu')?.date).toBe('2026-10-08');
    expect(dailyAt(new Date('2026-10-07T23:59:59Z'), 'UTC')?.seed).not.toBe(day.seed);
  });
  it.each([
    ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-03-08'],
    ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-01'],
  ])('does not change a day at daylight saving transitions %s', (a,b,date) => {
    const before = dailyAt(new Date(a), 'America/New_York')!;
    expect(before.date).toBe(date); expect(dailyAt(new Date(b), 'America/New_York')?.seed).toBe(before.seed);
  });
  it('handles leap days and refuses invalid clocks or zones without substituting a day', () => {
    expect(dailyAt(new Date('2024-02-29T23:00:00Z'), 'UTC')?.date).toBe('2024-02-29');
    expect(dailyAt(new Date(NaN), 'UTC')).toBeNull();
    expect(dailyAt(new Date(), 'Not/AZone')).toBeNull();
  });
  it('captures a frozen day and produces identical full-chapter promises after reloading or changing players', () => {
    expect(Object.isFrozen(day)).toBe(true);
    const nextDay = dailyAt(new Date('2026-10-09T00:00:00Z'), 'UTC')!;expect(nextDay.seed).not.toBe(day.seed);
    const replay = dailyAt(new Date('2026-10-08T23:59:59Z'), 'Asia/Tokyo')!;
    expect(replay.date).toBe('2026-10-09');expect(day.date).toBe('2026-10-08');
    const original = new ChapterSource(day.seed), reloaded = new ChapterSource(dailyAt(new Date('2026-10-08T18:00:00Z'), 'UTC')!.seed);
    expect(Array.from({ length: 48 }, () => original.next())).toEqual(Array.from({ length: 48 }, () => reloaded.next()));
  });
  it('reads only the current daily full chapter, never incompatible or legacy rows', () => {
    expect(readDaily(meta)).toEqual(day);
    for (const patch of [{ dailyDate: undefined }, { dailyDate: '2026-02-30' }, { dailyZone: '' }, { seed: day.seed+1 },
      { dailyVersion: 0 }, { routeVersion: CHAPTER_VERSION+1 }, { dict: 'jp-angel-town' }, { dict: 'jp-angel-road' }, { dict: 'jp-angel-canal' }, { dict: 'jp-angel-theatre' }, { dict: 'jp-angel-snow' }, { dict: 'jp-angel-city' }, { scope: 'boss' as const }])
      expect(readDaily({ ...meta, ...patch })).toBeNull();
  });
  it('counts losses and quits, but compares only clears of the same day, player, difficulty and rules', () => {
    const rows: SessionMeta[] = [meta, { ...meta, session: 'better', score: 10000, elapsedMs: 42000 },
      { ...meta, session: 'quit', mode: 'practice', outcome: 'quit', score: 99999, elapsedMs: 1 },
      { ...meta, session: 'loss', mode: 'practice', outcome: 'lost', score: 99999, elapsedMs: 1 }];
    const original = structuredClone(rows);
    const incompatible: SessionMeta[] = [{ ...meta, session:'towa', character:'towa', score:99999 },
      { ...meta, session:'challenge', difficulty:'challenge' }, { ...meta, session:'yesterday', dailyDate:'2026-10-07' },
      { ...meta, session:'boss', scope:'boss' }, { ...meta, session:'old', dailyVersion:0 }, { ...meta, session:'benchmark', mode:'benchmark' }];
    expect(dailySummary([...rows, meta, ...incompatible], day, 'elna', 'standard')).toEqual({ attempts:4, clears:2, bestScore:10000, bestTimeMs:40000 });
    expect(rows).toEqual(original);
  });
  it('shares identical same-date prayers across zones, while keeping missing metrics empty', () => {
    const same = { ...meta, dailyZone:'Asia/Tokyo', score:undefined, elapsedMs:NaN };
    expect(dailySummary([same], day, 'elna', 'standard')).toEqual({ attempts:1, clears:1, bestScore:null, bestTimeMs:null });
    expect(dailySummary([], day, 'towa', 'challenge')).toEqual({ attempts:0, clears:0, bestScore:null, bestTimeMs:null });
  });
});
