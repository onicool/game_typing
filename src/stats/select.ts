import { TypingSession } from '../engine/romaji';
import { seededRandom, uniqueWords, WordStream, type Dictionary, type Word } from '../content/words';
import type { WordSource } from '../game/round';
import type { Vuln } from './types';

export type Role = 'ordinary' | 'weak' | 'probe';
export interface Pick { word: Word; id: string; role: Role; target: string | null; prob: number }

export function targetsInWord(reading: string, prefs: Record<string, string>): string[] {
  const guide = new TypingSession(reading, { prefs }).guide;
  const targets = new Set<string>();
  for (let i = 0; i < guide.length; i++) {
    targets.add(guide[i]);
    if (i) targets.add(`${guide[i - 1]}→${guide[i]}`);
  }
  return [...targets];
}

function hash(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** Stable holdout partition (~15%), independent of session seed and weaknesses. */
export const isProbeWord = (id: string): boolean => hash(id) % 100 < 15;

export class BenchmarkSource implements WordSource {
  private readonly stream: WordStream;
  readonly seed: number;
  readonly poolSize: number;

  constructor(dict: Dictionary, seed?: number) {
    this.stream = new WordStream(dict, seed);
    this.seed = this.stream.seed;
    this.poolSize = this.stream.poolSize;
  }

  next(): Pick {
    const word = this.stream.next();
    return { word, id: word.id!, role: 'ordinary', target: null, prob: 1 / this.poolSize };
  }
}

interface Candidate { word: Word; id: string; targets: string[] }
interface WeakTarget { vuln: Vuln; words: Candidate[] }
const BLOCK: Role[] = [
  'ordinary', 'ordinary', 'weak', 'weak', 'ordinary',
  'ordinary', 'weak', 'ordinary', 'probe', 'ordinary',
  'ordinary', 'weak', 'weak', 'ordinary', 'ordinary',
  'weak', 'ordinary', 'ordinary', 'ordinary', 'probe',
];

/**
 * 12/6/2 slots per block. prob is an estimated marginal, conditional on the
 * current cooldown: slot share × word chance, summed across eligible targets
 * AND roles. Unavailable weak/probe slot shares transfer to ordinary words.
 * Thompson winner probabilities use a softmax surrogate of posterior means;
 * they are approximate and are not suitable for exact inverse propensity weights.
 * Probe eligibility requires a supplied target label. Among matching holdouts,
 * words/targets use fixed hash order, independent of impact, uncertainty or focus.
 */
export class PatchSource implements WordSource {
  readonly seed: number;
  shortages = 0;
  /** Only non-probe pools of <=8 words may require relaxing the cooldown to continue. */
  cooldownRelaxations = 0;
  private readonly random: () => number;
  private readonly ordinary: Candidate[];
  private readonly probes: Candidate[];
  private readonly weak: WeakTarget[];
  private prefsSignature: string | null = null;
  private readonly focus?: string;
  private readonly seenProbes = new Set<string>();
  private recent: string[] = [];
  private position = 0;

  constructor(words: Word[], dictId: string, vulns: Vuln[], private readonly prefs: Record<string, string>,
    opts: { seed: number; focus?: string }) {
    this.seed = opts.seed >>> 0;
    this.random = seededRandom(this.seed);
    this.focus = opts.focus;
    const candidates = uniqueWords(words, dictId).map(word => ({
      word, id: word.id!, targets: [] as string[],
    }));
    this.ordinary = candidates.filter(word => !isProbeWord(word.id))
      .sort((a, b) => a.word.reading.length - b.word.reading.length || a.id.localeCompare(b.id));
    this.probes = candidates.filter(word => isProbeWord(word.id))
      .sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
    if (!this.ordinary.length) throw new Error('Patch mode needs at least one non-probe word');
    const labels = new Set<string>();
    this.weak = vulns.filter(vuln => {
      if (labels.has(vuln.label)) return false;
      labels.add(vuln.label);
      return true;
    }).map(vuln => ({
      vuln: { ...vuln }, words: [],
    }));
  }

  next(): Pick {
    this.refreshTargets();
    const role = BLOCK[this.position++ % BLOCK.length];
    let pick: Pick | null = role === 'weak' ? this.pickWeak() : role === 'probe' ? this.pickProbe() : null;
    if (!pick) {
      if (role !== 'ordinary') this.shortages++;
      pick = this.pickOrdinary();
    }
    pick.prob = this.estimateProbability(pick);
    this.recent.push(pick.id);
    if (this.recent.length > 8) this.recent.shift();
    return pick;
  }

  private refreshTargets(): void {
    const signature = JSON.stringify(this.prefs);
    if (signature === this.prefsSignature) return;
    this.prefsSignature = signature;
    // Cache repeated readings for this preference signature. Round learns in place.
    const byReading = new Map<string, string[]>();
    const labels = new Set(this.weak.map(target => target.vuln.label));
    for (const word of [...this.ordinary, ...this.probes]) {
      let targets = byReading.get(word.word.reading);
      if (!targets) {
        targets = targetsInWord(word.word.reading, this.prefs);
        byReading.set(word.word.reading, targets);
      }
      word.targets = isProbeWord(word.id) ? targets.filter(target => labels.has(target)) : targets;
    }
    for (const target of this.weak) {
      target.words = this.ordinary.filter(word => word.targets.includes(target.vuln.label));
    }
  }

  private availableProbes(): Candidate[] {
    return this.available(this.probes).filter(word => word.targets.length > 0);
  }

  private available(words: Candidate[]): Candidate[] {
    return words.filter(word => !this.recent.includes(word.id));
  }

  private choose(words: Candidate[]): Candidate {
    return words[Math.floor(this.random() * words.length)];
  }

  private pickOrdinary(): Pick {
    let words = this.available(this.ordinary);
    if (!words.length) {
      // Impossible cooldown in tiny custom dictionaries: retain the probe holdout.
      this.shortages++;
      this.cooldownRelaxations++;
      const oldest = this.recent.find(id => this.ordinary.some(word => word.id === id));
      words = this.ordinary.filter(word => word.id === oldest);
    }
    const shortest = new Set(this.ordinary.slice(0, Math.ceil(this.ordinary.length / 2)).map(word => word.id));
    const easy = words.filter(word => shortest.has(word.id));
    const word = this.choose(easy.length && this.random() < 0.8 ? easy : words);
    return { word: word.word, id: word.id, role: 'ordinary', target: null, prob: 0 };
  }

  private normal(): number {
    return Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, this.random()))) * Math.cos(2 * Math.PI * this.random());
  }

  private spread(vuln: Vuln): number {
    const scale = (Math.max(0, vuln.impact) + 100) / Math.sqrt(Math.max(0, vuln.n) + 1);
    return vuln.severity === 'INVESTIGATING' ? Math.max(100, scale * 2) : Math.max(5, scale);
  }

  private mean(vuln: Vuln): number {
    return Math.max(0, vuln.impact) + (vuln.label === this.focus ? 100 : 0);
  }

  private pickWeak(): Pick | null {
    const targets = this.weak.map(target => ({ ...target, words: this.available(target.words) }))
      .filter(target => target.words.length);
    if (!targets.length) return null;
    const scores = targets.map(({ vuln }) => this.mean(vuln) + this.normal() * this.spread(vuln));
    const winner = targets[scores.indexOf(Math.max(...scores))];
    const word = this.choose(winner.words);
    return { word: word.word, id: word.id, role: 'weak', target: winner.vuln.label, prob: 0 };
  }

  private estimateProbability(pick: Pick): number {
    if (pick.role === 'probe') return 0.1; // Fixed next holdout, disjoint from the training pool.
    const targets = this.weak.map(target => ({ ...target, words: this.available(target.words) }))
      .filter(target => target.words.length);
    const ordinaryShare = 0.6 + (targets.length ? 0 : 0.3) + (this.availableProbes().length ? 0 : 0.1);
    const words = this.available(this.ordinary);
    const easyIds = new Set(this.ordinary.slice(0, Math.ceil(this.ordinary.length / 2)).map(word => word.id));
    const easyCount = words.filter(word => easyIds.has(word.id)).length;
    const ordinaryChance = !words.length ? 1 : easyCount
      ? 0.2 / words.length + (easyIds.has(pick.id) ? 0.8 / easyCount : 0) : 1 / words.length;
    if (!targets.length) return ordinaryShare * ordinaryChance;
    const scale = Math.max(100, ...targets.map(({ vuln }) => this.spread(vuln)));
    const maxMean = Math.max(...targets.map(({ vuln }) => this.mean(vuln)));
    const weights = targets.map(({ vuln }) => Math.exp((this.mean(vuln) - maxMean) / scale));
    const sum = weights.reduce((a, b) => a + b, 0);
    const weakChance = targets.reduce((p, target, i) => p + (target.words.some(word => word.id === pick.id)
      ? weights[i] / sum / target.words.length : 0), 0);
    return ordinaryShare * ordinaryChance + 0.3 * weakChance;
  }

  private pickProbe(): Pick | null {
    const words = this.availableProbes();
    if (!words.length) return null;
    const unseen = words.filter(word => !this.seenProbes.has(word.id));
    const word = (unseen.length ? unseen : words)[0];
    this.seenProbes.add(word.id);
    const targets = [...word.targets].sort();
    return { word: word.word, id: word.id, role: 'probe', target: targets[hash(word.id) % targets.length], prob: 0.1 };
  }
}
