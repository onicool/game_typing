import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_WORDS, KNOWLEDGE_PASSAGES } from './knowledge';
import { DICTIONARIES, WordStream } from './words';
import { TypingSession, normalizeReading } from '../engine/romaji';
import { Round } from '../game/round';

describe('source-backed educational typing', () => {
  it.each([...KNOWLEDGE_WORDS, ...KNOWLEDGE_PASSAGES])('types every reading including punctuation: $display', word => {
    expect(word.source?.url).toMatch(/^https:\/\//);
    expect(word.reading).toMatch(/^[ぁ-ゖー、。]+$/u);
    const session = new TypingSession(word.reading);
    expect(session.guide).toMatch(/^[a-z,.]+$/);
    for (const key of session.guide) expect(session.input(key).accepted).toBe(true);
    expect(session.complete).toBe(true);
    if (word.segments) {
      expect(word.segments.map(s => s.display).join('')).toBe(word.display);
      expect(word.segments.map(s => s.reading).join('')).toBe(word.reading);
      for (const segment of word.segments) expect(normalizeReading(segment.reading).length).toBeGreaterThan(0);
    }
  });
  it('keeps historical dictionary identities and separates new benchmarks', () => {
    expect(DICTIONARIES.slice(0, 3).map(d => d.id)).toEqual(['jp-core', 'en-core', 'jp-passages']);
    const dict = DICTIONARIES.find(d => d.id === 'jp-knowledge')!;
    const stream = new WordStream(dict, 7);
    const seen: string[] = [];
    for (let i = 0; i < 36; i++) {
      const word = stream.next();
      expect(seen.slice(-8)).not.toContain(word.id);
      expect(word.source).toBeDefined(); seen.push(word.id!);
    }
  });
  it('completes long educational text without breaking sentence cursors or stored key metadata', () => {
    const dict = DICTIONARIES.find(d => d.id === 'jp-knowledge-passages')!;
    const round = new Round(dict, {}, { mode: 'passage', baselines: new Map(), seed: 5, wordLimit: 1 });
    const reading = round.word.reading;
    const guide = round.session.guide;
    let now = 1;
    for (const key of guide) round.input(key, now += 20);
    expect(round.finished).toBe(true);
    expect(round.wordsDone).toBe(1);
    expect(round.log).toHaveLength(guide.length);
    expect(round.log.every(e => e.wordId?.startsWith(dict.id + ':') && e.correct)).toBe(true);
    expect(normalizeReading(reading).length).toBeGreaterThan(60);
  });
});
