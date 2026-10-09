import { TypingSession, normalizeReading } from '../engine/romaji';
import type { Dictionary, Word } from '../content/words';
import { BenchmarkSource, targetsInWord, type Pick } from '../stats/select';
import { loadBaselines, type Baselines } from '../stats/baselines';

export interface WordSource { next(): Pick }
export interface RoundOptions {
  mode?: 'benchmark' | 'patch' | 'passage' | 'journey';
  /** Finite, untimed route. Only used by journey mode. */
  wordLimit?: number;
  source?: WordSource;
  baselines?: Baselines;
  seed?: number;
}

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
  wordId?: string;
  role?: 'ordinary' | 'weak' | 'probe';
  target?: string | null;
  afterPause?: boolean;
  prob?: number;
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
  readonly mode: 'benchmark' | 'patch' | 'passage' | 'journey';
  readonly wordLimit: number;
  readonly seed: number;
  readonly log: KeyLog[] = [];
  startT: number | null = null;
  endT: number | null = null;

  word!: Word;
  session!: TypingSession;
  nextWord!: Word;
  followingWord!: Word;

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

  private readonly source: WordSource;
  private readonly baselines: Baselines;
  private pick: Pick;
  /** Provenance of the word being typed (role/target), for display. */
  get currentPick(): Pick { return this.pick; }
  private nextPick: Pick;
  private followingPick: Pick;
  private pausedAt: number | null = null;
  private pausedMs = 0;
  private wasInterrupted = false;
  private afterPausePending = false;
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

  constructor(dict: Dictionary, private prefs: Record<string, string>, opts: RoundOptions = {}) {
    this.mode = opts.mode ?? 'benchmark';
    this.wordLimit = this.mode === 'journey' ? (opts.wordLimit ?? 5) : Infinity;
    if (this.mode === 'journey' && (!Number.isInteger(this.wordLimit) || this.wordLimit < 1)) {
      throw new Error('Journey needs a positive finite word limit');
    }
    const sourceSeed = opts.source && 'seed' in opts.source && typeof opts.source.seed === 'number' ? opts.source.seed : undefined;
    this.seed = (opts.seed ?? sourceSeed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
    this.source = opts.source ?? new BenchmarkSource(dict, this.seed);
    this.baselines = new Map([...(opts.baselines ?? loadBaselines(dict))].map(([pair, value]) => [pair, { ...value }]));
    this.foldCase = dict.id.startsWith('jp');
    this.pick = this.source.next();
    this.nextPick = this.source.next();
    this.followingPick = this.source.next();
    this.word = this.pick.word;
    this.nextWord = this.nextPick.word;
    this.followingWord = this.followingPick.word;
    this.session = new TypingSession(this.word.reading, { prefs });
  }

  get started() { return this.startT !== null; }
  get finished() { return this.endT !== null; }
  get paused() { return this.pausedAt !== null; }
  get interrupted() { return this.wasInterrupted; }

  pause(t: number): void {
    if (this.paused || this.finished) return;
    this.checkDeadline(t);
    if (this.finished) return;
    this.pausedAt = t;
    if (this.started) this.wasInterrupted = true;
  }

  resume(t: number): void {
    if (this.pausedAt === null) return;
    if (this.started) this.pausedMs += Math.max(0, t - this.pausedAt);
    this.pausedAt = null;
    this.afterPausePending = true;
  }

  elapsedMs(now: number): number {
    if (this.startT === null) return 0;
    return Math.max(0, (this.endT ?? this.pausedAt ?? now) - this.startT - this.pausedMs);
  }

  private checkDeadline(now: number): void {
    if (this.mode === 'passage' || this.mode === 'journey') return;
    if (!this.paused && this.started && !this.finished && this.elapsedMs(now) >= ROUND_MS) {
      this.endT = this.startT! + this.pausedMs + ROUND_MS;
    }
  }

  remainingMs(now: number) {
    if (this.mode === 'passage' || this.mode === 'journey') return Infinity;
    return Math.max(0, ROUND_MS - this.elapsedMs(now));
  }

  /** Explicit practice finish also preserves the frozen clock while paused. */
  finish(t: number): void {
    if (!this.finished && (this.mode === 'patch' || ((this.mode === 'passage' || this.mode === 'journey') && this.started))) this.endT = this.pausedAt ?? t;
  }

  accuracy(): number { return this.correct + this.misses ? this.correct / (this.correct + this.misses) : 1; }

  totalKana() { return this.kanaDone + ((this.mode === 'passage' || this.mode === 'journey') && this.session.complete ? 0 : this.session.kanaDone); }

  /** Integrity of the current firewall, 1 = intact. */
  integrity() {
    const len = normalizeReading(this.word.reading).length || 1;
    const partial = Math.min(1, this.session.kanaDone / len);
    return Math.max(0, 1 - (this.layer + partial) / LAYERS_PER_FIREWALL);
  }

  tick(now: number, dt: number) {
    if (this.paused || this.finished) return;
    this.trace = Math.max(0, this.trace - dt * 1.5);
    this.checkDeadline(now);
  }

  input(rawKey: string, t: number, code = ''): KeyOutcome {
    const out: KeyOutcome = { late: false, accepted: false, critical: false, criticalGainMs: 0, wordDone: false, firewallDone: false, stageChanged: false };
    this.checkDeadline(t);
    if (this.finished) {
      out.late = true;
      return out;
    }
    if (this.paused) return out;
    if (this.startT === null) this.startT = t;
    const key = this.foldCase ? rawKey.toLowerCase() : rawKey;
    const res = this.session.input(rawKey);
    const dt = this.lastAcceptT === null || this.afterPausePending ? NaN : t - this.lastAcceptT;
    const entry: KeyLog = {
      t, key, code, correct: res.accepted, expected: res.expected, prevKey: this.lastKey,
      dt, wordStart: this.wordStartPending, afterMiss: this.missedSinceAccept, intended: null,
      afterPause: this.afterPausePending,
      wordId: this.pick.id, role: this.pick.role, target: this.pick.target, prob: this.pick.prob,
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
    const clean = !this.wordStartPending && !this.missedSinceAccept && !this.afterPausePending && isTiming(dt);
    if (clean) {
      // critical = clearly faster than this transition's own baseline
      const base = this.baseline(this.lastKey!, key);
      const personal = this.baselines.get(`${this.lastKey}${key}`);
      const ready = personal ? personal.n >= 8 : this.intervals.length >= 10;
      if (ready && Number.isFinite(base) && dt < base * (personal ? 0.7 : 0.68)) {
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
    this.afterPausePending = false;
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
      if (this.mode === 'passage' || (this.mode === 'journey' && this.wordsDone >= this.wordLimit)) { this.endT = t; return out; }
      this.pick = this.nextPick;
      // Keep the promised word order. Learning a spelling can invalidate a
      // buffered target, but must not swap a word the player already previewed.
      if (this.pick.target && !targetsInWord(this.pick.word.reading, this.prefs).includes(this.pick.target)) {
        this.pick = { ...this.pick, role: this.pick.role === 'probe' ? 'probe' : 'ordinary', target: null };
      }
      this.nextPick = this.followingPick;
      this.followingPick = this.source.next();
      this.word = this.pick.word;
      this.nextWord = this.nextPick.word;
      this.followingWord = this.followingPick.word;
      this.session = new TypingSession(this.word.reading, { prefs: this.prefs });
      this.wordStartPending = true;
      this.lastKey = null; // No cross-word transitions, even for downstream legacy consumers.
    }
    return out;
  }

  /** Frozen personal baseline, falling back to round-local estimates only for missing pairs. */
  private baseline(prev: string, key: string) {
    const personal = this.baselines.get(`${prev}${key}`);
    if (personal) return Math.exp(personal.meanLog);
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
    const recent = this.log.filter((e) => e.correct && !e.wordStart && !e.afterMiss && !e.afterPause && isTiming(e.dt)).slice(-n);
    if (recent.length < n) return false;
    const res = recent.map((e) => Math.log(e.dt) - Math.log(this.baseline(e.prevKey ?? '', e.key)));
    const mean = res.reduce((a, b) => a + b, 0) / res.length;
    const sd = Math.sqrt(res.reduce((a, b) => a + (b - mean) ** 2, 0) / res.length);
    const acc = this.recentCorrect.filter(Boolean).length / this.recentCorrect.length;
    const personalResiduals = recent.flatMap(e => {
      const base = this.baselines.get(`${e.prevKey}${e.key}`);
      return base ? [Math.log(e.dt) - base.meanLog] : [];
    });
    const notSlow = this.baselines.size
      ? personalResiduals.length > 0 && personalResiduals.reduce((a, b) => a + b, 0) / personalResiduals.length <= 0.05
      : Number.isFinite(this.bestMedian) && median(recent.map((e) => e.dt)) <= this.bestMedian * 1.2;
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
    const duration = this.elapsedMs(performance.now());
    const elapsed = (this.mode === 'passage' || this.mode === 'journey' ? duration : Math.min(ROUND_MS, duration)) / 1000 || 1;
    const clean = this.log.filter((e) => e.correct && !e.wordStart && !e.afterMiss && !e.afterPause && isTiming(e.dt) && e.dt < 2000);
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
      accuracy: this.accuracy(),
      misses: this.misses,
      maxChain: this.maxChain,
      layers: this.layersTotal,
      firewalls: this.firewalls,
      slowBigram: slow,
      missedKey,
    };
  }
}
