import type { Dictionary } from '../content/words';
import type { KeyLog } from '../game/round';
import type { StoredKey } from './types';
import { writePreservingInvalid } from '../storage/settings';

export type Baselines = Map<string, { n: number; meanLog: number }>;
const CAP = 200;
const storageKey = (dict: Dictionary | string): string =>
  `icebreaker-baselines-v1:${typeof dict === 'string' ? dict : dict.id}`;

// Reads may salvage recognised entries, but writes must preserve a partially
// damaged record too: filtering it and saving would destroy the original bytes.
function isBaselineRecord(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [pair, baseline] = entry;
    if (typeof pair !== 'string' || !baseline || typeof baseline !== 'object') return false;
    const { n, meanLog } = baseline;
    return typeof n === 'number' && Number.isFinite(n) && n >= 1
      && typeof meanLog === 'number' && Number.isFinite(meanLog)
      && Math.exp(meanLog) > 0 && meanLog < Math.log(3000);
  });
}

/** Each call returns an independent snapshot; corrupt/unavailable storage is harmless. */
export function loadBaselines(dict: Dictionary | string): Baselines {
  const result: Baselines = new Map();
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(storageKey(dict)) ?? '[]');
    if (!Array.isArray(entries)) return result;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [pair, value] = entry;
      if (typeof pair !== 'string' || !value || typeof value !== 'object') continue;
      const { n, meanLog } = value;
      if (Number.isFinite(n) && n >= 1 && Number.isFinite(meanLog)
        && Math.exp(meanLog) > 0 && meanLog < Math.log(3000)) {
        result.set(pair, { n: Math.min(CAP, Math.floor(n)), meanLog });
      }
    }
  } catch { /* Missing localStorage, denied access or corrupt JSON. */ }
  return result;
}

/** Clean within-word timing only. At the cap, use exponential forgetting (alpha=1/200). */
export function updateBaselines(dict: Dictionary | string, log: KeyLog[] | StoredKey[]): void {
  const baselines = loadBaselines(dict);
  const id = typeof dict === 'string' ? dict : dict.id;
  for (const event of log) {
    if ('dict' in event && event.dict !== id) continue;
    if (!event.correct || event.wordStart || event.afterMiss || event.afterPause
      || event.prevKey === null || !Number.isFinite(event.dt) || event.dt <= 0 || event.dt >= 3000) continue;
    const pair = `${event.prevKey}${event.key}`;
    const old = baselines.get(pair);
    const n = Math.min(CAP, (old?.n ?? 0) + 1);
    const meanLog = old ? old.meanLog + (Math.log(event.dt) - old.meanLog) / n : Math.log(event.dt);
    baselines.set(pair, { n, meanLog });
  }
  writePreservingInvalid(storageKey(dict), [...baselines], isBaselineRecord);
}
