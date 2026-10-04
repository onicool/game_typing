import type { Report, Severity } from '../stats/types';

export const PATCH_KEYS_HINT = '[1]–[8] パッチ';

const ROWS = ['1234567890-^', 'qwertyuiop@[', 'asdfghjkl;:]', 'zxcvbnm,./'];
const ROW_INDENT = [0, 26, 40, 62];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: 'sev-crit', HIGH: 'sev-high', MED: 'sev-med', LOW: 'sev-low', INVESTIGATING: 'sev-inv',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: 'CRITICAL', HIGH: 'HIGH', MED: 'MED', LOW: 'LOW', INVESTIGATING: '調査中',
};

/** ratio = key latency / overall latency: fast → teal, typical → neutral slate, slow → pink. */
function heatColor(ratio: number): string {
  const stops: [number, number[]][] = [[0.8, [22, 120, 120]], [1.0, [24, 44, 54]], [1.12, [120, 52, 96]], [1.35, [226, 62, 132]]];
  const r = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], ratio));
  let i = 0;
  while (i < stops.length - 2 && r > stops[i + 1][0]) i++;
  const [r0, c0] = stops[i];
  const [r1, c1] = stops[i + 1];
  const k = (r - r0) / (r1 - r0);
  return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
}

function keyboard(report: Report, metric: 'latency' | 'miss'): string {
  const byKey = new Map(report.keys.map((k) => [k.key.toLowerCase(), k]));
  const overallMiss = 1 - report.accuracy;
  return ROWS.map((row, r) => {
    const keys = [...row].map((ch) => {
      const st = byKey.get(ch);
      if (!st || st.n < 5) return `<div class="kb-key dim"><b>${esc(ch.toUpperCase())}</b></div>`;
      const ratio = metric === 'latency'
        ? st.latencyMs / (report.overallLatencyMs || 1)
        : 0.8 + (st.missRate - overallMiss) * 10;
      const tip = `${ch.toUpperCase()}  ${Math.round(st.latencyMs)}ms / ミス ${(st.missRate * 100).toFixed(1)}% / ${st.n}回`;
      return `<div class="kb-key" style="background:${heatColor(ratio)}" title="${esc(tip)}"><b>${esc(ch.toUpperCase())}</b><span>${Math.round(st.latencyMs)}</span></div>`;
    });
    return `<div class="kb-row" style="padding-left:${ROW_INDENT[r]}px">${keys.join('')}</div>`;
  }).join('');
}

function trendChart(report: Report): string {
  const pts = report.trend.filter((p) => Number.isFinite(p.kanaPerSec) && Number.isFinite(p.accuracy)).slice(-30);
  if (pts.length < 2) return '<div class="muted small">2ラン以上で推移を表示します</div>';
  const W = 560, H = 170, P = 44, top = 24, bottom = H - 24;
  const speed = pts.map(p => p.kanaPerSec!);
  const accuracy = pts.map(p => Math.max(0, Math.min(1, p.accuracy)));
  const speedLo = Math.max(0, Math.min(...speed) * 0.85), speedHi = Math.max(1, Math.max(...speed) * 1.15);
  const accuracyLo = Math.max(0, Math.min(0.9, Math.floor(Math.min(...accuracy) * 10) / 10));
  const ema = (values: number[]): number[] => {
    let value = values[0];
    return values.map(v => (value += (v - value) / 3)); // alpha=2/(5+1), five-session EMA
  };
  const line = (values: number[], lo: number, hi: number): string => values.map((v, i) =>
    `${(P + i / (values.length - 1) * (W - 2 * P)).toFixed(1)},${(bottom - (v - lo) / (hi - lo || 1) * (bottom - top)).toFixed(1)}`).join(' ');
  const series = (name: string, values: number[], lo: number, hi: number, color: string): string => `
    <polyline data-series="${name}" points="${line(values, lo, hi)}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5" />
    <polyline data-series="${name}-ema" points="${line(ema(values), lo, hi)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="5 3" />`;
  return `<div class="small"><span style="color:#65f5ed">速度 ${speed.at(-1)!.toFixed(2)} 字/秒</span>　<span style="color:#ef86c0">正確率 ${(accuracy.at(-1)! * 100).toFixed(1)}%</span>　<span class="muted">破線: EMA（5ラン）</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="速度（左軸・字/秒）と正確率（右軸・%）、5ランの指数移動平均">
      <title>速度と正確率の推移</title>
      <path d="M${P} ${top}V${bottom}H${W - P}V${top}" fill="none" stroke="#40545f" />
      <g font-size="11" fill="#65f5ed"><text x="2" y="${top + 4}">${speedHi.toFixed(1)}</text><text x="2" y="${bottom}">${speedLo.toFixed(1)}</text></g>
      <g font-size="11" fill="#ef86c0"><text x="${W - P + 5}" y="${top + 4}">100%</text><text x="${W - P + 5}" y="${bottom}">${Math.round(accuracyLo * 100)}%</text></g>
      ${series('speed', speed, speedLo, speedHi, '#65f5ed')}
      ${series('accuracy', accuracy, accuracyLo, 1, '#ef86c0')}
    </svg>`;
}

function profileNote(report: Report): string {
  if (report.sample < 200) return 'データ収集中。数ラン打つと、打鍵の傾向が見えてきます。';
  const top = report.vulns.find((v) => v.severity !== 'INVESTIGATING');
  const acc = (report.accuracy * 100).toFixed(1);
  const parts = [`正確率 ${acc}%、標準的な遷移は ${Math.round(report.overallLatencyMs)}ms。`];
  if (top) parts.push(`最も効く改善点は <code>${esc(top.label)}</code>（1000打あたり ${Math.round(top.impact)}ms の損失）。`);
  else parts.push('目立った脆弱性はまだ確定していません。');
  return parts.join('');
}

function reason(v: Report['vulns'][number]): string {
  const parts: string[] = [];
  if (v.excessMs >= 1) parts.push(`遅延 +${Math.round(v.excessMs)}ms`);
  if (v.missExcess >= 0.001) parts.push(`ミス +${(v.missExcess * 100).toFixed(1)}pt`);
  return parts.join('　') || '—';
}

export function renderReport(el: HTMLElement, report: Report, dictName: string, metric: 'latency' | 'miss') {
  const active = report.vulns.filter((v) => v.severity !== 'INVESTIGATING').length;
  const rows = report.vulns.length
    ? report.vulns.slice(0, 8).map((v, i) => `
      <tr>
        <td class="mono muted">${esc(v.id)}</td>
        <td><code>${esc(v.label)}</code> ${v.kind === 'bigram' ? '遷移' : 'キー'}　${reason(v)}</td>
        <td class="${SEVERITY_CLASS[v.severity]}">${SEVERITY_LABEL[v.severity]}</td>
        <td class="mono">+${Math.round(v.impact)}<small> ms / 1000打</small></td>
        <td class="mono muted">${v.n}</td>
        <td class="mono"><kbd>[${i + 1}]</kbd> パッチ</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="muted">まだ脆弱性は検出されていません。ベンチマークを数回走らせてください。</td></tr>';

  el.innerHTML = `
    <div class="rp-head">
      <div>
        <div class="eyebrow">SYSTEM DIAGNOSTICS / ${esc(dictName)}</div>
        <h1 class="jp">脆弱性レポート <small class="mono">// BUILD A BETTER YOU.</small></h1>
      </div>
      <div class="rp-counters">
        <div><div class="eyebrow">ACTIVE</div><div class="pink">${String(active).padStart(2, '0')}</div></div>
        <div><div class="eyebrow">SESSIONS</div><div class="green">${String(report.sessions).padStart(2, '0')}</div></div>
        <div><div class="eyebrow">SAMPLE</div><div>${report.sample.toLocaleString()}<small> 打鍵</small></div></div>
      </div>
    </div>
    <div class="rp-grid">
      <section class="rp-card rp-kb">
        <div class="rp-title"><span>01　キーボードヒートマップ</span><span class="muted small"><kbd>H</kbd> ${metric === 'latency' ? '遅さ' : 'ミス率'}</span></div>
        <div class="kb">${keyboard(report, metric)}</div>
        <div class="muted small rp-foot">標準的な遷移との比較　FAST <i class="sw" style="background:${heatColor(0.8)}"></i><i class="sw" style="background:${heatColor(1.0)}"></i><i class="sw" style="background:${heatColor(1.12)}"></i><i class="sw" style="background:${heatColor(1.35)}"></i> SLOW　（5回未満のキーは灰色）</div>
      </section>
      <section class="rp-card rp-trend">
        <div class="rp-title"><span>02　成長ログ</span><span class="muted small">BENCHMARK / 字/秒・正確率</span></div>
        ${trendChart(report)}
        <div class="rp-note jp">${profileNote(report)}</div>
      </section>
      <section class="rp-card rp-list">
        <div class="rp-title"><span>03　改善インパクト順</span><span class="muted small">深刻度は「1000打あたりの損失時間」で判定</span></div>
        <table class="vuln-table">
          <thead><tr><th>ID</th><th>検出された課題</th><th>深刻度</th><th>改善インパクト</th><th>n</th><th>パッチ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </div>
    <div class="rp-footer muted small"><span><kbd>ESC</kbd> 戻る　${PATCH_KEYS_HINT}</span><span>ログはこの端末だけに保存されます。</span></div>
  `;
}
