import { describe, expect, it } from 'vitest';
import { canEnterPlace, emptyProgress, emptyRecord, isProgress, mergeProgress, migrateProgress, recordResult, type Progress, type RouteResult } from './progress';
const result: RouteResult = { key: 'heaven', routeVersion: 1, completed: true, score: 1000,
  rank: 'A', elapsedMs: 20000, stars: [true, true, false], scope: 'route' };
const cleared = () => recordResult(emptyProgress(), result);

describe('versioned route progress', () => {
  it('opens town with a current heaven clear, including a boss retry, and locks all later chapters', () => {
    const versions = { heaven: 2, town: 2, road: 2, canal: 2, theatre: 2, snow: 2, city: 2 };
    const old = cleared(), migrated = migrateProgress(old, versions);
    expect(canEnterPlace('town', old, versions)).toBe(false);
    expect(canEnterPlace('town', migrated, versions)).toBe(false);
    expect(canEnterPlace('road', migrated, versions)).toBe(false);
    expect(canEnterPlace('canal', migrated, versions)).toBe(false);
    expect(canEnterPlace('theatre', migrated, versions)).toBe(false);
    expect(canEnterPlace('snow', migrated, versions)).toBe(false);
    expect(canEnterPlace('city', migrated, versions)).toBe(false);
    for (const scope of ['chapter', 'boss'] as const) {
      const completed = recordResult(migrated, { ...result, routeVersion: 2, scope });
      expect(canEnterPlace('town', completed, versions)).toBe(true);
      expect(old.places.heaven.routeVersion).toBe(1);
    }
    const future = recordResult(migrated, { ...result, routeVersion: 3 });
    expect(canEnterPlace('town', future, versions)).toBe(false);
  });
  it('rejects malformed storage without accepting partial data', () => {
    expect(isProgress(emptyProgress())).toBe(true); expect(isProgress(cleared())).toBe(true);
    for (const value of [null, [], {}, { version: 2, places: {} }, { version: 1, places: [] }]) expect(isProgress(value)).toBe(false);
    for (const edit of [
      { routeVersion: 0 }, { routeVersion: 1.5 }, { routeVersion: Infinity }, { legacy: {} },
      { current: { ...emptyRecord(), bestScore: -1 } }, { current: { ...emptyRecord(), bestScore: NaN } },
      { current: { ...emptyRecord(), bestTimeMs: Infinity } }, { current: { ...emptyRecord(), bestRank: 'SS' } },
      { current: { ...emptyRecord(), stars: [true, true] } }, { current: { ...emptyRecord(), stars: [true, true, 1] } },
      { current: { ...emptyRecord(), cleared: 1 } },
    ]) expect(isProgress({ version: 1, places: { heaven: { routeVersion: 1, current: emptyRecord(), ...edit } } })).toBe(false);
  });
  it('upgrades current results to display-only legacy without mutating the original', () => {
    const old = cleared(), copy = structuredClone(old);
    const upgraded = migrateProgress(old, { heaven: 2, town: 1 });
    expect(upgraded.places.heaven.current).toEqual(emptyRecord());
    expect(upgraded.places.heaven.legacy).toEqual(old.places.heaven.current);
    expect(upgraded.places.town.routeVersion).toBe(1);
    expect(old).toEqual(copy);
    expect(migrateProgress(upgraded, { heaven: 1 })).toEqual(upgraded);
  });
  it('merges independent clears and bests from tabs on the same version', () => {
    const a = cleared(), b = recordResult(emptyProgress(), { ...result, score: 900, rank: 'S', elapsedMs: 19000, stars: [true, false, true] });
    const combined = mergeProgress(a, recordResult(b, { ...result, key: 'town' }));
    expect(combined.places.heaven.current).toEqual({ cleared: true, bestScore: 1000, bestRank: 'S', bestTimeMs: 19000, stars: [true, true, true] });
    expect(combined.places.town.current.cleared).toBe(true);
    expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
    expect(mergeProgress(a, a)).toEqual(a);
  });
  it('never compares current score, time, rank or stars against another route version', () => {
    const old = cleared();
    const newer = recordResult(migrateProgress(old, { heaven: 2 }), { ...result, routeVersion: 2, score: 100, rank: 'B', elapsedMs: 90000, stars: [true, false, false] });
    const merged = mergeProgress(newer, old);
    expect(merged.places.heaven.current).toEqual(newer.places.heaven.current);
    expect(merged.places.heaven.legacy).toEqual(old.places.heaven.current);
    expect(mergeProgress(old, newer)).toEqual(merged);
  });
  it('records an older tab only into legacy when storage already has a newer chapter', () => {
    const latest = migrateProgress(cleared(), { heaven: 2 });
    const updated = recordResult(latest, { ...result, score: 2000, rank: 'S', elapsedMs: 10000, stars: [true, true, true] });
    expect(updated.places.heaven.current).toEqual(emptyRecord());
    expect(updated.places.heaven.routeVersion).toBe(2);
    expect(updated.places.heaven.legacy!.bestScore).toBe(2000);
    expect(updated.places.heaven.legacy!.bestTimeMs).toBe(10000);
  });
  it('ignores quits and records boss retry clears without a whole-chapter score or time', () => {
    expect(recordResult(cleared(), { ...result, completed: false, score: 9999 })).toEqual(cleared());
    const boss = recordResult(emptyProgress(), { ...result, scope: 'boss' });
    expect(boss.places.heaven.current).toEqual({ ...emptyRecord(), cleared: true, bestRank: 'A', stars: [true, true, false] });
    const whole = recordResult(boss, result);
    expect(whole.places.heaven.current.bestScore).toBe(1000);
    expect(whole.places.heaven.current.bestTimeMs).toBe(20000);
  });
  it('keeps unknown places from a newer implementation', () => {
    const future: Progress = { version: 1, places: { future: { routeVersion: 5, current: emptyRecord() } } };
    expect(mergeProgress(future, cleared()).places.future).toEqual(future.places.future);
  });
});
