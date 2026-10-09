import { describe, expect, it } from 'vitest';
import { normalizeReading } from '../engine/romaji';
import { TypingSession } from '../engine/romaji';
import { ChapterSource } from './chapter';
import { chapterDictionary, getChapter } from '../content/chapters';
import { TOWN_BOSS, TOWN_ROUTE, townIntro, townOutro } from '../content/town';
import { Round } from './round';

describe('town chapter and the reply to its steward', () => {
  it('has a finite unique prayer pool, typeable content, and 8-14-kana boss prayers', () => {
    expect(TOWN_ROUTE).toHaveLength(20); expect(TOWN_BOSS.length).toBeGreaterThanOrEqual(60);
    const dict = chapterDictionary(1);
    expect(dict.id).toBe('jp-angel-town');
    expect(new Set(dict.words.map(w => w.reading)).size).toBe(dict.words.length);
    for (const w of dict.words) {
      const s = new TypingSession(w.reading);
      for (const key of s.guide) s.input(key);
      expect(s.complete, w.display).toBe(true);
    }
    for (const w of TOWN_BOSS) {
      expect(normalizeReading(w.reading).length, w.display).toBeGreaterThanOrEqual(8);
      expect(normalizeReading(w.reading).length, w.display).toBeLessThanOrEqual(14);
    }
    expect(getChapter(7)).toBeNull(); expect(() => chapterDictionary(7)).toThrow();
  });
  it.each([0, 42, 0xffffffff])('keeps the opening reply fixed and the rest seeded without repetitions (%i)', seed => {
    for (const bossOnly of [false, true]) {
      const a = new ChapterSource(seed, bossOnly, 1), b = new ChapterSource(seed, bossOnly, 1);
      const picks = Array.from({ length: 60 }, () => a.next());
      expect(picks).toEqual(Array.from({ length: 60 }, () => b.next()));
      expect(new Set(picks.map(w => w.id)).size).toBe(60);
      expect(picks[bossOnly ? 0 : 8].word.reading).toBe(TOWN_BOSS[0].reading);
    }
  });
  it('preserves the reply and two promised previews across dialogue and resume', () => {
    const round = new Round(chapterDictionary(1), {}, { mode: 'journey', wordLimit: 60, source: new ChapterSource(42, false, 1) });
    let t = 1;
    for (let i = 0; i < 8; i++) for (const key of round.session.guide) round.input(key, t += 50);
    const reply = round.word, next = round.nextWord, later = round.followingWord;
    round.pause(t); const elapsed = round.elapsedMs(t); round.resume(t + 5000);
    expect(round.word).toBe(reply); expect(reply.reading).toBe(TOWN_BOSS[0].reading);
    expect(round.nextWord).toBe(next); expect(round.followingWord).toBe(later);
    expect(round.elapsedMs(t + 5000)).toBe(elapsed);
  });
  it.each(['elna', 'towa'] as const)('shows the unselected sibling and evidence of restitution for %s', character => {
    const other = character === 'elna' ? 'towa' : 'elna';
    expect(townIntro(character).some(line => line.speaker === other)).toBe(true);
    const outro = townOutro(character);
    expect(outro.some(line => line.speaker === other)).toBe(true);
    expect(outro.some(line => line.speaker === 'steward' && line.text.includes('返す'))).toBe(true);
    expect(outro.some(line => line.speaker === 'villager' && line.text.includes('戻ってきた'))).toBe(true);
    expect(outro.at(-1)?.speaker).toBe(character);
  });
});
