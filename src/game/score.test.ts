import { describe, expect, it } from 'vitest';
import { Round } from './round';
import { normalizeReading } from '../engine/romaji';
import { chapterRank, comboTier, emptyScore, routeRank, routeStars, scoreInput } from './score';

function spell(reading: string, keys: string, initialCombo = 0) {
  const word = { id: 'jp-test:0', reading, display: reading };
  const round = new Round({ id: 'jp-test', name: 'Test', label: 'Test', words: [word] }, {}, {
    mode: 'journey', wordLimit: 1, baselines: new Map(), source: { next: () => ({ word, id: word.id, role: 'ordinary', target: null, prob: 1 }) },
  });
  let score = { ...emptyScore(), kanaCombo: initialCombo }, time = 0;
  for (const key of keys) {
    const before = round.session.kanaDone;
    const outcome = round.input(key, ++time);
    expect(outcome.accepted).toBe(true);
    score = scoreInput(score, outcome.wordDone ? normalizeReading(reading).length - before : round.session.kanaDone - before, true, outcome.wordDone);
  }
  expect(round.finished).toBe(true);
  return score;
}

describe('kana scoring is independent of romaji length and grouping', () => {
  it.each([
    ['し', ['shi', 'si', 'ci']], ['しゃ', ['sha', 'sya', 'shixya', 'silya']],
    ['きゃ', ['kya', 'kixya', 'kilya']], ['きっと', ['kitto', 'kixtuto', 'kiltsuto']],
    ['かんじ', ['kanji', 'kannji', 'kaxnzi']],
  ] as const)('%s gives equal points for every alias at each multiplier boundary', (reading, spellings) => {
    for (const combo of [0, 8, 9, 28, 29, 48, 49]) {
      const results = spellings.map(keys => spell(reading, keys, combo));
      for (const result of results) expect(result).toEqual(results[0]);
    }
  });
  it('applies a new multiplier to each kana as it crosses 10, 30 and 50', () => {
    for (const [combo, expected] of [[8, 22], [28, 27], [48, 35]]) {
      expect(scoreInput({ ...emptyScore(), kanaCombo: combo }, 2, true, false).score).toBe(expected);
    }
    expect([9, 10, 29, 30, 49, 50].map(comboTier)).toEqual([0, 1, 1, 2, 2, 3]);
  });
  it('resets kana combo on misses and grants the clean bonus only to clean words', () => {
    let score = scoreInput(emptyScore(), 12, true, false);
    const earned = score.score;
    score = scoreInput(score, 0, false, false);
    expect(score.kanaCombo).toBe(0); expect(score.score).toBe(earned);
    score = scoreInput(score, 1, true, true);
    expect(score.score).toBe(earned + 110); expect(score.cleanWords).toBe(0);
    score = scoreInput(score, 1, true, true);
    expect(score.score).toBe(earned + 270); expect(score.cleanWords).toBe(1);
  });
});

describe('completion ranks and stars', () => {
  it('assigns no rank or stars to a partial route', () => {
    expect(routeRank(false, 1, 5, 5)).toBe(null);
    expect(routeStars(false, 1, 5, 5)).toEqual([false, false, false]);
  });
  it('uses inclusive route thresholds and accuracy without speed', () => {
    expect(routeRank(true, .98, 4, 5)).toBe('S');
    expect(routeRank(true, .98, 3, 5)).toBe('A');
    expect(routeRank(true, .95, 4, 5)).toBe('A');
    expect(routeRank(true, .949, 5, 5)).toBe('B');
    expect(routeStars(true, .95, 4, 5)).toEqual([true, true, true]);
    expect(routeStars(true, .94, 4, 5)).toEqual([true, false, true]);
  });
  it('applies chapter reset limits before accuracy and parry thresholds', () => {
    expect(chapterRank(false, 1, 4, 4, 0)).toBe(null);
    expect(chapterRank(true, 1, 4, 4, 2)).toBe('C');
    expect(chapterRank(true, 1, 4, 4, 1)).toBe('B');
    expect(chapterRank(true, .97, 4, 5, 0)).toBe('S');
    expect(chapterRank(true, .97, 2, 2, 0)).toBe('A');
    expect(chapterRank(true, .94, 3, 5, 0)).toBe('A');
    expect(chapterRank(true, .94, 0, 0, 0)).toBe('A');
    expect(chapterRank(true, .94, 2, 5, 0)).toBe('B');
  });
});
