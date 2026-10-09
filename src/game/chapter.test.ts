import { describe, expect, it } from 'vitest';
import { ChapterSource } from './chapter';
import { chapterDictionary, chapterIntro, HEAVEN_BOSS, HEAVEN_ROUTE } from '../content/chapters';
import { normalizeReading } from '../engine/romaji';
import { Round } from './round';
import { Battle, type InputView } from './battle';
describe('seeded chapter content and promised previews', () => {
  it('has twenty route candidates and enough unique 8-14-kana boss prayers for the safety limit', () => {
    expect(HEAVEN_ROUTE).toHaveLength(20); expect(HEAVEN_BOSS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(chapterDictionary().words.map(w => w.reading)).size).toBe(chapterDictionary().words.length);
    for (const w of HEAVEN_BOSS) expect(normalizeReading(w.reading).length, w.display).toBeGreaterThanOrEqual(8);
    for (const w of HEAVEN_BOSS) expect(normalizeReading(w.reading).length, w.display).toBeLessThanOrEqual(14);
    expect(chapterIntro('elna', true)).toHaveLength(6); expect(chapterIntro('towa', false)).toHaveLength(4);
  });
  it.each([0, 1, 42, 0xffffffff])('preserves a repeatable unique 60-word run for seed %i', seed => {
    const a = new ChapterSource(seed), b = new ChapterSource(seed);
    expect(a.route).toHaveLength(8);
    const words = Array.from({ length: 60 }, () => a.next());
    expect(words).toEqual(Array.from({ length: 60 }, () => b.next()));
    expect(new Set(words.map(w => w.id)).size).toBe(60);
    expect(words[8].word).toEqual(a.boss[0]);
    expect(normalizeReading(words[0].word.reading).length).toBeLessThanOrEqual(7);
    expect(words.slice(5, 8).every(w => /[ゃゅょっん]/.test(w.word.reading))).toBe(true);
  });
  it('offers a unique boss-only source for retry', () => {
    const source = new ChapterSource(42, true); expect(source.route).toHaveLength(0);
    expect(new Set(Array.from({ length: 60 }, () => source.next().id)).size).toBe(60);
  });
  it('keeps previews across the eight-word pause and freezes the clock during boss dialogue', () => {
    const round = new Round(chapterDictionary(), {}, { mode: 'journey', source: new ChapterSource(5), wordLimit: 60, baselines: new Map() });
    let t = 10;
    for (let i = 0; i < 8; i++) { const next = round.nextWord; for (const key of round.session.guide) round.input(key, t += 30); expect(round.word).toBe(next); }
    const next = round.nextWord, following = round.followingWord; round.pause(t); const elapsed = round.elapsedMs(t);
    round.resume(t + 2000); expect(round.elapsedMs(t + 2000)).toBe(elapsed);
    expect(round.nextWord).toBe(next); expect(round.followingWord).toBe(following);
    round.input(round.session.expected[0], t + 2010); expect(round.log.at(-1)?.afterPause).toBe(true);
  });
  it.each([1, 100000])('lets Battle resolve the final safety word before testing Round.finished (HP %i)', bossHp => {
    const round = new Round(chapterDictionary(), {}, { mode: 'journey', source: new ChapterSource(1, true), wordLimit: 1, baselines: new Map() });
    const battle = new Battle({ character: 'elna', difficulty: 'standard', bossHp, seed: 1 }); battle.startBoss(0);
    let t = 0, outcome;
    const kana = normalizeReading(round.word.reading).length;
    for (const key of round.session.guide) outcome = round.input(key, t += 10);
    expect(outcome?.wordDone).toBe(true);
    const view: InputView = { current: { index: 0, kana }, remainingKana: 0, previews: [{ index: 1, kana }, { index: 2, kana }] };
    battle.wordDone({ index: 0, kana, clean: true, gameMs: round.elapsedMs(t) }, view);
    expect(round.finished).toBe(true);
    expect(battle.snapshot().outcome).toBe(bossHp === 1 ? 'cleared' : null);
  });
  it.each([0, 1])('resolves the actual sixtieth safety word before the limit result (extra HP %i)', extraHp => {
    const seed = 101, words = Array.from({ length: 60 }, () => 0);
    const source = new ChapterSource(seed, true);
    const total = words.reduce(sum => sum + normalizeReading(source.next().word.reading).length, 0);
    const round = new Round(chapterDictionary(), {}, { mode: 'journey', source: new ChapterSource(seed, true), wordLimit: 60, baselines: new Map() });
    const battle = new Battle({ character: 'elna', difficulty: 'standard', bossHp: total + extraHp, seed }); battle.startBoss(0);
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const kana = normalizeReading(round.word.reading).length;
      for (const key of round.session.guide) round.input(key, ++t);
      const view: InputView = { current: { index: i, kana }, remainingKana: 0, previews: [{ index: i + 1, kana }, { index: i + 2, kana }] };
      battle.tick(round.elapsedMs(t), view);
      battle.wordDone({ index: i, kana, clean: false, gameMs: round.elapsedMs(t) }, view);
      if (i < 59) { expect(round.finished).toBe(false); expect(battle.snapshot().outcome).toBe(null); }
    }
    expect(round.wordsDone).toBe(60); expect(round.finished).toBe(true);
    expect(battle.snapshot().outcome).toBe(extraHp === 0 ? 'cleared' : null);
  });

});
