import { CHAPTER_VERSION } from '../content/chapters';
import type { SessionMeta } from '../stats/store';
import { isCompatibleDifficulty, type Difficulty } from './battle';
import type { Character } from './journey';

export const DAILY_VERSION = 1;
export const DAILY_PLACE = 0;
export const DAILY_DICT = 'jp-angel-heaven';
export interface DailyChallenge { readonly date: string; readonly zone: string; readonly version: number; readonly seed: number }
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Same local calendar date means the same words, regardless of zone or player. */
function seedFor(date: string): number {
  let hash = 2166136261;
  for (const c of `daily:${DAILY_VERSION}:chapter:${CHAPTER_VERSION}:heaven:${date}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function dailyAt(now = new Date(), zone?: string): DailyChallenge | null {
  try {
    if (!Number.isFinite(now.getTime())) return null;
    zone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    if (!validDate(date) || !zone) return null;
    return Object.freeze({ date, zone, version: DAILY_VERSION, seed: seedFor(date) });
  } catch { return null; }
}
/** Old, incompatible, boss-only and malformed rows never compete with today's chapter. */
export function readDaily(meta: SessionMeta): DailyChallenge | null {
  if (typeof meta.dailyDate !== 'string' || !validDate(meta.dailyDate) || typeof meta.dailyZone !== 'string' || !meta.dailyZone || meta.dailyZone.length > 100
    || meta.dailyVersion !== DAILY_VERSION || meta.routeVersion !== CHAPTER_VERSION || meta.dict !== DAILY_DICT || meta.scope !== 'chapter'
    || meta.seed !== seedFor(meta.dailyDate) || !isCompatibleDifficulty(meta)) return null;
  return { date: meta.dailyDate, zone: meta.dailyZone, version: meta.dailyVersion, seed: meta.seed };
}
export function dailySummary(sessions: SessionMeta[], day: DailyChallenge, character: Character, difficulty: Difficulty) {
  const rows = [...new Map(sessions.map(s => [s.session, s])).values()].filter(s => {
    const d = readDaily(s);
    return d && d.date === day.date && d.version === day.version && d.seed === day.seed && s.character === character && s.difficulty === difficulty
      && ((s.mode === 'journey' && s.outcome === 'cleared') || (s.mode === 'practice' && (s.outcome === 'lost' || s.outcome === 'quit')));
  });
  const cleared = rows.filter(s => s.outcome === 'cleared');
  const scores = cleared.map(s => s.score).filter(finite), times = cleared.map(s => s.elapsedMs).filter(finite);
  return { attempts: rows.length, clears: cleared.length, bestScore: scores.length ? scores.reduce((a,b) => Math.max(a,b)) : null,
    bestTimeMs: times.length ? times.reduce((a,b) => Math.min(a,b)) : null };
}
