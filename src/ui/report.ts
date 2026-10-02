import type { Report, Severity } from '../stats/types';

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
  const pts = report.trend.filter((p) => p.kanaPerSec !== undefined).slice(-30);
  if (pts.length < 2) return '<div class="muted small">2ラン以上で推移を表示します</div>';
  const W = 560, H = 150, P = 10;
  const ys = pts.map((p) => p.kanaPerSec!);
  const lo = Math.min(...ys) * 0.95, hi = Math.max(...ys) * 1.05 || 1;
  const xy = ys.map((y, i) => [P + (i / (ys.length - 1)) * (W - 2 * P), H - P - ((y - lo) / (hi - lo || 1)) * (H - 2 * P)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${P},${H - P} ${line} ${W - P},${H - P}`;
  const [lx, ly] = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="trend">
    <polygon points="${area}" fill="rgba(101,245,237,0.08)" />
    <polyline points="${line}" fill="none" stroke="#65f5ed" stroke-width="2" />
    <circle cx="${lx}" cy="${ly}" r="4" fill="#e4eef1" />
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
    ? report.vulns.slice(0, 8).map((v) => `
      <tr>
        <td class="mono muted">${esc(v.id)}</td>
        <td><code>${esc(v.label)}</code> ${v.kind === 'bigram' ? '遷移' : 'キー'}　${reason(v)}</td>
        <td class="${SEVERITY_CLASS[v.severity]}">${SEVERITY_LABEL[v.severity]}</td>
        <td class="mono">+${Math.round(v.impact)}<small> ms / 1000打</small></td>
        <td class="mono muted">${v.n}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="muted">まだ脆弱性は検出されていません。ベンチマークを数回走らせてください。</td></tr>';

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
        <div class="rp-title"><span>02　成長ログ</span><span class="muted small">BENCHMARK / 字/秒</span></div>
        ${trendChart(report)}
        <div class="rp-note jp">${profileNote(report)}</div>
      </section>
      <section class="rp-card rp-list">
        <div class="rp-title"><span>03　改善インパクト順</span><span class="muted small">深刻度は「1000打あたりの損失時間」で判定</span></div>
        <table class="vuln-table">
          <thead><tr><th>ID</th><th>検出された課題</th><th>深刻度</th><th>改善インパクト</th><th>n</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </div>
    <div class="rp-footer muted small"><span><kbd>ESC</kbd> 戻る</span><span>ログはこの端末だけに保存されます。</span></div>
  `;
}
