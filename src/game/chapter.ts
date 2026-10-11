import { chapterDictionary, CHAPTER_ROUTE_WORDS, getChapter } from '../content/chapters';
import type { Word } from '../content/words';
import type { Pick } from '../stats/select';
import type { WordSource } from './round';
/** Fisher-Yates with a private seeded stream; previews are never reselected. */
function shuffle<T>(values: T[], random: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export class ChapterSource implements WordSource {
  readonly seed: number;
  readonly route: Word[];
  readonly boss: Word[];
  private index = 0;
  constructor(seed: number, bossOnly = false, place = 0) {
    this.seed = seed >>> 0;
    let state = this.seed;
    const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const definition = getChapter(place);
    if (!definition) throw new Error('This place has no chapter source');
    const dict = chapterDictionary(place);
    this.route = bossOnly ? [] : [...shuffle(dict.words.slice(0, 6), random).slice(0, 3),
      ...shuffle(dict.words.slice(6, 12), random).slice(0, 2), ...shuffle(dict.words.slice(12, 20), random).slice(0, 3)];
    this.boss = definition.openingReply ? [dict.words[20], ...shuffle(dict.words.slice(21), random)] : shuffle(dict.words.slice(20), random);
    if (!bossOnly && this.route.length !== CHAPTER_ROUTE_WORDS) throw new Error('Chapter route must have eight words');
  }
  next(): Pick {
    const i = this.index++;
    // The finite safety limit ends before this backup wrapping is observable.
    const word = i < this.route.length ? this.route[i] : this.boss[(i - this.route.length) % this.boss.length];
    return { word, id: word.id!, role: 'ordinary', target: null, prob: 1 };
  }
}
