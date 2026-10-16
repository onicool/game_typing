import type { Rank } from './score';

export interface PlaceRecord {
  cleared: boolean;
  bestScore: number;
  bestRank: Rank | null;
  bestTimeMs: number | null;
  stars: [boolean, boolean, boolean];
}
export interface PlaceProgress {
  routeVersion: number;
  current: PlaceRecord;
  legacy?: PlaceRecord;
  /** Missing for older saves whose legacy route cannot be identified. */
  legacyVersion?: number;
}
export interface Progress { version: 1; places: Record<string, PlaceProgress> }
export const ROUTE_VERSION = 1;
export const emptyRecord = (): PlaceRecord => ({ cleared: false, bestScore: 0, bestRank: null, bestTimeMs: null, stars: [false, false, false] });
export const emptyProgress = (): Progress => ({ version: 1, places: {} });
export const chapterPrerequisite = (key: string): string | undefined => ({ town: 'heaven', road: 'town', canal: 'road', theatre: 'canal', snow: 'theatre', city: 'snow' } as Record<string, string>)[key];
/** Only the preceding current chapter clear grants its key. Practice stays open. */
export function canEnterPlace(key: string, progress: Progress, versions: Record<string, number>): boolean {
  const prerequisite = chapterPrerequisite(key);
  if (!prerequisite) return true;
  const proof = progress.places[prerequisite];
  return !!proof && proof.routeVersion === versions[prerequisite] && proof.current.cleared === true;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const isRank = (v: unknown): v is Rank => v === 'S' || v === 'A' || v === 'B' || v === 'C';
function isRecord(v: unknown): v is PlaceRecord {
  return object(v) && typeof v.cleared === 'boolean' && nonnegative(v.bestScore)
    && (v.bestRank === null || isRank(v.bestRank)) && (v.bestTimeMs === null || nonnegative(v.bestTimeMs))
    && Array.isArray(v.stars) && v.stars.length === 3 && v.stars.every(x => typeof x === 'boolean');
}
export function isProgress(v: unknown): v is Progress {
  return object(v) && v.version === 1 && object(v.places) && Object.values(v.places).every(p =>
    object(p) && nonnegative(p.routeVersion) && Number.isInteger(p.routeVersion) && p.routeVersion > 0
    && isRecord(p.current) && (p.legacy === undefined || isRecord(p.legacy))
    && (p.legacyVersion === undefined || (typeof p.legacyVersion === 'number'
      && Number.isInteger(p.legacyVersion) && p.legacyVersion > 0
      && p.legacyVersion < p.routeVersion && p.legacy !== undefined)));
}
const ranks: Rank[] = ['S', 'A', 'B', 'C'];
function mergeRecord(a: PlaceRecord, b: PlaceRecord): PlaceRecord {
  const availableRanks = [a.bestRank, b.bestRank].filter((r): r is Rank => r !== null);
  const times = [a.bestTimeMs, b.bestTimeMs].filter((t): t is number => t !== null);
  return {
    cleared: a.cleared || b.cleared,
    bestScore: Math.max(a.bestScore, b.bestScore),
    bestRank: availableRanks.sort((x, y) => ranks.indexOf(x) - ranks.indexOf(y))[0] ?? null,
    bestTimeMs: times.length ? Math.min(...times) : null,
    stars: a.stars.map((s, i) => s || b.stars[i]) as PlaceRecord['stars'],
  };
}

/** Only current records of the same version compete for current bests. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const places = Object.fromEntries([...new Set([...Object.keys(a.places), ...Object.keys(b.places)])].map(key => {
    const left = a.places[key], right = b.places[key];
    if (!left || !right) return [key, structuredClone(left ?? right)];
    if (left.routeVersion === right.routeVersion) {
      // Only identified records from the same old route may share bests.
      const source = !left.legacy ? right : !right.legacy ? left
        : (right.legacyVersion ?? 0) > (left.legacyVersion ?? 0) ? right : left;
      const legacy = left.legacy && right.legacy && left.legacyVersion !== undefined
        && left.legacyVersion === right.legacyVersion ? mergeRecord(left.legacy, right.legacy) : source.legacy;
      return [key, { routeVersion: left.routeVersion, current: mergeRecord(left.current, right.current),
        ...(legacy ? { legacy: structuredClone(legacy), ...(source.legacyVersion === undefined ? {} : { legacyVersion: source.legacyVersion }) } : {}) }];
    }
    const [newer, older] = left.routeVersion > right.routeVersion ? [left, right] : [right, left];
    // Retain an existing snapshot when its provenance is unknown or different.
    const legacy = newer.legacy
      ? newer.legacyVersion === older.routeVersion ? mergeRecord(newer.legacy, older.current) : newer.legacy
      : older.current;
    const legacyVersion = newer.legacy ? newer.legacyVersion : older.routeVersion;
    return [key, { routeVersion: newer.routeVersion, current: structuredClone(newer.current), legacy: structuredClone(legacy),
      ...(legacyVersion === undefined ? {} : { legacyVersion }) }];
  }));
  return { version: 1, places };
}

/** A rule upgrade preserves the old route as display-only evidence. Never downgrade. */
export function migrateProgress(progress: Progress, versions: Record<string, number>): Progress {
  const next = structuredClone(progress);
  for (const [key, version] of Object.entries(versions)) {
    const p = next.places[key];
    if (!p) next.places[key] = { routeVersion: version, current: emptyRecord() };
    else if (version > p.routeVersion) next.places[key] = { routeVersion: version, current: emptyRecord(), legacy: p.current, legacyVersion: p.routeVersion };
  }
  return next;
}

export interface RouteResult {
  key: string; routeVersion: number; completed: boolean; score: number; rank: Rank | null;
  elapsedMs: number; stars: PlaceRecord['stars']; scope: 'route' | 'chapter' | 'boss';
}
export function recordResult(progress: Progress, result: RouteResult): Progress {
  if (!result.completed) return structuredClone(progress);
  const whole = result.scope !== 'boss';
  const record: PlaceRecord = { cleared: true, bestScore: whole ? result.score : 0, bestRank: result.rank,
    bestTimeMs: whole ? result.elapsedMs : null, stars: [...result.stars] };
  return mergeProgress(progress, { version: 1, places: { [result.key]: { routeVersion: result.routeVersion, current: record } } });
}
