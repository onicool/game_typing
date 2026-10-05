import { describe, expect, it } from 'vitest';
import { Round, ROUND_MS } from './round';
import { DICTIONARIES, type Dictionary } from '../content/words';
import { normalizeReading } from '../engine/romaji';
import type { Baselines } from '../stats/baselines';
import { PatchSource, type Pick } from '../stats/select';
import type { Vuln } from '../stats/types';

const LONG = 'かきくけこさしすせそたちつてと';
const dict = (reading = LONG, id = 'jp-test'): Dictionary => ({ id, name: 't', label: 't', words: [{ display: reading, reading }] });

/** Types the guide of the current word key by key; interval(i) gives the gap before key i. */
function typeKeys(r: Round, count: number, interval: (i: number) => number, start = 0, transform = (k: string) => k) {
  let t = start;
  for (let i = 0; i < count; i++) {
    const s = r.session;
    const k = s.guide[s.typed.length];
    t += interval(i);
    r.input(transform(k), t);
  }
  return t;
}

describe('Round', () => {
  it.each([0, 1, 2, 3])('finishes original passage %i once, without a 60-second cutoff or double-counted kana', index => {
    const passages = DICTIONARIES.find(d => d.kind === 'passage')!;
    const word = passages.words[index];
    expect(word.display).toBe(word.segments!.map(s => s.display).join(''));
    expect(word.reading).toBe(word.segments!.map(s => s.reading).join(''));
    const r = new Round({ ...passages, words: [word] }, {}, { mode: 'passage', baselines: new Map(), seed: 1 });
    const selected = r.word; // WordStream supplies an independent dictionary copy.
    const guide = r.session.guide;
    expect(guide.length).toBeGreaterThan(100);
    for (let i = 0; i < guide.length; i++) {
      expect(r.input(guide[i], i * 1000).accepted).toBe(true);
      if (i === 80) { expect(r.finished).toBe(false); expect(r.remainingMs(i * 1000)).toBe(Infinity); }
    }
    expect(r.finished).toBe(true);
    expect(r.word).toBe(selected);
    expect(r.wordsDone).toBe(1);
    expect(r.totalKana()).toBe(normalizeReading(word.reading).length);
    expect(r.result().kanaPerSec).toBeCloseTo(normalizeReading(word.reading).length / (guide.length - 1));
    expect(r.input('a', guide.length * 1000).late).toBe(true);
    expect(r.log).toHaveLength(guide.length);
  });

  it('keeps a long-practice position through a miss and pause and saves a frozen partial duration', () => {
    const r = new Round(dict('あいうえお'.repeat(20)), {}, { mode: 'passage', baselines: new Map() });
    r.finish(10); expect(r.finished).toBe(false);
    r.input('a', 0); r.input('?', 500); r.input('i', 1000);
    const typed = r.session.typed; const kana = r.totalKana();
    r.pause(2000); r.tick(200000, 100);
    expect(r.session.typed).toBe(typed); expect(r.totalKana()).toBe(kana);
    r.resume(200000); expect(r.input('u', 200100).accepted).toBe(true);
    expect(r.log.at(-1)).toMatchObject({ afterPause: true, dt: NaN, wordStart: false });
    expect(r.elapsedMs(200100)).toBe(2100);
    r.pause(201000); r.finish(300000);
    expect(r.endT).toBe(201000);
    expect(r.result().kanaPerSec).toBeCloseTo(3 / 3);
    expect(r.result().accuracy).toBe(0.75);
    expect(r.session.complete).toBe(false);
    expect(r.log[1].intended).toBe('i');
  });

  it('keeps explicit practice finish out of the normal benchmark clock', () => {
    const r = new Round(dict('あいう'), {});
    r.input('a', 0); r.finish(1000);
    expect(r.finished).toBe(false);
    r.tick(ROUND_MS, 0); expect(r.finished).toBe(true);
  });

  it('freezes clock/input/trace while paused and excludes the next accepted key from timing', () => {
    const r = new Round(dict('あいう'), {}, { baselines: new Map(), seed: 7 });
    r.input('a', 0);
    r.trace = 20;
    r.pause(1000);
    r.pause(2000); // Idempotent: original pause time stays in effect.
    expect(r.paused).toBe(true);
    expect(r.interrupted).toBe(true);
    expect(r.remainingMs(61000)).toBe(59000);
    r.tick(61000, 60);
    expect(r.trace).toBe(20);
    expect(r.finished).toBe(false);
    expect(r.input('i', 61000).accepted).toBe(false);
    expect(r.log).toHaveLength(1);
    r.resume(61000);
    r.resume(62000);
    expect(r.paused).toBe(false);
    expect(r.remainingMs(61000)).toBe(59000);
    r.input('x', 61020);
    r.input('i', 61040);
    expect(r.log[2].afterPause).toBe(true);
    expect(r.log[2].dt).toBeNaN();
    r.input('u', 61140);
    expect(r.log[3].afterPause).toBe(false);
    expect(r.log[3].dt).toBe(100);
    r.tick(121000, 0);
    expect(r.finished).toBe(true);
    expect(r.remainingMs(150000)).toBe(0);
    expect(r.result().kanaPerSec).toBeCloseTo(3 / 60);
  });

  it('keeps pre-start pauses outside the elapsed time and reports live accuracy', () => {
    const r = new Round(dict('あいう'), {});
    expect(r.accuracy()).toBe(1);
    r.pause(10);
    expect(r.input('a', 20).accepted).toBe(false);
    expect(r.started).toBe(false);
    r.resume(10000);
    expect(r.interrupted).toBe(false);
    r.input('x', 10001);
    expect(r.accuracy()).toBe(0);
    r.input('a', 10002);
    expect(r.accuracy()).toBe(0.5);
    expect(r.remainingMs(10002)).toBe(ROUND_MS - 1);
    r.pause(10003);
    r.resume(11003);
    r.pause(12003);
    r.resume(14003);
    expect(r.remainingMs(14003)).toBe(ROUND_MS - 1002);
    expect(r.interrupted).toBe(true);
  });

  it('uses an eight-sample frozen personal critical baseline immediately', () => {
    const baselines: Baselines = new Map([['ka', { n: 8, meanLog: Math.log(200) }]]);
    const r = new Round(dict('か'), {}, { baselines });
    r.input('k', 0);
    baselines.get('ka')!.meanLog = Math.log(50);
    baselines.clear();
    const out = r.input('a', 139);
    expect(out.critical).toBe(true);
    expect(out.criticalGainMs).toBeCloseTo(61);
    r.input('k', 150);
    expect(r.input('a', 290).critical).toBe(false); // Strictly below 0.7, not equal.
  });

  it('does not fall back to local criticals for a present but sparse baseline', () => {
    const r = new Round(dict('か'), {}, { baselines: new Map([['ka', { n: 7, meanLog: Math.log(200) }]]) });
    const t = typeKeys(r, 80, () => 120);
    r.input('k', t + 10);
    expect(r.input('a', t + 40).critical).toBe(false);
  });

  it('requires personal speed as well as uniform rhythm for overclock', () => {
    const baselines: Baselines = new Map([['aa', { n: 200, meanLog: Math.log(100) }]]);
    const slow = new Round(dict('あ'.repeat(200)), {}, { baselines });
    const usual = new Round(dict('あ'.repeat(200)), {}, { baselines });
    typeKeys(slow, 120, () => 200);
    typeKeys(usual, 120, () => 100);
    expect(slow.stage).toBe(0);
    expect(usual.stage).toBeGreaterThan(0);
  });

  it('records source provenance, mode and seed without linking words', () => {
    const picks: Pick[] = [
      { word: { display: '蚊', reading: 'か' }, id: 'jp-test:蚊', role: 'weak', target: 'k→a', prob: 0.3 },
      { word: { display: '胃', reading: 'い' }, id: 'jp-test:胃', role: 'probe', target: 'i', prob: 0.1 },
    ];
    let i = 0;
    const source = { seed: 22, next: () => picks[i++ % 2] };
    const r = new Round(dict(), {}, { mode: 'patch', source });
    expect(r.mode).toBe('patch');
    expect(r.seed).toBe(22);
    r.input('x', 0);
    r.input('k', 10);
    r.input('a', 100);
    r.input('i', 200);
    expect(r.log.slice(0, 3).every(e => e.wordId === picks[0].id && e.role === 'weak'
      && e.target === 'k→a' && e.prob === 0.3)).toBe(true);
    expect(r.log[3]).toMatchObject({ wordId: picks[1].id, role: 'probe', target: 'i', wordStart: true, prevKey: null });
    expect(new Round(dict(), {}, { seed: 42 }).seed).toBe(42);
  });

  it('ignores keys after the deadline even before the next frame', () => {
    const r = new Round(dict('あい'), {});
    r.input('a', 0);
    const out = r.input('i', ROUND_MS + 1);
    expect(out.late).toBe(true);
    expect(out.accepted).toBe(false);
    expect(r.finished).toBe(true);
    expect(r.wordsDone).toBe(0);
    expect(r.input('i', ROUND_MS + 2).late).toBe(true);
  });

  it('keeps previewed word order and clears a patch target invalidated by learning a spelling', () => {
    const prefs = { 'し': 'si' };
    const words = Array.from({ length: 120 }, (_, i) => ({ display: `word-${i}`, reading: 'し' }));
    const dictionary = { ...dict('し'), words };
    const vuln: Vuln = {
      id: 'VULN-0001', kind: 'bigram', label: 's→i', excessMs: 40, missExcess: 0,
      impact: 100, severity: 'HIGH', n: 200,
    };
    const source = new PatchSource(words, dictionary.id, [vuln], prefs, { seed: 4 });
    const r = new Round(dictionary, prefs, { mode: 'patch', source, baselines: new Map() });
    r.input('s', 0);
    r.input('i', 100); // The preview is now a weak pick selected with "si".
    const preview = r.nextWord;
    expect(r.session.guide).toBe('si');
    r.input('s', 200);
    r.input('h', 300);
    expect(r.input('i', 400).wordDone).toBe(true);
    expect(prefs['し']).toBe('shi');
    expect(r.word).toBe(preview);
    expect(r.currentPick).toMatchObject({ role: 'ordinary', target: null });
    expect(r.session.guide).toBe('shi');
    r.input('s', 500);
    expect(r.log.at(-1)).toMatchObject({ role: 'ordinary', target: null, wordId: r.currentPick.id });
  });

  it('advances both future words exactly in source order and does not consume previews on miss, pause or late keys', () => {
    const words = ['か', 'き', 'く', 'け', 'こ'].map((reading, i) => ({ display: `word-${i}`, reading, id: `word-${i}` }));
    let index = 0;
    const source = { next: () => { const word = words[index++ % words.length]; return { word, id: word.id, role: 'ordinary' as const, target: null, prob: 0.2 }; } };
    const r = new Round(dict(), {}, { source, baselines: new Map() });
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const next = r.nextWord, following = r.followingWord;
      r.input('?', t++); r.pause(t++); r.input('a', t++); r.resume(t++);
      expect(r.nextWord).toBe(next); expect(r.followingWord).toBe(following);
      for (const key of r.session.guide) r.input(key, t++);
      expect(r.word).toBe(next); expect(r.nextWord).toBe(following);
    }
    const next = r.nextWord, following = r.followingWord;
    r.input('a', ROUND_MS + 1000);
    expect(r.nextWord).toBe(next); expect(r.followingWord).toBe(following);
  });

  it('zero-length intervals do not poison overclock', () => {
    const r = new Round(dict(), {});
    r.input('k', 0);
    r.input('a', 0); // same timestamp
    typeKeys(r, 120, () => 100, 0);
    expect(r.stage).toBeGreaterThan(0);
  });

  it('final speed counts the half-typed last word', () => {
    const r = new Round(dict('あいう'), {});
    r.input('a', 0);
    r.input('i', 100);
    r.input('x', ROUND_MS); // ends the round
    expect(r.result().kanaPerSec).toBeCloseTo(2 / 60, 5);
  });

  it('letter case does not change rhythm detection for kana', () => {
    const lower = new Round(dict(), {});
    const upper = new Round(dict(), {});
    const gap = (i: number) => (i % 2 ? 60 : 140);
    typeKeys(lower, 150, gap);
    typeKeys(upper, 150, gap, 0, (k) => k.toUpperCase());
    expect(upper.stage).toBe(lower.stage);
    expect(upper.log.every((e) => e.key === e.key.toLowerCase())).toBe(true);
  });

  it('a sustained slowdown loses overclock', () => {
    const r = new Round(dict(), {});
    const t = typeKeys(r, 120, () => 100);
    expect(r.stage).toBeGreaterThan(0);
    typeKeys(r, 80, () => 400, t);
    expect(r.stage).toBe(0);
  });

  it('erratic rhythm brings stage 1 down to 0', () => {
    const r = new Round(dict(), {});
    const t = typeKeys(r, 120, () => 100);
    expect(r.stage).toBeGreaterThan(0);
    typeKeys(r, 120, (i) => (i % 2 ? 20 : 600), t);
    expect(r.stage).toBe(0);
  });

  it('criticals are faster than the transition baseline with a positive gain', () => {
    const r = new Round(dict(), {});
    let t = typeKeys(r, 100, () => 120);
    let crit = 0;
    for (let i = 0; i < 30; i++) {
      const k = r.session.guide[r.session.typed.length];
      t += i % 5 === 4 ? 40 : 120;
      const out = r.input(k, t);
      if (out.critical) {
        crit++;
        expect(out.criticalGainMs).toBeGreaterThan(0);
      }
    }
    expect(crit).toBeGreaterThan(0);
  });

  it('attributes misses to the key eventually typed', () => {
    const r = new Round(dict('か'), {});
    r.input('q', 0);
    r.input('q', 10);
    r.input('k', 20);
    expect(r.log.filter((e) => !e.correct).every((e) => e.intended === 'k')).toBe(true);
  });

  it('keeps case for literal (English) attribution', () => {
    const r = new Round({ id: 'en-test', name: 't', label: 't', words: [{ display: 'Ab', reading: 'Ab' }] }, {});
    r.input('a', 0);
    r.input('A', 10);
    expect(r.log[0].intended).toBe('A');
  });
});
