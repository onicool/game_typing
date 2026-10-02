import './style.css';
import { Scene } from './fx/scene';
import { Audio } from './fx/audio';
import { Round, ROUND_MS, LAYERS_PER_FIREWALL, type RoundResult } from './game/round';
import { DICTIONARIES } from './content/words';
import { TypingSession, normalizeReading } from './engine/romaji';
import { analyze } from './stats/analyze';
import { loadEvents, loadSessions, saveSession } from './stats/store';
import type { StoredKey } from './stats/types';
import { renderReport } from './ui/report';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`icebreaker.${key}`);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`icebreaker.${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable: run without persistence */
    }
  },
};

const stage = $('stage');
const scene = new Scene($<HTMLCanvasElement>('scene'));
const audio = new Audio();

type Mode = 'title' | 'play' | 'result' | 'report';
let mode: Mode = 'title';
let reportReturn: Mode = 'title';
let reportMetric: 'latency' | 'miss' = 'latency';
let reportRequest = 0; // bumped on every open/close so a slow load cannot render over a newer one
let dictIdx = store.get('dict', 0) % DICTIONARIES.length;
const prefs: Record<string, string> = store.get('prefs', {});
let round: Round | null = null;
audio.enabled = store.get('sound', true);

// ---- layout ---------------------------------------------------------------

function fit() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
  scene.resize(s);
}
window.addEventListener('resize', fit);
fit();

// trace track segments
const traceTrack = $('trace-track');
for (let i = 0; i < 24; i++) traceTrack.appendChild(document.createElement('i'));

// ---- HUD rendering --------------------------------------------------------

const els = {
  word: $('word'), reading: $('reading'), romaji: $('romaji'),
  nextWord: $('next-word'), nextGuide: $('next-guide'),
  inputLabel: $('input-label'), progressText: $('progress-text'), progressBar: $('progress-bar'),
  chain: $('chain'), chainCaption: $('chain-caption'), ocStages: $('oc-stages'), ocName: $('oc-name'),
  traceVal: $('trace-val'), traceNote: $('trace-note'),
  integrityVal: $('integrity-val'), integrityBar: $('integrity-bar'),
  layerIndex: $('layer-index'), iceStatus: $('ice-status'), iceId: $('ice-id'), iceKind: $('ice-kind'),
  enemyLog: $('enemy-log'), depth: $('depth'), depthSub: $('depth-sub'),
  sectorNo: $('sector-no'), sectorSub: $('sector-sub'),
  timer: $('timer'), kps: $('kps'), modeLabel: $('mode-label'), sound: $('sound-state'),
  edge: $('edge-flash'), ime: $('ime-warning'),
};

const SECTORS = ['CORPORATE MESH / OUTER RING', 'CORPORATE MESH / INNER RING', 'AI INTERIOR / CORE ACCESS'];
const OC_NAMES = ['0 / IDLE', 'I / SYNC', 'II / RESONANCE', 'III / FULL SPECTRUM'];
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
let logLines: string[] = [];
let errTimer = 0;

function pushLog(line: string) {
  logLines.push(line);
  if (logLines.length > 4) logLines.shift();
  els.enemyLog.innerHTML = logLines.map((l, i) => `<div class="${i === logLines.length - 1 ? 'active' : ''}">&gt; ${l}</div>`).join('');
}

function renderPanel(miss = false) {
  if (!round) return;
  const s = round.session;
  const w = round.word;
  const isJp = DICTIONARIES[dictIdx].id.startsWith('jp');
  els.word.textContent = w.display;
  if (isJp) {
    const r = normalizeReading(w.reading);
    els.reading.innerHTML = `<span class="done">${esc(r.slice(0, s.kanaDone))}</span>${esc(r.slice(s.kanaDone))}`;
  } else {
    els.reading.textContent = '';
  }
  const typed = s.typed;
  const rest = s.guide.slice(typed.length);
  const first = rest.slice(0, 1);
  const firstHtml = miss && first ? `<span class="err">${esc(first)}</span>` : esc(first);
  els.romaji.innerHTML = `<span class="typed">${esc(typed)}</span><span class="cursor"></span>${firstHtml}${esc(rest.slice(1))}`;
  const total = normalizeReading(w.reading).length;
  els.progressText.textContent = `${pad(s.kanaDone)} / ${pad(total)}`;
  els.progressBar.style.width = `${(s.kanaDone / total) * 100}%`;
  els.inputLabel.textContent = `INPUT // ${pad(round.wordsDone + 1, 3)}`;
  els.nextWord.textContent = round.nextWord.display;
  els.nextGuide.textContent = isJp ? new TypingSession(round.nextWord.reading, { prefs }).guide : '';
}

function renderHud() {
  if (!round) return;
  els.chain.textContent = String(round.chain);
  els.chain.classList.toggle('broken', round.chain === 0 && round.misses > 0);
  [...els.ocStages.children].forEach((el, i) => {
    el.classList.toggle('active', i < round!.stage);
    el.classList.toggle('last', i === 2);
  });
  els.ocName.textContent = OC_NAMES[round.stage];
  const integ = round.integrity();
  els.integrityVal.textContent = `${Math.round(integ * 100)}%`;
  els.integrityBar.style.width = `${integ * 100}%`;
  els.layerIndex.textContent = `◆ LAYER ${pad(round.layer + 1)} / ${pad(LAYERS_PER_FIREWALL)}`;
  els.iceKind.textContent = `標準防壁 / 第 ${pad(round.layer + 1)} 層`;
  els.iceId.textContent = `[ ICE // FW-${pad(round.firewalls + 1, 3)} ]`;
  const sector = Math.min(3, 1 + Math.floor(round.firewalls / 2));
  els.sectorNo.textContent = String(sector);
  els.sectorSub.textContent = SECTORS[sector - 1];
  els.depth.textContent = (round.totalKana() * 12 + round.firewalls * 400).toLocaleString();
  els.depthSub.textContent = `▾ ${['OUTER NETWORK', 'INNER NETWORK', 'AI CORE'][sector - 1]}`;
  scene.setDamage(1 - integ);
  scene.setStage(round.stage);
}

function renderTrace() {
  const v = round ? round.trace : 0;
  els.traceVal.innerHTML = `${Math.round(v)}<small>%</small>`;
  const on = Math.round((v / 100) * 24);
  [...traceTrack.children].forEach((el, i) => {
    el.classList.toggle('on', i < on);
    el.classList.toggle('hot', i < on && v >= 70);
  });
  els.traceNote.textContent = v >= 70 ? 'SIGNAL EXPOSURE / CRITICAL' : v >= 35 ? 'SIGNAL EXPOSURE / ELEVATED' : 'SIGNAL EXPOSURE / STABLE';
}

function renderClock(now: number) {
  if (!round) return;
  const rem = round.remainingMs(now);
  els.timer.textContent = round.started ? `RUN 00:${pad(Math.ceil(rem / 1000))}` : 'RUN 00:60 / 打ち始めるとスタート';
  const elapsed = round.started ? (ROUND_MS - rem) / 1000 : 0;
  els.kps.textContent = `${elapsed > 1 ? (round.totalKana() / elapsed).toFixed(1) : '0.0'} 字/秒`;
}

// ---- flow -----------------------------------------------------------------

function showOverlay(id: 'title-screen' | 'result-screen' | 'report-screen' | null) {
  for (const o of ['title-screen', 'result-screen', 'report-screen']) $(o).classList.toggle('hidden', id !== o);
}

async function openReport() {
  if (mode !== 'report') reportReturn = mode;
  mode = 'report';
  const request = ++reportRequest;
  const d = DICTIONARIES[dictIdx];
  const el = $('report');
  el.innerHTML = '<div class="eyebrow">ANALYZING…</div>';
  showOverlay('report-screen');
  const [events, sessions] = await Promise.all([loadEvents(d.id), loadSessions(d.id)]);
  if (request !== reportRequest || mode !== 'report') return;
  const report = analyze(events, { dict: d.id });
  report.trend = sessions
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((x) => ({ session: x.session, kanaPerSec: x.kanaPerSec, latencyMs: 0, accuracy: x.accuracy }));
  renderReport(el, report, d.name, reportMetric);
}

function closeReport() {
  reportRequest++;
  mode = reportReturn;
  showOverlay(mode === 'result' ? 'result-screen' : 'title-screen');
}

function renderTitle() {
  const d = DICTIONARIES[dictIdx];
  $('dict-name').textContent = d.name;
  els.modeLabel.textContent = `${d.label}　|　IME OFF`;
  const best = store.get<number>(`pb.${d.id}`, 0);
  $('title-best').textContent = best ? `自己ベスト ${best.toFixed(2)} 字/秒` : '';
  els.sound.textContent = audio.enabled ? '[ 音声 ON ]' : '[ 音声 OFF ]';
}

function startRound() {
  round = new Round(DICTIONARIES[dictIdx], prefs);
  mode = 'play';
  logLines = [];
  els.enemyLog.innerHTML = '';
  pushLog('LINK ESTABLISHED');
  pushLog('AWAITING BREACH_');
  els.iceStatus.textContent = 'AWAITING INPUT';
  scene.reset();
  audio.reset();
  showOverlay(null);
  renderPanel();
  renderHud();
  renderTrace();
}

function endRound() {
  if (!round) return;
  mode = 'result';
  const d = DICTIONARIES[dictIdx];
  const r: RoundResult = round.result();
  const pbKey = `pb.${d.id}`;
  const best = store.get<number>(pbKey, 0);
  if (r.kanaPerSec > best) store.set(pbKey, r.kanaPerSec);
  store.set('prefs', prefs);
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const events: StoredKey[] = round.log.map((e) => ({ ...e, session, mode: 'benchmark', dict: d.id }));
  void saveSession(events, { session, dict: d.id, mode: 'benchmark', kanaPerSec: r.kanaPerSec, accuracy: r.accuracy, endedAt: Date.now() })
    .catch((err) => console.warn('failed to save session', err));

  $('r-speed').innerHTML = `${r.kanaPerSec.toFixed(2)}<small style="font-size:22px"> 字/秒</small>`;
  $('r-kpm').textContent = `${Math.round(r.keysPerMin)} 打鍵/分（参考）`;
  $('r-acc').innerHTML = `${(r.accuracy * 100).toFixed(1)}<small style="font-size:22px">%</small>`;
  $('r-miss').textContent = `ミス ${r.misses}`;
  $('r-chain').textContent = String(r.maxChain);
  $('r-layers').textContent = `破った層 ${r.layers} / 防壁 ${r.firewalls}`;

  const near = $('r-near');
  if (!best) near.innerHTML = `初回記録 <b>${r.kanaPerSec.toFixed(2)} 字/秒</b>。ここから自分を超えていく。`;
  else if (r.kanaPerSec > best) near.innerHTML = `<b>自己ベスト更新</b>　+${(r.kanaPerSec - best).toFixed(2)} 字/秒（前回ベスト ${best.toFixed(2)}）`;
  else near.innerHTML = `自己ベストまで あと <b>${(best - r.kanaPerSec).toFixed(2)}</b> 字/秒（ベスト ${best.toFixed(2)}）`;

  const vuln = $('r-vuln');
  if (r.slowBigram) {
    vuln.innerHTML = `VULN 検出：<code>${esc(r.slowBigram.pair)}</code> の遷移が平均より <code>+${Math.round(r.slowBigram.excessMs)}ms</code>（${r.slowBigram.count}回）`;
  } else if (r.missedKey) {
    vuln.innerHTML = `VULN 検出：<code>${esc(r.missedKey.key)}</code> の手前でミス ${r.missedKey.count} 回`;
  } else {
    vuln.textContent = 'VULN 検出なし：データが少ないか、目立った弱点なし';
  }
  if (r.slowBigram && r.missedKey) vuln.innerHTML += `　／　<code>${esc(r.missedKey.key)}</code> の手前でミス ${r.missedKey.count} 回`;
  showOverlay('result-screen');
}

function toTitle() {
  mode = 'title';
  round = null;
  renderTitle();
  showOverlay('title-screen');
}

// ---- input ----------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    els.ime.classList.remove('hidden');
    e.preventDefault();
    return;
  }
  els.ime.classList.add('hidden');
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Tab' || e.key === ' ') e.preventDefault();
  audio.ensure();

  if (mode === 'report') {
    if (e.repeat) return;
    if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') closeReport();
    else if (e.key === 'h' || e.key === 'H') {
      reportMetric = reportMetric === 'latency' ? 'miss' : 'latency';
      void openReport();
    }
    return;
  }
  if (mode === 'title') {
    if (e.repeat) return;
    if (e.key === 'r' || e.key === 'R') return void openReport();
    if (e.key === ' ' || e.key === 'Enter') startRound();
    else if (e.key === 'Tab') {
      dictIdx = (dictIdx + 1) % DICTIONARIES.length;
      store.set('dict', dictIdx);
      renderTitle();
    } else if (e.key === 'm' || e.key === 'M') {
      audio.enabled = !audio.enabled;
      store.set('sound', audio.enabled);
      renderTitle();
    }
    return;
  }
  if (mode === 'result') {
    if (e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') startRound();
    else if (e.key === 'Escape') toTitle();
    else if (e.key === 'r' || e.key === 'R') void openReport();
    return;
  }

  // play
  if (!round) return;
  if (e.key === 'Escape') return toTitle();
  if (e.repeat || e.key.length !== 1) return;
  if (round.finished) return;
  if (e.key === ' ' && !round.session.expected.includes(' ')) return;

  const out = round.input(e.key, e.timeStamp, e.code);
  if (out.late) return endRound();
  if (out.accepted) {
    audio.key(round.stage, out.critical);
    scene.hit(out.critical, out.criticalGainMs);
    els.chain.animate([{ transform: 'scale(1.12)', color: '#ffffff' }, { transform: 'scale(1)' }], { duration: 140, easing: 'ease-out' });
    if (out.wordDone) {
      audio.word(round.stage);
      scene.layerBreak();
      pushLog(out.firewallDone ? 'FIREWALL BREACHED' : 'FRACTURE DETECTED');
      els.iceStatus.textContent = 'BREACH IN PROGRESS';
      if (out.firewallDone) {
        audio.breach();
        scene.breach();
        pushLog('ROUTE REBUILDING');
      }
    }
    renderPanel();
  } else {
    audio.miss();
    scene.miss();
    els.edge.classList.remove('on');
    void els.edge.offsetWidth;
    els.edge.classList.add('on');
    renderPanel(true);
    clearTimeout(errTimer);
    errTimer = window.setTimeout(() => mode === 'play' && renderPanel(), 160);
  }
  renderHud();
  renderTrace();
});

// ---- loop -----------------------------------------------------------------

let lastFrame = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (mode === 'play' && round) {
    round.tick(now, dt);
    renderClock(now);
    if (Math.random() < 0.2) renderTrace();
    if (round.finished) endRound();
  }
  scene.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

renderTitle();
showOverlay('title-screen');
