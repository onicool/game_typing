export interface StoredKey {
  session: string;
  t: number;
  key: string;
  code: string;
  correct: boolean;
  expected: string[];
  prevKey: string | null;
  dt: number;
  wordStart: boolean;
  afterMiss: boolean;
  intended: string | null;
  wordId?: string;
  role?: 'ordinary' | 'weak' | 'probe';
  target?: string | null;
  afterPause?: boolean;
  /** Approximate marginal selection probability of the word. */
  prob?: number;
  mode: string;
  dict: string;
}

export interface KeyStat { key: string; latencyMs: number; missRate: number; n: number; misses: number }
export interface BigramStat { from: string; to: string; latencyMs: number; missRate: number; n: number }
export type Severity = 'CRITICAL' | 'HIGH' | 'MED' | 'LOW' | 'INVESTIGATING';
export interface Vuln {
  id: string;
  kind: 'bigram' | 'key';
  label: string;
  excessMs: number;
  missExcess: number;
  impact: number;
  severity: Severity;
  n: number;
}
export interface Report {
  sample: number;
  sessions: number;
  overallLatencyMs: number;
  accuracy: number;
  keys: KeyStat[];
  bigrams: BigramStat[];
  vulns: Vuln[];
  trend: { session: string; kanaPerSec?: number; latencyMs: number; accuracy: number }[];
}
