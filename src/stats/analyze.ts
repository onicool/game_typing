import { FINGER } from './layout';
import type { BigramStat, KeyStat, Report, Severity, StoredKey, Vuln } from './types';

// Tunable empirical-Bayes strength for both log latency and Beta miss priors.
const PRIOR = 8;
const RECOVERY_FALLBACK = 600;
const MISS_PRIOR_MISSES = 3;
const INCOMING = Object.keys(FINGER);
const isKnown = (key: string): boolean => Object.hasOwn(FINGER, key);

interface Moments { n: number; misses: number; clean: number; logSum: number; logSq: number }
interface Group extends Moments { parent: string | null }
interface Pair extends Moments {
  from: string | null;
  to: string;
  group: string;
  recovery: number[];
}
interface Target extends Moments {
  incoming: Map<string | null, Pair>;
  other: Moments;
  recovery: number[];
}
interface Session {
  events: StoredKey[];
  latencies: number[];
  correct: number;
  ordered: boolean;
  lastTime: number;
}
const moments = (): Moments => ({ n: 0, misses: 0, clean: 0, logSum: 0, logSq: 0 });

function movement(from: string | null, to: string): string {
  if (from === null || !isKnown(from) || !isKnown(to)) return 'global';
  const a = FINGER[from], b = FINGER[to];
  if (a.hand !== b.hand) return 'alternating';
  if (a.finger === b.finger) return `finger-${a.hand}-${a.finger}`;
  return `hand-${a.hand}`;
}

function add(m: Moments, correct: boolean, log: number | null): void {
  m.n++;
  if (!correct) m.misses++;
  if (log !== null) { m.clean++; m.logSum += log; m.logSq += log * log; }
}

// In-place quickselect keeps medians linear rather than sorting 200k latencies.
function median(values: number[], fallback = 0): number {
  if (!values.length) return fallback;
  const middle = Math.floor(values.length / 2);
  let left = 0, right = values.length - 1;
  while (left < right) {
    const pivot = values[(left + right) >>> 1];
    let i = left, j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        [values[i], values[j]] = [values[j], values[i]];
        i++; j--;
      }
    }
    if (middle <= j) right = j;
    else if (middle >= i) left = i;
    else break;
  }
  if (values.length % 2) return values[middle];
  let lower = -Infinity;
  for (let i = 0; i < middle; i++) lower = Math.max(lower, values[i]);
  return (lower + values[middle]) / 2;
}

/**
 * Severity is judged on the conservative (lower 95%) impact so noise never
 * reads as an established weakness; a large mean impact that the data cannot
 * yet support stays INVESTIGATING.
 */
function severity(n: number, impact: number, sureImpact: number): Severity {
  if (n < 8) return 'INVESTIGATING';
  if (sureImpact >= 60) return 'CRITICAL';
  if (sureImpact >= 30) return 'HIGH';
  if (sureImpact >= 12) return 'MED';
  if (impact >= 12) return 'INVESTIGATING';
  return 'LOW';
}

const Z = 1.645;

function vulnerability(kind: Vuln['kind'], label: string, latency: number,
  baseline: number, rate: number, baseRate: number, frequency: number,
  recovery: number, n: number, sure: { latency: number; rate: number }): Vuln & { sureImpact: number } {
  let hash = 2166136261;
  for (const char of `${kind}:${label}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const excessMs = Math.max(0, latency - baseline);
  const missExcess = Math.max(0, rate - baseRate);
  // Own clean-transition shares are a placeholder for a future corpus table.
  const impact = 1000 * frequency * (excessMs + recovery * missExcess);
  const sureImpact = 1000 * frequency * (Math.max(0, sure.latency - baseline) + recovery * Math.max(0, sure.rate - baseRate));
  return {
    id: `VULN-${((hash >>> 0) % 10000).toString().padStart(4, '0')}`,
    kind, label, excessMs, missExcess, impact, severity: severity(n, impact, sureImpact), n, sureImpact,
  };
}

export function analyze(events: StoredKey[], opts?: { dict?: string }): Report {
  const targets = new Map<string, Target>();
  const groups = new Map<string, Group>();
  const sessions = new Map<string, Session>();
  const latencies: number[] = [];
  let sample = 0, correct = 0;

  function group(name: string): Group {
    let g = groups.get(name);
    if (!g) {
      const parent = name === 'global' ? null
        : name.startsWith('finger-') ? `hand-${name.split('-')[1]}` : 'global';
      g = { ...moments(), parent };
      groups.set(name, g);
      if (parent !== null) group(parent);
    }
    return g;
  }

  for (const event of events) {
    if (opts?.dict !== undefined && event.dict !== opts.dict) continue;
    sample++;
    if (event.correct) correct++;
    let session = sessions.get(event.session);
    if (!session) {
      session = { events: [], latencies: [], correct: 0, ordered: true, lastTime: -Infinity };
      sessions.set(event.session, session);
    }
    session.events.push(event);
    if (event.t < session.lastTime) session.ordered = false;
    session.lastTime = event.t;
    if (event.correct) session.correct++;
    const clean = event.correct && !event.wordStart && !event.afterMiss && !event.afterPause
      && Number.isFinite(event.dt) && event.dt > 0 && event.dt < 3000;
    const log = clean ? Math.log(event.dt) : null;
    if (clean) { latencies.push(event.dt); session.latencies.push(event.dt); }

    // Unresolved misses affect accuracy/the global prior, but never an arbitrary
    // expected key. Preserve case: kana recorders already normalize accepted keys.
    const to = event.correct ? event.key : event.intended;
    add(group('global'), event.correct, log);
    if (to === null) continue;
    let target = targets.get(to);
    if (!target) {
      target = { ...moments(), incoming: new Map(), other: moments(), recovery: [] };
      targets.set(to, target);
    }
    add(target, event.correct, log);
    // Reading/reaction attempts belong to the boundary stratum, even if a
    // legacy recorder retained the previous word's final accepted key.
    const from = event.wordStart ? null : event.prevKey;
    let pair = target.incoming.get(from);
    if (!pair) {
      pair = { ...moments(), from, to, group: movement(from, to), recovery: [] };
      target.incoming.set(from, pair);
    }
    add(pair, event.correct, log);
    if (from === null || !isKnown(from)) add(target.other, event.correct, log);
    let name: string | null = pair.group;
    while (name !== null && name !== 'global') {
      const g = group(name);
      add(g, event.correct, log);
      name = g.parent;
    }
  }
  if (!sample) return {
    sample: 0, sessions: 0, overallLatencyMs: 0, accuracy: 0,
    keys: [], bigrams: [], vulns: [], trend: [],
  };

  // Recoveries use timestamps, not dt (dt is measured from the last ACCEPTED
  // key). Each miss is paired with the next accepted key in its own session.
  for (const session of sessions.values()) {
    if (!session.ordered) session.events.sort((a, b) => a.t - b.t);
    const pending: StoredKey[] = [];
    for (const event of session.events) {
      if (!event.correct) { pending.push(event); continue; }
      for (const miss of pending) {
        const elapsed = event.t - miss.t;
        if (!Number.isFinite(elapsed) || elapsed < 0) continue;
        if (miss.intended === null || miss.afterPause || event.afterPause) continue;
        const target = targets.get(miss.intended)!;
        target.recovery.push(elapsed);
        target.incoming.get(miss.wordStart ? null : miss.prevKey)!.recovery.push(elapsed);
      }
      pending.length = 0;
    }
  }
  const overallMiss = (sample - correct) / sample;
  // Misses are rare events: a prior worth PRIOR observations would hold only a
  // fraction of a pseudo-miss, so one or two chance slips would look critical.
  // Size the Beta prior to carry about MISS_PRIOR_MISSES pseudo-misses instead.
  const missPrior = overallMiss > 0 ? Math.min(400, Math.max(PRIOR, MISS_PRIOR_MISSES / overallMiss)) : PRIOR;
  const global = group('global');
  const globalLog = global.clean ? global.logSum / global.clean : 0;
  const estimates = new Map<string, { log: number; rate: number }>();
  function baseline(name: string): { log: number; rate: number } {
    const cached = estimates.get(name);
    if (cached) return cached;
    const g = group(name);
    const parent = g.parent === null ? { log: globalLog, rate: overallMiss } : baseline(g.parent);
    const estimate = {
      log: (g.logSum + PRIOR * parent.log) / (g.clean + PRIOR),
      rate: (g.misses + missPrior * parent.rate) / (g.n + missPrior),
    };
    estimates.set(name, estimate);
    return estimate;
  }
  // spread of clean log-latencies, for the uncertainty of each posterior mean
  const logVar = global.clean > 1 ? Math.max(0, (global.logSq - global.logSum ** 2 / global.clean) / (global.clean - 1)) : 0;
  function posterior(m: Moments | undefined, name: string): { latency: number; rate: number; sure: { latency: number; rate: number } } {
    const base = baseline(name);
    if (!m) {
      const latency = latencies.length ? Math.exp(base.log) : 0;
      return { latency, rate: base.rate, sure: { latency, rate: base.rate } };
    }
    const log = (m.logSum + PRIOR * base.log) / (m.clean + PRIOR);
    const rate = (m.misses + missPrior * base.rate) / (m.n + missPrior);
    const seLog = Math.sqrt(logVar / (m.clean + PRIOR));
    const seRate = Math.sqrt((rate * (1 - rate)) / (m.n + missPrior));
    return {
      latency: latencies.length ? Math.exp(log) : 0,
      rate,
      sure: { latency: latencies.length ? Math.exp(log - Z * seLog) : 0, rate: Math.max(0, rate - Z * seRate) },
    };
  }

  const keys: KeyStat[] = [], bigrams: BigramStat[] = [], candidates: Vuln[] = [];
  const pairCandidates: { vuln: Vuln; pair: Pair }[] = [];
  for (const [key, target] of targets) {
    for (const pair of target.incoming.values()) {
      if (pair.from === null) continue;
      const value = posterior(pair, pair.group), base = baseline(pair.group);
      // n is attributed attempts; clean is the separate latency evidence count.
      bigrams.push({ from: pair.from, to: key, latencyMs: value.latency, missRate: value.rate, n: pair.n });
      const vuln = vulnerability('bigram', `${pair.from}→${key}`, value.latency,
        latencies.length ? Math.exp(base.log) : 0, value.rate, base.rate,
        pair.clean / (latencies.length || 1), median(pair.recovery, RECOVERY_FALLBACK), pair.n, value.sure);
      candidates.push(vuln);
      pairCandidates.push({ vuln, pair });
    }

    // Direct standardization: equal, FIXED weights for every mapped predecessor
    // plus one unknown/boundary stratum. Missing strata predict the group mean;
    // incoming corpus composition never determines the weights of a key score.
    let latency = 0, baseLatency = 0, rate = 0, baseRate = 0, sureLatency = 0, sureRate = 0;
    for (const from of [...INCOMING, null]) {
      const name = movement(from, key), base = baseline(name);
      const value = posterior(from === null ? target.other : target.incoming.get(from), name);
      latency += value.latency;
      baseLatency += latencies.length ? Math.exp(base.log) : 0;
      rate += value.rate;
      baseRate += base.rate;
      sureLatency += value.sure.latency;
      sureRate += value.sure.rate;
    }
    const weight = INCOMING.length + 1;
    latency /= weight; baseLatency /= weight; rate /= weight; baseRate /= weight; sureLatency /= weight; sureRate /= weight;
    keys.push({ key, latencyMs: latency, missRate: rate, n: target.n, misses: target.misses });
    candidates.push(vulnerability('key', key, latency, baseLatency, rate, baseRate,
      target.clean / (latencies.length || 1), median(target.recovery, RECOVERY_FALLBACK), target.n,
      { latency: sureLatency, rate: sureRate }));
  }
  // established weaknesses first (conservative impact), then by mean impact
  const sureOf = (v: Vuln) => (v as Vuln & { sureImpact: number }).sureImpact;
  const compare = (a: Vuln, b: Vuln): number => sureOf(b) - sureOf(a) || b.impact - a.impact
    || (a.kind === b.kind ? 0 : a.kind === 'bigram' ? -1 : 1) || a.label.localeCompare(b.label);
  candidates.sort(compare);
  const vulns: Vuln[] = [];
  for (const candidate of candidates) {
    vulns.push(candidate);
    if (candidate.kind === 'bigram') {
      const pair = pairCandidates.find(item => item.vuln === candidate)!.pair;
      for (let i = vulns.length - 2; i >= 0; i--) {
        if (explained(vulns[i], candidate, pair)) vulns.splice(i, 1);
      }
    } else if (pairCandidates.some(({ vuln, pair }) => vulns.includes(vuln) && explained(candidate, vuln, pair))) {
      vulns.pop();
    }
    // Continue until 12 survive; all later entries have no greater impact.
    if (vulns.length === 12) break;
  }
  function explained(key: Vuln, bigram: Vuln, pair: Pair): boolean {
    return key.kind === 'key' && pair.to === key.label
      && pair.clean >= 0.8 * targets.get(key.label)!.clean
      && bigram.impact >= 0.8 * key.impact;
  }
  return {
    sample, sessions: sessions.size, overallLatencyMs: median(latencies), accuracy: correct / sample,
    keys, bigrams, vulns,
    trend: Array.from(sessions, ([session, s]) => ({
      session, latencyMs: median(s.latencies), accuracy: s.correct / s.events.length,
    })),
  };
}
