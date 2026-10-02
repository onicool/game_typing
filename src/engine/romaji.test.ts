import { describe, expect, it } from 'vitest';
import { TypingSession, normalizeReading } from './romaji';

/** Types `keys` into a fresh session; returns the session and whether every key was accepted. */
function run(reading: string, keys: string, prefs?: Record<string, string>) {
  const s = new TypingSession(reading, { prefs });
  let allAccepted = true;
  let completions = 0;
  for (const k of keys) {
    const r = s.input(k);
    if (!r.accepted) allAccepted = false;
    if (r.completed) completions++;
  }
  return { s, allAccepted, completions };
}

const accepts = (reading: string, keys: string) => {
  const { s, allAccepted, completions } = run(reading, keys);
  return allAccepted && s.complete && completions === 1;
};

describe('aliases', () => {
  it.each([
    ['し', ['shi', 'si', 'ci']],
    ['ち', ['chi', 'ti']],
    ['つ', ['tsu', 'tu']],
    ['ふ', ['fu', 'hu']],
    ['じ', ['ji', 'zi']],
    ['じゃ', ['ja', 'jya', 'zya', 'jixya', 'zilya']],
    ['しゃ', ['sha', 'sya', 'shixya', 'silya']],
    ['ちゃ', ['cha', 'tya', 'cya', 'chixya']],
    ['か', ['ka', 'ca']],
    ['く', ['ku', 'cu', 'qu']],
    ['せ', ['se', 'ce']],
    ['ぢ', ['di']],
    ['づ', ['du']],
    ['を', ['wo']],
  ])('%s accepts %j', (reading, spellings) => {
    for (const sp of spellings) expect(accepts(reading, sp), sp).toBe(true);
  });

  it('small kana via x and l prefixes', () => {
    for (const sp of ['xa', 'la']) expect(accepts('ぁ', sp)).toBe(true);
    for (const sp of ['xya', 'lya']) expect(accepts('ゃ', sp)).toBe(true);
    for (const sp of ['xtu', 'ltu', 'xtsu', 'ltsu']) expect(accepts('っ', sp)).toBe(true);
    for (const sp of ['xwa', 'lwa']) expect(accepts('ゎ', sp)).toBe(true);
  });

  it('contracted sounds can be typed decomposed', () => {
    for (const sp of ['kya', 'kixya', 'kilya']) expect(accepts('きゃ', sp)).toBe(true);
  });

  it('foreign sounds', () => {
    for (const sp of ['wi', 'whi', 'uxi', 'uli']) expect(accepts('うぃ', sp)).toBe(true);
    for (const sp of ['fa', 'fwa', 'fuxa', 'hula']) expect(accepts('ふぁ', sp)).toBe(true);
    expect(accepts('てぃ', 'thi')).toBe(true);
    expect(accepts('でぃ', 'dhi')).toBe(true);
    expect(accepts('ゔ', 'vu')).toBe(true);
    expect(accepts('ゔぁ', 'va')).toBe(true);
  });
});

describe('ん', () => {
  it('single n before a consonant', () => {
    expect(accepts('かんじ', 'kanji')).toBe(true);
    expect(accepts('かんじ', 'kannji')).toBe(true);
    expect(accepts('かんじ', 'kaxnji')).toBe(true);
  });

  it('んな needs nn or xn (nna is rejected)', () => {
    expect(accepts('んな', 'nnna')).toBe(true);
    expect(accepts('んな', 'xnna')).toBe(true);
    const { s } = run('んな', 'nna');
    expect(s.complete).toBe(false);
  });

  it('before vowels and y it needs nn', () => {
    expect(accepts('んあ', 'nna')).toBe(true);
    expect(run('んあ', 'na').allAccepted).toBe(false);
    expect(accepts('んや', 'nnya')).toBe(true);
    expect(run('んや', 'nya').allAccepted).toBe(false);
    expect(accepts('んにゃ', 'nnnya')).toBe(true);
    expect(accepts('きんようび', 'kinnyoubi')).toBe(true);
  });

  it('single n needs a following kana', () => {
    expect(run('ん!', 'n!').allAccepted).toBe(false);
    expect(accepts('ん!', 'nn!')).toBe(true);
    expect(run('んk', 'nk').allAccepted).toBe(false);
    expect(run('んー', 'n-').allAccepted).toBe(false);
    expect(accepts('んー', 'nn-')).toBe(true);
  });

  it('consecutive ん', () => {
    expect(accepts('んん', 'nnnn')).toBe(true);
    expect(accepts('んん', 'xnxn')).toBe(true);
  });

  it('word-final ん needs nn or xn', () => {
    const single = run('みかん', 'mikan');
    expect(single.allAccepted).toBe(true);
    expect(single.s.complete).toBe(false);
    expect(accepts('みかん', 'mikann')).toBe(true);
    expect(accepts('みかん', 'mikaxn')).toBe(true);
  });

  it('ambiguous single n is not counted as done until resolved', () => {
    const s = new TypingSession('かんじ');
    for (const k of 'kan') s.input(k);
    expect(s.kanaDone).toBe(1);
    s.input('j');
    expect(s.kanaDone).toBe(2);
  });
});

describe('っ', () => {
  it('doubled consonant of any following spelling', () => {
    expect(accepts('っち', 'cchi')).toBe(true);
    expect(accepts('っち', 'tti')).toBe(true);
    expect(accepts('きって', 'kitte')).toBe(true);
    expect(accepts('ざっし', 'zasshi')).toBe(true);
    expect(accepts('ざっし', 'zassi')).toBe(true);
    expect(accepts('いっしょ', 'issho')).toBe(true);
    expect(accepts('いっしょ', 'issyo')).toBe(true);
  });

  it('explicit small tsu', () => {
    expect(accepts('きって', 'kixtute')).toBe(true);
    expect(accepts('きって', 'kiltsute')).toBe(true);
  });

  it('does not double vowels or n', () => {
    expect(run('っあ', 'aa').allAccepted).toBe(false);
    expect(run('っな', 'nna').s.complete).toBe(false);
    expect(accepts('っな', 'xtuna')).toBe(true);
  });

  it('consecutive and final っ', () => {
    expect(accepts('っっか', 'kkka')).toBe(true);
    expect(accepts('っっか', 'xtukka')).toBe(true);
    expect(accepts('あっ', 'axtu')).toBe(true);
    expect(run('あっ', 'att').allAccepted).toBe(false);
  });
});

describe('extra IME spellings (Mozc)', () => {
  it.each([
    ['ぐぃ', 'gwi'], ['くぃ', 'kwi'], ['ふぁ', 'hwa'], ['ゔゃ', 'vya'], ['すぇ', 'swe'], ['ずぃ', 'zwi'],
    ['っち', 'tchi'], ['まっちゃ', 'matcha'], ['ぼっちゅ', 'botchu'],
  ])('%s accepts %s', (reading, keys) => expect(accepts(reading, keys)).toBe(true));
});

describe('symbols and literals', () => {
  it('long vowel mark is "-" and not a vowel', () => {
    expect(accepts('キーボード', 'ki-bo-do')).toBe(true);
    expect(run('キーボード', 'kiibo').allAccepted).toBe(false);
    expect(accepts('おう', 'ou')).toBe(true);
    expect(run('おう', 'o-').allAccepted).toBe(false);
  });

  it('japanese punctuation', () => {
    expect(accepts('はい、そう。', 'hai,sou.')).toBe(true);
    expect(accepts('なに？', 'nani?')).toBe(true);
    expect(accepts('すごい！', 'sugoi!')).toBe(true);
  });

  it('katakana and full-width normalization', () => {
    expect(normalizeReading('カタカナ')).toBe('かたかな');
    expect(normalizeReading('ヴァ')).toBe('ゔぁ');
    expect(normalizeReading('ＡＢＣ１')).toBe('ABC1');
    expect(accepts('ヴァーチャル', 'va-charu')).toBe(true);
    expect(accepts('ウィルス', 'wirusu')).toBe(true);
  });

  it('mixed japanese and ascii', () => {
    expect(accepts('cpuのおと', 'cpunooto')).toBe(true);
    expect(accepts('てすと 1', 'tesuto 1')).toBe(true);
  });

  it('ascii is case-sensitive, kana is not', () => {
    expect(accepts('Hello', 'Hello')).toBe(true);
    expect(run('Hello', 'hello').allAccepted).toBe(false);
    expect(accepts('か', 'KA')).toBe(true);
    const { s } = run('か', 'KA');
    expect(s.typed).toBe('ka');
  });
});

describe('state and guide', () => {
  it('rejected input leaves state unchanged', () => {
    const s = new TypingSession('しすてむ');
    s.input('s');
    const before = { typed: s.typed, guide: s.guide, expected: s.expected, done: s.kanaDone };
    const r = s.input('q');
    expect(r.accepted).toBe(false);
    expect(r.expected).toEqual(before.expected);
    expect({ typed: s.typed, guide: s.guide, expected: s.expected, done: s.kanaDone }).toEqual(before);
    for (const k of 'hisutemu') expect(s.input(k).accepted).toBe(true);
    expect(s.complete).toBe(true);
  });

  it('expected lists the alternatives', () => {
    const s = new TypingSession('ち');
    expect(s.expected).toEqual(['c', 't']);
    s.input('c');
    expect(s.expected).toEqual(['h']);
  });

  it('default guide uses common IME spellings', () => {
    expect(new TypingSession('しゃちょう').guide).toBe('shachou');
    expect(new TypingSession('ざっし').guide).toBe('zasshi');
    expect(new TypingSession('みかん').guide).toBe('mikann');
    expect(new TypingSession('ふつう').guide).toBe('futsuu');
    expect(new TypingSession('キーボード').guide).toBe('ki-bo-do');
    expect(new TypingSession('きゃく').guide).toBe('kyaku');
  });

  it('guide stays stable while followed and switches after divergence', () => {
    const s = new TypingSession('しすてむ');
    expect(s.guide).toBe('shisutemu');
    s.input('s');
    expect(s.guide).toBe('shisutemu');
    s.input('i');
    expect(s.guide).toBe('sisutemu');
  });

  it('a choice made in the word carries to later units of the same word', () => {
    const s = new TypingSession('しかし');
    for (const k of 'si') s.input(k);
    expect(s.guide).toBe('sikasi');
  });

  it('prefs change the guide but not validity', () => {
    const prefs = { し: 'si', ちゃ: 'cya', ん: 'n' };
    expect(new TypingSession('しゃしん', { prefs }).guide).toBe('shasinn'); // final ん cannot be single n
    expect(new TypingSession('ちゃんと', { prefs }).guide).toBe('cyanto');
    expect(new TypingSession('ざっし', { prefs }).guide).toBe('zassi');
    expect(run('しゃしん', 'shashinn', prefs).s.complete).toBe(true);
  });

  it('kanaDone tracks confirmed reading characters', () => {
    const s = new TypingSession('きゃく');
    s.input('k');
    expect(s.kanaDone).toBe(0);
    s.input('y');
    s.input('a');
    expect(s.kanaDone).toBe(2);
    s.input('k');
    s.input('u');
    expect(s.kanaDone).toBe(3);
  });

  it('records committed spellings', () => {
    const { s } = run('しゃしん', 'syasinn');
    expect(s.committed).toEqual([
      { kana: 'しゃ', romaji: 'sya' },
      { kana: 'し', romaji: 'si' },
      { kana: 'ん', romaji: 'nn' },
    ]);
  });

  it('completed fires exactly once and further input is rejected', () => {
    const s = new TypingSession('あ');
    expect(s.input('a')).toMatchObject({ accepted: true, completed: true });
    expect(s.input('a').accepted).toBe(false);
    expect(s.complete).toBe(true);
  });

  it('is fast enough for a keydown handler', () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      const s = new TypingSession('じどうはんばいき');
      for (const k of 'jidouhannbaiki') s.input(k);
    }
    const perKey = (performance.now() - t0) / (200 * 14);
    expect(perKey).toBeLessThan(0.2);
  });
});
