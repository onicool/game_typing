import { describe, expect, it } from 'vitest';
import { PRACTICE_KEYS_HINT, renderReport } from '../ui/report';
import type { Report } from './types';

const report = (): Report => ({
  sample: 500, sessions: 3, overallLatencyMs: 100, accuracy: 0.95, keys: [], bigrams: [],
  vulns: Array.from({ length: 10 }, (_, i) => ({
    id: `VULN-${i}`, kind: 'bigram', label: 'k→y', excessMs: 30, missExcess: 0.02,
    impact: 100, severity: 'HIGH', n: 40,
  })),
  trend: [
    { session: '1', kanaPerSec: 3, latencyMs: 150, accuracy: 0.9 },
    { session: '2', kanaPerSec: 4, latencyMs: 120, accuracy: 0.95 },
    { session: '3', kanaPerSec: 5, latencyMs: 100, accuracy: 0.98 },
  ],
});

describe('report rendering', () => {
  it('renders both trends with five-session EMAs and maps only the top eight patch digits', () => {
    const el = { innerHTML: '' } as HTMLElement;
    const data = report();
    const before = JSON.stringify(data);
    renderReport(el, data, '<test>', 'latency');
    for (const series of ['speed', 'accuracy', 'speed-ema', 'accuracy-ema']) {
      expect(el.innerHTML).toContain(`data-series="${series}"`);
    }
    expect(el.innerHTML).toContain('5.00 字/秒');
    expect(el.innerHTML).toContain('98.0%');
    expect(el.innerHTML).toContain('EMA（5ラン）');
    for (let i = 1; i <= 8; i++) expect(el.innerHTML).toContain(`<kbd>[${i}]</kbd> 弱点練習`);
    expect(el.innerHTML).not.toContain('<kbd>[9]</kbd>');
    expect(el.innerHTML).toContain(PRACTICE_KEYS_HINT);
    expect(el.innerHTML).toContain('&lt;test&gt;');
    expect(JSON.stringify(data)).toBe(before);
  });

  it('handles missing speed metadata, invalid numbers and empty vulnerabilities', () => {
    const el = { innerHTML: '' } as HTMLElement;
    const data = report();
    data.vulns = [];
    data.trend[0].kanaPerSec = undefined;
    data.trend[1].kanaPerSec = NaN;
    renderReport(el, data, 'test', 'miss');
    expect(el.innerHTML).toContain('2ラン以上');
    expect(el.innerHTML).toContain('colspan="6"');
    expect(el.innerHTML).not.toContain('NaN');
  });
});
