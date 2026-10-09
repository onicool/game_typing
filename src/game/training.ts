import { chapterDictionary, CHAPTER_ROUTE_WORDS, getChapter } from '../content/chapters';
import type { Dictionary } from '../content/words';
import { analyze } from '../stats/analyze';
import { targetsInWord } from '../stats/select';
import type { SessionMeta } from '../stats/store';
import type { StoredKey, Vuln } from '../stats/types';
import type { BattleSnapshot } from './battle';
import { isDifficulty, isCompatibleDifficulty } from './battle';
import { isCharacter } from './journey';
import { ChapterSource } from './chapter';

export interface BossLesson {
  before: SessionMeta;
  place: number;
  initialKanaPerSec: number;
  sourceBossOnly: boolean;
  events: StoredKey[];
  focus?: Vuln;
}
export interface BossMeasure {
  attempts: number; accuracy: number | null; parries: number; resolved: number; cracks: number; resets: number;
}
type BossFields = Pick<SessionMeta, 'bossAttempts' | 'bossAccuracy' | 'bossParries' | 'bossResolved' | 'bossCracks' | 'bossResets'>;

/** Compare boss inputs only: a chapter's route must not dilute its boss misses. */
export function bossFields(events: Pick<StoredKey, 'correct'>[], battle: BattleSnapshot): BossFields {
  return { bossAttempts: events.length, bossAccuracy: events.length ? events.filter(e => e.correct).length / events.length : null,
    bossParries: battle.stats.parries, bossResolved: battle.stats.resolved, bossCracks: battle.stats.cracks, bossResets: battle.stats.resets };
}
export function readBossMeasure(meta: SessionMeta): BossMeasure | null {
  const counts = [meta.bossAttempts, meta.bossParries, meta.bossResolved, meta.bossCracks, meta.bossResets];
  if (!counts.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) || meta.bossParries! > meta.bossResolved!) return null;
  if (meta.bossAttempts === 0 ? meta.bossAccuracy !== null : typeof meta.bossAccuracy !== 'number' || !Number.isFinite(meta.bossAccuracy) || meta.bossAccuracy < 0 || meta.bossAccuracy > 1) return null;
  return { attempts: meta.bossAttempts!, accuracy: meta.bossAccuracy!, parries: meta.bossParries!, resolved: meta.bossResolved!, cracks: meta.bossCracks!, resets: meta.bossResets! };
}
export function compareBossRecords(before: SessionMeta, after: SessionMeta): { before: BossMeasure; after: BossMeasure } | null {
  if (!after.trainingSession || after.parentSession !== before.session || after.scope !== 'boss'
    || !isDifficulty(before.difficulty) || !isCharacter(before.character) || before.seed === undefined || before.routeVersion === undefined
    || (before.scope !== 'boss' && before.scope !== 'chapter')
    || before.dict !== after.dict || before.character !== after.character || before.difficulty !== after.difficulty
    || before.seed !== after.seed || before.routeVersion !== after.routeVersion) return null;
  if (before.difficulty === 'seraph' && (!isCompatibleDifficulty(before) || !isCompatibleDifficulty(after))) return null;
  const a = readBossMeasure(before), b = readBossMeasure(after);
  return a && b ? { before: a, after: b } : null;
}
export function bossPracticeDictionary(place: number): Dictionary {
  const dict = chapterDictionary(place);
  return { ...dict, label: 'セラの修行場 / ROMAJI', words: dict.words.slice(getChapter(place)!.route.length) };
}
/** Replay the same promised boss order, including a chapter seed's route shuffle. */
export function trainingBossSource(seed: number, sourceBossOnly: boolean, place: number): ChapterSource {
  const source = new ChapterSource(seed, sourceBossOnly, place);
  if (!sourceBossOnly) for (let i = 0; i < CHAPTER_ROUTE_WORDS; i++) source.next();
  return source;
}
/** No new diagnosis from tiny samples; only suggest labels present in this boss pool. */
export function trainingFocus(events: StoredKey[], dict: Dictionary, prefs: Record<string, string>): Vuln | undefined {
  const available = new Set(dict.words.flatMap(w => targetsInWord(w.reading, prefs)));
  const report = analyze(events, { dict: dict.id });
  // Repeated, resolved misses remain useful even when clock precision leaves no
  // clean timing samples. The prompt suggests practice, never a firm diagnosis.
  const misses = report.keys.filter(k => k.n >= 8 && k.misses >= 3 && available.has(k.key)).sort((a,b) => b.misses - a.misses || a.key.localeCompare(b.key))[0];
  if (misses) return { id: `practice:${misses.key}`, kind: 'key', label: misses.key, excessMs: 0,
    missExcess: Math.max(0, misses.misses / misses.n - (1 - report.accuracy)), impact: misses.misses * 100, severity: 'INVESTIGATING', n: misses.n };
  return report.vulns.find(v => v.n >= 8 && v.impact > 0 && available.has(v.label));
}
