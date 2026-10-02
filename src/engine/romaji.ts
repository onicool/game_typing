/**
 * Romaji typing engine.
 *
 * The reading is split into units at every position (a unit is 1–3 reading
 * characters: a kana, a contracted sound like きゃ, っ+following unit, or an
 * ASCII literal). Each unit has several accepted spellings. Input is matched
 * against the set of all live paths (an NFA), so every alternative spelling
 * stays valid until the player's keys rule it out. Rejected keys leave the
 * state untouched.
 */

export interface CommittedUnit { kana: string; romaji: string }
export interface InputResult {
  accepted: boolean;
  completed: boolean;
  expected: string[];
}
export interface SessionOptions {
  prefs?: Record<string, string>;
}

// first spelling in each list is the default guide spelling
const BASE: Record<string, string[]> = {
  あ: ['a'], い: ['i', 'yi'], う: ['u', 'wu', 'whu'], え: ['e'], お: ['o'],
  か: ['ka', 'ca'], き: ['ki'], く: ['ku', 'cu', 'qu'], け: ['ke'], こ: ['ko', 'co'],
  さ: ['sa'], し: ['shi', 'si', 'ci'], す: ['su'], せ: ['se', 'ce'], そ: ['so'],
  た: ['ta'], ち: ['chi', 'ti'], つ: ['tsu', 'tu'], て: ['te'], と: ['to'],
  な: ['na'], に: ['ni'], ぬ: ['nu'], ね: ['ne'], の: ['no'],
  は: ['ha'], ひ: ['hi'], ふ: ['fu', 'hu'], へ: ['he'], ほ: ['ho'],
  ま: ['ma'], み: ['mi'], む: ['mu'], め: ['me'], も: ['mo'],
  や: ['ya'], ゆ: ['yu'], よ: ['yo'],
  ら: ['ra'], り: ['ri'], る: ['ru'], れ: ['re'], ろ: ['ro'],
  わ: ['wa'], ゐ: ['wyi'], ゑ: ['wye'], を: ['wo'],
  が: ['ga'], ぎ: ['gi'], ぐ: ['gu'], げ: ['ge'], ご: ['go'],
  ざ: ['za'], じ: ['ji', 'zi'], ず: ['zu'], ぜ: ['ze'], ぞ: ['zo'],
  だ: ['da'], ぢ: ['di'], づ: ['du'], で: ['de'], ど: ['do'],
  ば: ['ba'], び: ['bi'], ぶ: ['bu'], べ: ['be'], ぼ: ['bo'],
  ぱ: ['pa'], ぴ: ['pi'], ぷ: ['pu'], ぺ: ['pe'], ぽ: ['po'],
  ゔ: ['vu'],
  ぁ: ['xa', 'la'], ぃ: ['xi', 'li', 'xyi', 'lyi'], ぅ: ['xu', 'lu'], ぇ: ['xe', 'le', 'xye', 'lye'], ぉ: ['xo', 'lo'],
  ゃ: ['xya', 'lya'], ゅ: ['xyu', 'lyu'], ょ: ['xyo', 'lyo'], ゎ: ['xwa', 'lwa'],
  ゕ: ['xka', 'lka'], ゖ: ['xke', 'lke'],
  ー: ['-'], '、': [','], '。': ['.'], '・': ['/'], '「': ['['], '」': [']'], '〜': ['~'],
};

const COMBO: Record<string, string[]> = {
  しゃ: ['sha', 'sya'], しぃ: ['syi'], しゅ: ['shu', 'syu'], しぇ: ['she', 'sye'], しょ: ['sho', 'syo'],
  ちゃ: ['cha', 'tya', 'cya'], ちぃ: ['tyi', 'cyi'], ちゅ: ['chu', 'tyu', 'cyu'], ちぇ: ['che', 'tye', 'cye'], ちょ: ['cho', 'tyo', 'cyo'],
  じゃ: ['ja', 'zya', 'jya'], じぃ: ['jyi', 'zyi'], じゅ: ['ju', 'zyu', 'jyu'], じぇ: ['je', 'zye', 'jye'], じょ: ['jo', 'zyo', 'jyo'],
  ぢゃ: ['dya'], ぢぃ: ['dyi'], ぢゅ: ['dyu'], ぢぇ: ['dye'], ぢょ: ['dyo'],
  てぃ: ['thi'], てゃ: ['tha'], てゅ: ['thu'], てぇ: ['the'], てょ: ['tho'],
  でぃ: ['dhi'], でゃ: ['dha'], でゅ: ['dhu'], でぇ: ['dhe'], でょ: ['dho'],
  とぅ: ['twu'], どぅ: ['dwu'],
  ふぁ: ['fa', 'fwa', 'hwa'], ふぃ: ['fi', 'fwi', 'fyi', 'hwi'], ふぅ: ['fwu'], ふぇ: ['fe', 'fwe', 'fye', 'hwe'], ふぉ: ['fo', 'fwo', 'hwo'], ふゅ: ['fyu', 'hwyu'],
  うぁ: ['wha'], うぃ: ['wi', 'whi'], うぇ: ['we', 'whe'], うぉ: ['who'],
  ゔぁ: ['va'], ゔぃ: ['vi', 'vyi'], ゔぇ: ['ve', 'vye'], ゔぉ: ['vo'],
  ゔゃ: ['vya'], ゔゅ: ['vyu'], ゔょ: ['vyo'],
  くぁ: ['qa', 'kwa', 'qwa'], くぃ: ['qi', 'qwi', 'qyi', 'kwi'], くぅ: ['qwu', 'kwu'], くぇ: ['qe', 'qwe', 'qye', 'kwe'], くぉ: ['qo', 'qwo', 'kwo'], くゃ: ['qya'], くゅ: ['qyu'], くょ: ['qyo'],
  ぐぁ: ['gwa'], ぐぃ: ['gwi'], ぐぅ: ['gwu'], ぐぇ: ['gwe'], ぐぉ: ['gwo'],
  すぁ: ['swa'], すぃ: ['swi'], すぅ: ['swu'], すぇ: ['swe'], すぉ: ['swo'],
  ずぁ: ['zwa'], ずぃ: ['zwi'], ずぅ: ['zwu'], ずぇ: ['zwe'], ずぉ: ['zwo'],
  とぁ: ['twa'], とぃ: ['twi'], とぇ: ['twe'], とぉ: ['two'],
  どぁ: ['dwa'], どぃ: ['dwi'], どぇ: ['dwe'], どぉ: ['dwo'],
  つぁ: ['tsa'], つぃ: ['tsi'], つぇ: ['tse'], つぉ: ['tso'],
  いぇ: ['ye'],
};
const YOON: Record<string, string> = { き: 'k', ぎ: 'g', に: 'n', ひ: 'h', び: 'b', ぴ: 'p', み: 'm', り: 'r' };
for (const [kana, c] of Object.entries(YOON)) {
  COMBO[`${kana}ゃ`] = [`${c}ya`];
  COMBO[`${kana}ぃ`] = [`${c}yi`];
  COMBO[`${kana}ゅ`] = [`${c}yu`];
  COMBO[`${kana}ぇ`] = [`${c}ye`];
  COMBO[`${kana}ょ`] = [`${c}yo`];
}

/** Kana after which a single 'n' for ん is NOT allowed. */
const N_BLOCKERS = new Set([...'あいうえおぁぃぅぇぉやゆよゃゅょなにぬねのん']);
const VOWELS = new Set([...'aeiou']);

export function normalizeReading(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCodePoint(c - 0x60);
    else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCodePoint(c - 0xfee0);
    else if (c === 0x3000) out += ' ';
    else out += ch;
  }
  return out;
}

interface Unit {
  kana: string; // the reading characters this unit covers
  len: number;
  spellings: string[];
  literal: boolean; // ASCII text: case-sensitive
  cost: number; // for choosing the guide
}

interface Path {
  pos: number; // reading index where the current/next unit starts
  unit: Unit | null;
  spelling: string;
  offset: number;
  committed: CommittedUnit[];
}

export class TypingSession {
  private readonly reading: string;
  private readonly units: Unit[][];
  private readonly prefs: Record<string, string>;
  private paths: Path[];
  private _typed = '';
  private _guide = '';
  private _complete = false;
  private completedPath: Path | null = null;

  constructor(reading: string, opts: SessionOptions = {}) {
    this.reading = normalizeReading(reading);
    this.prefs = opts.prefs ?? {};
    this.units = [];
    for (let i = this.reading.length - 1; i >= 0; i--) this.units[i] = this.buildUnits(i);
    this.paths = [{ pos: 0, unit: null, spelling: '', offset: 0, committed: [] }];
    this._complete = this.reading.length === 0;
    this._guide = this.computeGuide();
  }

  get typed() { return this._typed; }
  get guide() { return this._guide; }
  get complete() { return this._complete; }

  get expected(): string[] {
    if (this._complete) return [];
    const set = new Set<string>();
    for (const p of this.paths) {
      if (p.unit) set.add(p.spelling[p.offset]);
      else for (const u of this.units[p.pos] ?? []) for (const s of u.spellings) set.add(s[0]);
    }
    return [...set].sort();
  }

  get kanaDone(): number {
    if (this._complete) return this.reading.length;
    let min = Infinity;
    for (const p of this.paths) min = Math.min(min, p.pos);
    return min === Infinity ? 0 : min;
  }

  get committed(): CommittedUnit[] {
    return (this.completedPath ?? this.paths[0]).committed;
  }

  input(ch: string): InputResult {
    const expected = this.expected;
    if (this._complete || ch.length !== 1) return { accepted: false, completed: false, expected };

    const next: Path[] = [];
    const seen = new Set<string>();
    const push = (p: Path) => {
      // a path that finished its unit moves to the boundary
      if (p.unit && p.offset === p.spelling.length) {
        p = { pos: p.pos + p.unit.len, unit: null, spelling: '', offset: 0, committed: [...p.committed, { kana: p.unit.kana, romaji: p.spelling }] };
      }
      const key = p.unit ? `${p.pos}|${p.unit.len}|${p.spelling}|${p.offset}` : `${p.pos}`;
      if (seen.has(key)) return;
      seen.add(key);
      next.push(p);
    };

    let literal = false;
    for (const p of this.paths) {
      if (p.unit) {
        if (match(ch, p.spelling[p.offset], p.unit.literal)) {
          literal ||= p.unit.literal;
          push({ ...p, offset: p.offset + 1 });
        }
      } else {
        for (const u of this.units[p.pos] ?? []) {
          for (const s of u.spellings) {
            if (match(ch, s[0], u.literal)) {
              literal ||= u.literal;
              push({ pos: p.pos, unit: u, spelling: s, offset: 1, committed: p.committed });
            }
          }
        }
      }
    }

    if (!next.length) return { accepted: false, completed: false, expected };

    // ASCII literals keep their case; kana spellings are shown in lowercase
    this._typed += literal ? ch : ch.toLowerCase();
    const done = next.find((p) => !p.unit && p.pos === this.reading.length);
    if (done) {
      this._complete = true;
      this.completedPath = done;
      this.paths = [done];
      this._guide = this._typed;
      return { accepted: true, completed: true, expected };
    }
    this.paths = next;
    if (!this._guide.startsWith(this._typed)) this._guide = this.computeGuide();
    return { accepted: true, completed: false, expected };
  }

  // ---- unit construction -------------------------------------------------

  private buildUnits(i: number): Unit[] {
    const r = this.reading;
    const ch = r[i];
    const units: Unit[] = [];
    const two = r.slice(i, i + 2);

    if (COMBO[two]) units.push(this.unit(two, COMBO[two], 1));

    if (ch === 'ん') {
      const nextCh = r[i + 1];
      // single n only when a kana follows that cannot start with a vowel, y or n
      const singleOk = nextCh !== undefined && /[\u3041-\u3096]/.test(nextCh) && !N_BLOCKERS.has(nextCh);
      units.push(this.unit('ん', singleOk ? ['nn', 'xn', 'n'] : ['nn', 'xn'], 1));
    } else if (ch === 'っ') {
      units.push(this.unit('っ', ['xtu', 'ltu', 'xtsu', 'ltsu'], 1.5));
      // doubled consonant of any spelling of the following unit
      for (const u of this.units[i + 1] ?? []) {
        if (u.literal) continue;
        const doubled = u.spellings.filter((s) => !VOWELS.has(s[0]) && !'nxl-,./[]~'.includes(s[0])).map((s) => s[0] + s);
        // IME style っち = tchi, っちゃ = tcha
        for (const s of u.spellings) if (s.startsWith('ch')) doubled.push('t' + s);
        if (doubled.length) units.push(this.unit('っ' + u.kana, doubled, u.cost));
      }
    } else if (BASE[ch]) {
      units.push(this.unit(ch, BASE[ch], 1));
    } else {
      units.push({ kana: ch, len: 1, spellings: [ch], literal: true, cost: 1 });
    }
    return units;
  }

  private unit(kana: string, spellings: string[], cost: number): Unit {
    return { kana, len: [...kana].length, spellings, literal: false, cost };
  }

  // ---- guide -------------------------------------------------------------

  private computeGuide(): string {
    // the player's choices in this word override stored prefs for the rest of it
    let best: { text: string; cost: number } | null = null;
    for (const p of this.paths) {
      const local: Record<string, string> = { ...this.prefs };
      for (const c of p.committed) local[c.kana] = c.romaji;
      const restOfUnit = p.unit ? p.spelling.slice(p.offset) : '';
      const from = p.unit ? p.pos + p.unit.len : p.pos;
      const tail = this.bestFrom(from, local);
      if (!best || tail.cost < best.cost) best = { text: restOfUnit + tail.text, cost: tail.cost };
    }
    return this._typed + (best?.text ?? '');
  }

  private bestFrom(start: number, prefs: Record<string, string>): { text: string; cost: number } {
    const n = this.reading.length;
    const cost: number[] = new Array(n + 1).fill(Infinity);
    const text: string[] = new Array(n + 1).fill('');
    cost[n] = 0;
    for (let i = n - 1; i >= start; i--) {
      for (const u of this.units[i]) {
        const j = i + u.len;
        if (cost[j] === Infinity) continue;
        const c = u.cost + cost[j];
        if (c < cost[i]) {
          cost[i] = c;
          text[i] = pick(u, prefs) + text[j];
        }
      }
    }
    return { text: text[start] ?? '', cost: cost[start] ?? 0 };
  }
}

function pick(u: Unit, prefs: Record<string, string>): string {
  const pref = prefs[u.kana];
  if (pref && u.spellings.includes(pref)) return pref;
  if (u.kana.startsWith('っ') && u.kana.length > 1) {
    // doubled form of the preferred spelling of the following unit
    const inner = prefs[u.kana.slice(1)];
    if (inner && u.spellings.includes(inner[0] + inner)) return inner[0] + inner;
  }
  return u.spellings[0];
}

function match(ch: string, want: string | undefined, literal: boolean): boolean {
  if (want === undefined) return false;
  return literal ? ch === want : ch.toLowerCase() === want;
}
