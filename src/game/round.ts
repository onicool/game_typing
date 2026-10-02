import { TypingSession, normalizeReading } from '../engine/romaji';
import { WordStream, type Dictionary, type Word } from '../content/words';

export const ROUND_MS = 60_000;
export const LAYERS_PER_FIREWALL = 5;

export interface KeyLog {
  t: number;
  /** Key as pressed; letters are lowercased for kana dictionaries (case does not matter there). */
  key: string;
  code: string;
  correct: boolean;
  expected: string[];
  prevKey: string | null;
  dt: number; // ms since previous accepted key (NaN for the very first)
  wordStart: boolean;
  afterMiss: boolean;
  /** For misses: the key eventually accepted at that position. */
  intended: string | null;
}

export interface KeyOutcome {
  /** The key arrived after the round ended and was ignored. */
  late: boolean;
  accepted: boolean;
  critical: boolean;
  criticalGainMs: number;
  wordDone: boolean;
  firewallDone: boolean;
  stageChanged: boolean;
}

export interface RoundResult {
  kanaPerSec: number;
  keysPerMin: number;
  accuracy: number;
  misses: number;
  maxChain: number;
  layers: number;
  firewalls: number;
  slowBigram: { pair: string; excessMs: number; count: number } | null;
  missedKey: { key: string; count: number } | null;
}

/** Usable transition interval: finite and positive (log() of 0 would poison the stats). */
const isTiming = (dt: number) => Number.isFinite(dt) && dt > 0;

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class Round {
  readonly log: KeyLog[] = [];
  startT: number | null = null;
  endT: number | null = null;

  word!: Word;
  session!: TypingSession;
  nextWord!: Word;

  chain = 0;
  maxChain = 0;
  stage = 0;
  trace = 0;
  layer = 0; // layers broken on the current firewall
  layersTotal = 0;
  firewalls = 0;
  wordsDone = 0;
  kanaDone = 0; // completed words only
  misses = 0;
  correct = 0;

  private stream: WordStream;
  private lastAcceptT: number | null = null;
  private lastKey: string | null = null;
  private missedSinceAccept = false;
  private wordStartPending = true;
  private intervals: number[] = []; // recent within-word intervals (ms)
  private bigramMean = new Map<string, { n: number; logSum: number }>();
  private keysSinceStageUp = 0;
  private recentCorrect: boolean[] = [];
  private pendingMisses = 0;
  /** Misses attributed to the key the player eventually typed at that position. */
  private missByKey = new Map<string, number>();
  private pendingMissLogs: KeyLog[] = [];
  private belowTarget = 0;
  /** Fastest settled median this round: a reference that does not drift with a slowdown. */
  private bestMedian = Infinity;
  private readonly foldCase: boolean;

  constructor(dict: Dictionary, private prefs: Record<string, string>) {
    this.foldCase = dict.id.startsWith('jp');
    this.stream = new WordStream(dict);
    this.word = this.stream.next();
    this.nextWord = this.stream.next();
    this.session = new TypingSession(this.word.reading, { prefs });
  }

  get started() { return this.startT !== null; }
  get finished() { return this.endT !== null; }

  remainingMs(now: number) {
    if (this.startT === null) return ROUND_MS;
    return Math.max(0, ROUND_MS - (now - this.startT));
  }

  totalKana() { return this.kanaDone + this.session.kanaDone; }

  /** Integrity of the current firewall, 1 = intact. */
  integrity() {
    const len = normalizeReading(this.word.reading).length || 1;
    const partial = Math.min(1, this.session.kanaDone / len);
    return Math.max(0, 1 - (this.layer + partial) / LAYERS_PER_FIREWALL);
  }

  tick(now: number, dt: number) {
    this.trace = Math.max(0, this.trace - dt * 1.5);
    if (this.startT !== null && !this.finished && now - this.startT >= ROUND_MS) this.endT = this.startT + ROUND_MS;
  }

  input(rawKey: string, t: number, code = ''): KeyOutcome {
    const out: KeyOutcome = { late: false, accepted: false, critical: false, criticalGainMs: 0, wordDone: false, firewallDone: false, stageChanged: false };
    if (this.startT !== null && t - this.startT >= ROUND_MS) this.endT ??= this.startT + ROUND_MS;
    if (this.finished) {
      out.late = true;
      return out;
    }
    if (this.startT === null) this.startT = t;
    const key = this.foldCase ? rawKey.toLowerCase() : rawKey;
    const res = this.session.input(rawKey);
    const dt = this.lastAcceptT === null ? NaN : t - this.lastAcceptT;
    const entry: KeyLog = {
      t, key, code, correct: res.accepted, expected: res.expected, prevKey: this.lastKey,
      dt, wordStart: this.wordStartPending, afterMiss: this.missedSinceAccept, intended: null,
    };
    this.log.push(entry);
    this.recentCorrect.push(res.accepted);
    if (this.recentCorrect.length > 30) this.recentCorrect.shift();

    if (!res.accepted) {
      this.misses++;
      this.chain = 0;
      this.missedSinceAccept = true;
      this.pendingMisses++;
      this.pendingMissLogs.push(entry);
      this.trace = Math.min(100, this.trace + 6);
      if (this.stage > 0) {
        this.stage--;
        out.stageChanged = true;
      }
      this.keysSinceStageUp = 0;
      return out;
    }

    out.accepted = true;
    if (this.pendingMisses) {
      this.missByKey.set(key, (this.missByKey.get(key) ?? 0) + this.pendingMisses);
      for (const m of this.pendingMissLogs) m.intended = key;
      this.pendingMissLogs = [];
      this.pendingMisses = 0;
    }
    this.correct++;
    this.chain++;
    this.maxChain = Math.max(this.maxChain, this.chain);

    // timing features: only clean within-word transitions
    const clean = !this.wordStartPending && !this.missedSinceAccept && isTiming(dt);
    if (clean) {
      // critical = clearly faster than this transition's own baseline
      const base = this.baseline(this.lastKey!, key);
      if (this.intervals.length >= 10 && Number.isFinite(base) && dt < base * 0.68) {
        out.critical = true;
        out.criticalGainMs = base - dt;
      }
      this.intervals.push(dt);
      if (this.intervals.length > 40) this.intervals.shift();
      if (this.intervals.length >= 20) this.bestMedian = Math.min(this.bestMedian, median(this.intervals));
      const k = `${this.lastKey}${key}`;
      const b = this.bigramMean.get(k) ?? { n: 0, logSum: 0 };
      b.n++;
      b.logSum += Math.log(dt);
      this.bigramMean.set(k, b);
      out.stageChanged = this.updateStage();
    }

    this.lastAcceptT = t;
    this.lastKey = key;
    this.missedSinceAccept = false;
    this.wordStartPending = false;

    if (res.completed) {
      out.wordDone = true;
      this.wordsDone++;
      this.kanaDone += normalizeReading(this.word.reading).length;
      for (const u of this.session.committed) this.prefs[u.kana] = u.romaji;
      this.layer++;
      this.layersTotal++;
      if (this.layer >= LAYERS_PER_FIREWALL) {
        this.layer = 0;
        this.firewalls++;
        out.firewallDone = true;
      }
      this.word = this.nextWord;
      this.nextWord = this.stream.next();
      this.session = new TypingSession(this.word.reading, { prefs: this.prefs });
      this.wordStartPending = true;
    }
    return out;
  }

  /** Personal baseline for a transition: this round's bigram mean, else recent median. */
  private baseline(prev: string, key: string) {
    const b = this.bigramMean.get(`${prev}${key}`);
    if (b && b.n >= 3) return Math.exp(b.logSum / b.n);
    return median(this.intervals);
  }

  /**
   * Overclock: rewards a steady personal tempo. Measures the spread of
   * log-residuals against each transition's own baseline (not raw intervals),
   * gated by accuracy and by not being slower than usual.
   */
  private updateStage(): boolean {
    this.keysSinceStageUp++;
    const n = 16;
    const recent = this.log.filter((e) => e.correct && !e.wordStart && !e.afterMiss && isTiming(e.dt)).slice(-n);
    if (recent.length < n) return false;
    const res = recent.map((e) => Math.log(e.dt) - Math.log(this.baseline(e.prevKey ?? '', e.key)));
    const mean = res.reduce((a, b) => a + b, 0) / res.length;
    const sd = Math.sqrt(res.reduce((a, b) => a + (b - mean) ** 2, 0) / res.length);
    const acc = this.recentCorrect.filter(Boolean).length / this.recentCorrect.length;
    const notSlow = Number.isFinite(this.bestMedian) && median(recent.map((e) => e.dt)) <= this.bestMedian * 1.2;
    let target = 0;
    if (acc >= 0.93 && notSlow) target = sd < 0.22 ? 3 : sd < 0.3 ? 2 : sd < 0.4 ? 1 : 0;
    target = Math.min(target, this.chain >= 60 ? 3 : this.chain >= 30 ? 2 : this.chain >= 12 ? 1 : 0);
    this.belowTarget = target < this.stage ? this.belowTarget + 1 : 0;
    if (target > this.stage && this.keysSinceStageUp >= 8) {
      this.stage++;
      this.keysSinceStageUp = 0;
      return true;
    }
    // sustained loss of rhythm steps down one stage at a time
    if (this.belowTarget >= 6) {
      this.stage--;
      this.belowTarget = 0;
      return true;
    }
    return false;
  }

  result(): RoundResult {
    const elapsed = ((this.endT ?? performance.now()) - (this.startT ?? 0)) / 1000 || 1;
    const clean = this.log.filter((e) => e.correct && !e.wordStart && !e.afterMiss && isTiming(e.dt) && e.dt < 2000);
    const overall = median(clean.map((e) => e.dt));
    const groups = new Map<string, number[]>();
    for (const e of clean) {
      const k = `${e.prevKey}→${e.key}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(e.dt);
    }
    let slow: RoundResult['slowBigram'] = null;
    let worst = 0;
    for (const [pair, xs] of groups) {
      if (xs.length < 4) continue;
      const excess = median(xs) - overall;
      const impact = excess * xs.length;
      if (excess > 15 && impact > worst) {
        worst = impact;
        slow = { pair, excessMs: excess, count: xs.length };
      }
    }
    let missedKey: RoundResult['missedKey'] = null;
    for (const [key, count] of this.missByKey) if (count >= 3 && (!missedKey || count > missedKey.count)) missedKey = { key, count };

    return {
      kanaPerSec: this.totalKana() / elapsed,
      keysPerMin: (this.correct / elapsed) * 60,
      accuracy: this.correct + this.misses ? this.correct / (this.correct + this.misses) : 1,
      misses: this.misses,
      maxChain: this.maxChain,
      layers: this.layersTotal,
      firewalls: this.firewalls,
      slowBigram: slow,
      missedKey,
    };
  }
}
