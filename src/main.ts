import './style.css';
import { Scene, isInterceptWord } from './fx/scene';
import { Audio } from './fx/audio';
import { Round, ROUND_MS, LAYERS_PER_FIREWALL, type RoundResult } from './game/round';
import { DICTIONARIES } from './content/words';
import { TypingSession, normalizeReading } from './engine/romaji';
import { analyze } from './stats/analyze';
import { loadEvents, loadSessions, saveSession } from './stats/store';
import type { Report, StoredKey, Vuln } from './stats/types';
import { renderReport } from './ui/report';
import { DialogFocus } from './ui/dialog';
import { loadBaselines, updateBaselines } from './stats/baselines';
import { PatchSource } from './stats/select';
import { createSettingsStore, isBoolean, isDictionaryIndex, isEffectLevel, isNonNegativeNumber, isSpellingPreferences, isVolume } from './storage/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const store = createSettingsStore(issue => {
  const text = issue === 'invalid'
    ? '保存設定の一部を読み込めません。一時設定で動作しています。元の保存内容は保持しています。'
    : issue === 'unavailable'
      ? '設定の読み込み・保存ができないため、このページ内でのみ設定を保持します。'
      : '';
  // Hidden/inert regions do not reach the accessibility tree. Keep the modal's
  // own status in sync, and avoid announcing unchanged messages repeatedly.
  for (const id of ['settings-storage-state', 'settings-save-state']) {
    const notice = $(id);
    if (notice.textContent !== text) notice.textContent = text;
    notice.classList.toggle('hidden', issue === null);
  }
});

const stage = $('stage');
const dialogFocus = new DialogFocus(stage);
const scene = new Scene($<HTMLCanvasElement>('scene'));
const stageAssets = `${import.meta.env.BASE_URL}stages/`;
scene.setBackground(`${stageAssets}skyway.webp`, `${stageAssets}skyway.png`);
scene.setTarget(`${stageAssets}aether-sentinel.webp`, `${stageAssets}aether-sentinel.png`);
const audio = new Audio();

type Mode = 'title' | 'play' | 'result' | 'report';
let mode: Mode = 'title';
let reportReturn: Mode = 'title';
let reportMetric: 'latency' | 'miss' = 'latency';
let reportRequest = 0; // bumped on every open/close so a slow load cannot render over a newer one
let report: { data: Report; dictId: string; request: number } | null = null;
let settingsOpen = false;
let dictIdx = store.get('dict', 0, isDictionaryIndex(DICTIONARIES.length));
const prefs: Record<string, string> = store.get('prefs', {}, isSpellingPreferences);
let round: Round | null = null;
audio.enabled = store.get('sound', true, isBoolean);
audio.setVolume(store.get('volume', 1, isVolume));

type Effect = 'shake' | 'flash' | 'motion';
type EffectLevel = 0 | 0.5 | 1;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const effectDefaults: Record<Effect, EffectLevel> = { shake: reducedMotion ? 0 : 1, flash: 1, motion: reducedMotion ? 0 : 1 };
const effects = {} as Record<Effect, EffectLevel>;
let lowGraphics = store.get('graphics.low', false, isBoolean);
for (const key of ['shake', 'flash', 'motion'] as const) {
  effects[key] = store.get(`effects.${key}`, effectDefaults[key], isEffectLevel);
}

// ---- layout ---------------------------------------------------------------

let inputBoost = 1;
function fit() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
  stage.style.setProperty('--text-boost', String(Math.max(1, Math.min(1.7, 0.75 / s))));
  // Keep the task text legible rather than shrinking it with the whole scene.
  inputBoost = Math.max(1, 0.875 / s);
  stage.style.setProperty('--input-boost', String(inputBoost));
  stage.style.setProperty('--input-width', `${Math.min(1800, Math.max(960, 720 / s))}px`);
  stage.classList.toggle('compact-input', inputBoost > 1.01);
  stage.classList.toggle('tight-input', s < 0.5);
  if (round?.word.segments) renderPanel();
  scene.resize(s);
  scene.setArenaBottom(1080 - 139 - (round?.word.segments ? 414 : 360) * inputBoost);
}
window.addEventListener('resize', fit);
fit();

// Accuracy track segments
const accuracyTrack = $('accuracy-track');
for (let i = 0; i < 24; i++) accuracyTrack.appendChild(document.createElement('i'));

// ---- HUD rendering --------------------------------------------------------

const els = {
  word: $('word'), reading: $('reading'), romaji: $('romaji'),
  nextWord: $('next-word'), nextGuide: $('next-guide'),
  inputLabel: $('input-label'), progressText: $('progress-text'), progressBar: $('progress-bar'),
  chain: $('chain'), chainCaption: $('chain-caption'), ocStages: $('oc-stages'), ocName: $('oc-name'),
  accuracyVal: $('accuracy-val'), accuracyNote: $('accuracy-note'),
  integrityVal: $('integrity-val'), integrityBar: $('integrity-bar'),
  layerIndex: $('layer-index'), iceStatus: $('ice-status'), iceId: $('ice-id'), iceKind: $('ice-kind'),
  enemyLog: $('enemy-log'), depth: $('depth'), depthSub: $('depth-sub'),
  sectorNo: $('sector-no'), sectorSub: $('sector-sub'),
  timer: $('timer'), kps: $('kps'), modeLabel: $('mode-label'), sound: $('sound-state'),
  edge: $('edge-flash'), ime: $('ime-warning'), readyHelp: $('ready-help'),
  timeBar: $('time-bar'), layerPips: $('layer-pips'), chainPop: $('chain-pop'),
  soundToggle: $<HTMLButtonElement>('sound-toggle'), soundIcon: $('sound-icon'),
  volume: $<HTMLInputElement>('sound-volume'),
};

const OC_NAMES = ['0 / IDLE', 'I / SYNC', 'II / RESONANCE', 'III / FULL SPECTRUM'];
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
let logLines: string[] = [];
let errTimer = 0;
let popTimer = 0;
let nextWordCached: Round['nextWord'] | null = null;
let followingWordCached: Round['followingWord'] | null = null;
let panelWordCached: Round['word'] | null = null;

function followPosition(container: HTMLElement, marker: HTMLElement | null) {
  if (!marker) return;
  const top = marker.offsetTop;
  const bottom = top + marker.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}

function renderSound() {
  const unavailable = audio.enabled && audio.unavailable;
  els.sound.textContent = unavailable ? '[ 音声 利用不可 ]' : audio.enabled ? '[ 音声 ON ]' : '[ 音声 OFF ]';
  els.soundIcon.textContent = audio.enabled && !unavailable && audio.volume > 0 ? '🔊' : '🔇';
  els.soundToggle.setAttribute('aria-pressed', String(!audio.enabled));
  els.soundToggle.setAttribute('aria-label', unavailable ? '音声をミュート（現在利用不可。オフからオンにすると再試行）' : audio.enabled ? '音声をミュート' : '音声をオン');
  els.volume.value = String(audio.volume);
}
audio.onAvailabilityChange = renderSound;

function toggleSound() {
  audio.enabled = !audio.enabled;
  audio.ensure();
  store.set('sound', audio.enabled);
  renderSound();
}

els.soundToggle.addEventListener('mousedown', (e) => e.preventDefault());
els.soundToggle.addEventListener('click', (e) => {
  toggleSound();
  if (e.detail > 0) els.soundToggle.blur();
});
els.volume.addEventListener('input', () => {
  audio.setVolume(Number(els.volume.value));
  audio.ensure();
  store.set('volume', audio.volume);
  renderSound();
});
els.volume.addEventListener('pointerup', () => els.volume.blur());

function applyEffects() {
  scene.setEffects(effects);
  scene.setLowGraphics(lowGraphics);
  $('setting-graphics').textContent = lowGraphics ? '低負荷' : '標準';
  stage.style.setProperty('--edge-opacity', String(0.55 * effects.flash));
  stage.classList.toggle('flash-off', effects.flash === 0);
  stage.classList.toggle('motion-off', effects.motion === 0);
  for (const key of ['shake', 'flash', 'motion'] as const) {
    $(`setting-${key}`).textContent = effects[key] === 0 ? 'オフ' : effects[key] === 0.5 ? '弱' : '標準';
  }
  if (effects.flash === 0) els.edge.classList.remove('on');
}

function cycleEffect(key: Effect) {
  effects[key] = effects[key] === 0 ? 0.5 : effects[key] === 0.5 ? 1 : 0;
  store.set(`effects.${key}`, effects[key]);
  applyEffects();
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-effect]')) {
  button.addEventListener('click', () => {
    button.focus({ preventScroll: true });
    cycleEffect(button.dataset.effect as Effect);
  });
}
$('graphics-toggle').addEventListener('click', () => {
  lowGraphics = !lowGraphics;
  store.set('graphics.low', lowGraphics);
  applyEffects();
});

function announce(messages: string[]) {
  if (!messages.length) return;
  clearTimeout(popTimer);
  els.chainPop.textContent = messages.join(' · ');
  els.chainPop.classList.add('visible');
  popTimer = window.setTimeout(() => els.chainPop.classList.remove('visible'), 1600);
}

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
  const long = !!w.segments;
  stage.classList.toggle('long-input', long);
  $('passage-help').classList.toggle('hidden', !long);
  if (panelWordCached !== w) {
    panelWordCached = w;
    if (w.segments) els.word.innerHTML = w.segments.map(segment => `<span>${esc(segment.display)}</span>`).join('');
    else els.word.textContent = w.display;
    for (const node of [els.word, els.reading, els.romaji]) node.scrollTop = 0;
  }
  if (w.segments) {
    let end = 0;
    let active = w.segments.length - 1;
    w.segments.some((segment, index) => {
      end += normalizeReading(segment.reading).length;
      if (s.kanaDone < end) { active = index; return true; }
      return false;
    });
    [...els.word.children].forEach((node, index) => {
      node.classList.toggle('current-sentence', index === active);
      node.classList.toggle('done', index < active);
    });
    followPosition(els.word, els.word.children[active] as HTMLElement);
  }
  if (isJp) {
    const r = normalizeReading(w.reading);
    const restReading = r.slice(s.kanaDone);
    els.reading.innerHTML = `<span class="done">${esc(r.slice(0, s.kanaDone))}</span>${long ? `<span class="reading-unit"><span class="reading-cursor" aria-hidden="true"></span>${esc(restReading.slice(0, 1))}</span>${esc(restReading.slice(1))}` : esc(restReading)}`;
  } else {
    els.reading.textContent = '';
  }
  const typed = s.typed;
  const rest = s.guide.slice(typed.length);
  const first = rest.slice(0, 1);
  const firstHtml = miss && first ? `<span class="err">${esc(first)}</span>` : esc(first);
  els.romaji.innerHTML = `<span class="typed">${esc(typed)}</span><span class="current-unit"><span class="cursor"></span>${firstHtml}</span>${esc(rest.slice(1))}`;
  if (long) {
    followPosition(els.reading, els.reading.querySelector<HTMLElement>('.reading-unit'));
    followPosition(els.romaji, els.romaji.querySelector<HTMLElement>('.current-unit'));
  }
  const total = normalizeReading(w.reading).length;
  els.progressText.textContent = `${pad(s.kanaDone)} / ${pad(total)}`;
  els.progressBar.style.width = `${(s.kanaDone / total) * 100}%`;
  const pick = round.currentPick;
  // only weak-slot words are labelled; probes stay unmarked so they remain a fair check
  const encounter = !long && isInterceptWord(round.wordsDone) ? '　◇ 迎撃（通常入力）' : '';
  stage.classList.toggle('intercept-input', !!encounter);
  els.inputLabel.textContent = `${long ? 'LONG PRACTICE' : 'INPUT'} // ${pad(round.wordsDone + 1, 3)}${pick.role === 'weak' && pick.target ? `　◆ TARGET ${pick.target}` : ''}${encounter}`;
  if (nextWordCached !== round.nextWord || followingWordCached !== round.followingWord) {
    nextWordCached = round.nextWord;
    followingWordCached = round.followingWord;
    els.nextWord.textContent = round.nextWord.display;
    els.nextGuide.textContent = isJp ? new TypingSession(round.nextWord.reading, { prefs }).guide : '';
    $('following-word').textContent = round.followingWord.display;
    $('following-guide').textContent = isJp ? new TypingSession(round.followingWord.reading, { prefs }).guide : '';
  }
  els.readyHelp.classList.toggle('hidden', round.started || long);
  scene.setProgress(s.kanaDone / total);
  // The panel's stage-space bottom/height are fixed by CSS. Derive its reserved
  // area without forcing a layout read after every accepted key's DOM writes.
  scene.setArenaBottom(1080 - 139 - (long ? 414 : 360) * inputBoost);
}

function renderHud() {
  if (!round) return;
  els.chain.textContent = String(round.chain);
  els.chain.classList.toggle('broken', round.chain === 0 && round.misses > 0);
  const tier = [10, 30, 50, 100, 200].filter((n) => round!.chain >= n).length;
  els.chainCaption.textContent = `CHAIN TIER ${tier}`;
  [...els.ocStages.children].forEach((el, i) => {
    el.classList.toggle('active', i < round!.stage);
    el.classList.toggle('last', i === 2);
  });
  els.ocName.textContent = OC_NAMES[round.stage];
  const integ = round.integrity();
  els.integrityVal.textContent = `${Math.round(integ * 100)}%`;
  els.integrityBar.style.width = `${integ * 100}%`;
  els.layerIndex.textContent = `◆ LAYER ${pad(round.layer + 1)} / ${pad(LAYERS_PER_FIREWALL)}`;
  els.iceKind.textContent = `迎撃機バリア / 第 ${pad(round.layer + 1)} 層`;
  els.iceId.textContent = `[ ICE // FW-${pad(round.firewalls + 1, 3)} ]`;
  els.sectorNo.textContent = '01';
  els.sectorSub.textContent = 'SKYWAY / 空中回廊';
  els.depth.textContent = (round.totalKana() * 12 + round.firewalls * 400).toLocaleString();
  els.depthSub.textContent = `▾ ROUTE ${pad(round.firewalls + 1, 3)}`;
  [...els.layerPips.children].forEach((el, i) => el.classList.toggle('broken', i < round!.layer));
  els.layerPips.setAttribute('aria-label', `この防壁の突破済み層 ${round.layer} / ${LAYERS_PER_FIREWALL}`);
  scene.setDamage(1 - integ);
  scene.setStage(round.stage);
}

function renderAccuracy() {
  const v = round ? round.accuracy() : 1;
  els.accuracyVal.innerHTML = `${(v * 100).toFixed(1)}<small>%</small>`;
  const on = Math.round(v * 24);
  [...accuracyTrack.children].forEach((el, i) => {
    el.classList.toggle('on', i < on);
  });
  els.accuracyNote.textContent = `ミス ${round?.misses ?? 0}`;
}

function renderClock(now: number) {
  if (!round) return;
  const rem = round.remainingMs(now);
  const elapsed = round.elapsedMs(now) / 1000;
  const passage = round.mode === 'passage';
  els.timer.textContent = passage
    ? round.started ? `PRACTICE ${pad(Math.floor(elapsed / 60))}:${pad(Math.floor(elapsed % 60))}` : 'PRACTICE / 最初のキーでスタート'
    : round.started ? `RUN 00:${pad(Math.ceil(rem / 1000))}` : 'RUN 00:60 / 最初のキーでスタート';
  els.timeBar.style.width = `${passage ? round.session.kanaDone / normalizeReading(round.word.reading).length * 100 : Math.max(0, Math.min(1, rem / ROUND_MS)) * 100}%`;
  els.kps.textContent = `${elapsed > 1 ? (round.totalKana() / elapsed).toFixed(1) : '0.0'} 字/秒`;
}

// ---- flow -----------------------------------------------------------------

function showOverlay(id: 'title-screen' | 'result-screen' | 'report-screen' | 'pause-screen' | 'settings-screen' | null) {
  const origin = document.activeElement;
  for (const o of ['title-screen', 'result-screen', 'report-screen', 'pause-screen', 'settings-screen']) $(o).classList.toggle('hidden', id !== o);
  stage.classList.toggle('overlay-open', id !== null);
  dialogFocus.show(id === 'pause-screen' || id === 'settings-screen' ? $(id) : null, origin);
  stage.classList.toggle('modal-open', dialogFocus.active);
}

function pauseRound(t: number) {
  if (mode !== 'play' || !round || round.paused || round.finished) return;
  round.pause(t);
  if (round.finished) return endRound();
  $('pause-note').textContent = round.interrupted
    ? '時計と入力を停止しています。再開後は練習扱い（中断あり）になります。'
    : '最初のキーを打つ前の待機中です。Space / Enter で再開できます。';
  $('pause-finish').classList.toggle('hidden', round.mode !== 'passage' || !round.started);
  if (round.mode === 'passage') $('pause-note').textContent = '時計と入力を停止しています。途中でも「終了して記録を保存」で練習結果を残せます。タイトルへ戻ると未完了の入力は保存されません。';
  clearTimeout(errTimer);
  els.ime.classList.add('hidden');
  renderPanel();
  renderClock(t);
  showOverlay('pause-screen');
}

function resumeRound(t: number) {
  if (!round || !round.paused) return;
  audio.ensure();
  round.resume(t);
  showOverlay(null);
  renderClock(t);
}

function closeSettings() {
  settingsOpen = false;
  showOverlay('title-screen');
}

function openSettings() {
  if (mode !== 'title' || settingsOpen) return;
  settingsOpen = true;
  showOverlay('settings-screen');
}

$('open-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', closeSettings);
$('pause-trigger').addEventListener('click', () => pauseRound(performance.now()));
$('pause-resume').addEventListener('click', () => resumeRound(performance.now()));
$('pause-finish').addEventListener('click', () => {
  if (round?.mode !== 'passage' || !round.started) return;
  round.finish(performance.now());
  endRound();
});
$('pause-retry').addEventListener('click', () => startRound(lastRun));
$('pause-title-return').addEventListener('click', toTitle);

async function openReport() {
  if (mode !== 'report') reportReturn = mode;
  mode = 'report';
  const request = ++reportRequest;
  report = null;
  const d = DICTIONARIES[dictIdx];
  const el = $('report');
  el.innerHTML = '<div class="eyebrow">ANALYZING…</div>';
  showOverlay('report-screen');
  const [events, sessions] = await Promise.all([loadEvents(d.id), loadSessions(d.id)]);
  if (request !== reportRequest || mode !== 'report' || d.id !== DICTIONARIES[dictIdx].id) return;
  const data = analyze(events.filter((event) => event.mode !== 'patch'), { dict: d.id });
  const bySession = new Map(sessions.map((x) => [x.session, x]));
  const benchmarks = new Set(events.filter((event) => event.mode === 'benchmark').map((event) => event.session));
  data.trend = data.trend.filter((point) => {
    const meta = bySession.get(point.session);
    return meta ? meta.mode === 'benchmark' : benchmarks.has(point.session);
  }).map((point) => {
    const meta = bySession.get(point.session);
    return meta ? { ...point, kanaPerSec: meta.kanaPerSec, accuracy: meta.accuracy } : point;
  });
  const seen = new Set(data.trend.map((x) => x.session));
  data.trend.push(...sessions
    .filter((x) => x.mode === 'benchmark' && !seen.has(x.session))
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((x) => ({ session: x.session, kanaPerSec: x.kanaPerSec, latencyMs: NaN, accuracy: x.accuracy })));
  renderReport(el, data, d.name, reportMetric);
  report = { data, dictId: d.id, request };
}

function closeReport() {
  reportRequest++;
  report = null;
  mode = reportReturn;
  showOverlay(mode === 'result' ? 'result-screen' : 'title-screen');
}

/** What a retry from the result/pause screen repeats: a benchmark, or a patch on the same focus. */
let lastRun: { mode: 'benchmark' | 'passage' } | { mode: 'patch'; focus: string; dictId: string; vulns: Vuln[] } = { mode: 'benchmark' };

function startPatch(index: number) {
  if (mode !== 'report' || !report || report.dictId !== DICTIONARIES[dictIdx].id || report.request !== reportRequest) return;
  const vuln = report.data.vulns[index];
  if (!vuln) return;
  const run: typeof lastRun = { mode: 'patch', focus: vuln.label, dictId: report.dictId, vulns: report.data.vulns.map((v) => ({ ...v })) };
  reportRequest++;
  report = null;
  startRound(run);
}

function renderTitle() {
  const d = DICTIONARIES[dictIdx];
  $('dict-name').textContent = d.name;
  const passage = d.kind === 'passage';
  $('title-intro').textContent = passage ? '一つの文章を最後まで打つ、時間制限のない長文練習。' : '60 秒間、防壁を打ち破れ。単語を打ち切るたびに防壁の層が砕ける。';
  $('title-help').innerHTML = passage
    ? '読みとローマ字が入力位置に追従します。句読点は , と . で入力。ミスは打ち直し（Backspace不要）。<br /><span class="muted">Esc で中断・再開、途中終了して保存も可。60秒ベンチマークの自己ベストとは別の練習記録です。</span>'
    : '表示されたローマ字を打つ。単語は自動で進む。ミスは打ち直し（Backspace不要）。語末の『ん』は nn。<br /><span class="muted">shi / si どちらでも可　・　最初のキーでスタート</span>';
  els.modeLabel.textContent = `${d.label}　|　IME OFF`;
  const best = store.get(`pb.${d.id}`, 0, isNonNegativeNumber);
  $('title-best').textContent = !passage && best ? `自己ベスト ${best.toFixed(2)} 字/秒` : '';
  renderSound();
}

function startRound(run: typeof lastRun = { mode: 'benchmark' }) {
  const dict = DICTIONARIES[dictIdx];
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const baselines = loadBaselines(dict);
  if (run.mode === 'patch' && run.dictId === dict.id && run.vulns.length) {
    try {
      const source = new PatchSource(dict.words, run.dictId, run.vulns, prefs, { seed, focus: run.focus });
      round = new Round(dict, prefs, { mode: 'patch', source, baselines, seed });
    } catch (err) {
      console.warn('patch pool unavailable, falling back to benchmark', err);
      run = { mode: 'benchmark' };
      round = new Round(dict, prefs, { baselines, seed });
    }
  } else {
    run = { mode: dict.kind === 'passage' ? 'passage' : 'benchmark' };
    round = new Round(dict, prefs, { mode: run.mode, baselines, seed });
  }
  lastRun = run;
  const d0 = DICTIONARIES[dictIdx];
  els.modeLabel.textContent = run.mode === 'patch' ? `PATCH // ${run.focus}　|　${d0.label}` : `${d0.label}　|　IME OFF`;
  mode = 'play';
  settingsOpen = false;
  nextWordCached = null;
  followingWordCached = null;
  panelWordCached = null;
  els.readyHelp.innerHTML = run.mode === 'passage'
    ? '時間制限なしの長文練習。句読点は , と . で入力。<br /><span class="muted">最初のキーで時計が動く。Esc で中断・再開、途中終了して記録保存も可。</span>'
    : '表示されたローマ字を打つ。単語は自動で進む。ミスは打ち直し（Backspace不要）。語末の『ん』は nn。<br /><span class="muted">shi / si どちらでも可　・　最初のキーでスタート</span>';
  clearTimeout(errTimer);
  clearTimeout(popTimer);
  els.chainPop.classList.remove('visible');
  els.edge.classList.remove('on');
  els.ime.classList.add('hidden');
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
  renderAccuracy();
  renderClock(performance.now());
}

$('start-passage').addEventListener('click', () => {
  dictIdx = DICTIONARIES.findIndex(dict => dict.kind === 'passage');
  store.set('dict', dictIdx);
  reportRequest++;
  report = null;
  renderTitle();
  startRound({ mode: 'passage' });
});

function endRound() {
  if (!round) return;
  const completedRound = round;
  mode = 'result';
  clearTimeout(errTimer);
  clearTimeout(popTimer);
  els.chainPop.classList.remove('visible');
  els.readyHelp.classList.add('hidden');
  const d = DICTIONARIES[dictIdx];
  const r: RoundResult = round.result();
  const isPatch = round.mode === 'patch';
  const isPassage = round.mode === 'passage';
  const interrupted = round.interrupted;
  const sessionMode = isPatch ? 'patch' : interrupted || isPassage ? 'practice' : 'benchmark';
  const eligibleForBest = !interrupted && !isPatch && !isPassage;
  const pbKey = `pb.${d.id}`;
  const best = store.get(pbKey, 0, isNonNegativeNumber);
  if (eligibleForBest && r.kanaPerSec > best) store.set(pbKey, r.kanaPerSec);
  store.set('prefs', prefs);
  updateBaselines(d, round.log);
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const events: StoredKey[] = round.log.map((e) => ({ ...e, session, mode: sessionMode, dict: d.id }));
  const meta = { session, dict: d.id, mode: sessionMode, kanaPerSec: r.kanaPerSec, accuracy: r.accuracy, endedAt: Date.now() };
  const saveState = $('session-save-state');
  saveState.textContent = '今回の練習記録を保存中…';
  $('recent-sessions').textContent = '直近5セッションを読み込み中…';
  void saveSession(events, meta)
    .catch((err) => {
      console.warn('failed to save session', err);
      return 'unknown' as const;
    })
    .then(async (savedTo) => {
      if (round !== completedRound) return;
      saveState.textContent = savedTo === 'persistent'
        ? '今回の練習記録をこのブラウザに保存しました。'
        : savedTo === 'memory'
          ? '今回の練習記録は一時保持のみです。再読み込みやページを閉じると失われます。'
          : '今回の練習記録の保存状態を確認できませんでした。';
      const sessions = await loadSessions(d.id);
      if (round !== completedRound) return;
      // Include the current result even if persistent storage is unavailable.
      const recent = [meta, ...sessions.filter((x) => x.session !== session)]
        .sort((a, b) => b.endedAt - a.endedAt).slice(0, 5);
      $('recent-sessions').innerHTML = '<div class="eyebrow">RECENT // 直近5セッション</div>' + recent.map((x) =>
        `<div class="session-row${x.session === session ? ' current' : ''}"><span>${x.session === session ? '今回' : esc(new Date(x.endedAt).toLocaleString('ja-JP'))}</span><b>${x.kanaPerSec.toFixed(2)} 字/秒</b><span>正確率 ${(x.accuracy * 100).toFixed(1)}%</span><span>${x.mode === 'practice' ? '練習' : x.mode === 'patch' ? 'パッチ' : '計測'}</span></div>`
      ).join('');
    }).catch((err) => {
      console.warn('failed to load recent sessions', err);
      if (round === completedRound) $('recent-sessions').textContent = `今回 ${r.kanaPerSec.toFixed(2)} 字/秒 · 正確率 ${(r.accuracy * 100).toFixed(1)}%（履歴を読み込めませんでした）`;
    });

  $('r-title').textContent = isPatch ? '[ PATCH COMPLETE ]' : '[ RUN COMPLETE ]';
  $('r-mode').textContent = isPatch ? `パッチ練習${interrupted ? '（中断あり）' : ''}` : isPassage ? `長文練習${round.session.complete ? '（完了）' : '（途中終了）'}${interrupted ? '・中断あり' : ''}` : interrupted ? '練習扱い（中断あり）' : '60秒ベンチマーク';

  $('r-speed').innerHTML = `${r.kanaPerSec.toFixed(2)}<small style="font-size:22px"> 字/秒</small>`;
  $('r-kpm').textContent = `${Math.round(r.keysPerMin)} 打鍵/分（参考）`;
  $('r-acc').innerHTML = `${(r.accuracy * 100).toFixed(1)}<small style="font-size:22px">%</small>`;
  $('r-miss').textContent = `ミス ${r.misses}`;
  $('r-chain').textContent = String(r.maxChain);
  $('r-layers').textContent = `破った層 ${r.layers} / 防壁 ${r.firewalls}`;

  const near = $('r-near');
  if (!eligibleForBest) near.innerHTML = best ? `ベスト <b>${best.toFixed(2)} 字/秒</b>　・　${isPatch ? 'パッチ' : '練習'}結果は自己ベストの対象外` : 'この練習結果は自己ベストの対象外です。自己ベストはベンチマークで記録します。';
  else if (!best) near.innerHTML = `初回記録 <b>${r.kanaPerSec.toFixed(2)} 字/秒</b>。ここから自分を超えていく。`;
  else if (r.kanaPerSec > best) near.innerHTML = `<b>自己ベスト更新</b>　+${(r.kanaPerSec - best).toFixed(2)} 字/秒（前回ベスト ${best.toFixed(2)}）`;
  else if (r.kanaPerSec === best) near.innerHTML = `<b>自己ベストタイ</b>　${best.toFixed(2)} 字/秒`;
  else if (r.kanaPerSec >= best * 0.97) near.innerHTML = `自己ベストまで あと <b>${(best - r.kanaPerSec).toFixed(2)}</b> 字/秒（ベスト ${best.toFixed(2)}）`;
  else near.innerHTML = `ベスト <b>${best.toFixed(2)} 字/秒</b>`;

  const vuln = $('r-vuln');
  const missedKeySamples = r.missedKey ? round.log.filter((e) => (e.correct ? e.key : e.intended) === r.missedKey!.key).length : 0;
  if (r.slowBigram) {
    vuln.innerHTML = `VULN 検出：<code>${esc(r.slowBigram.pair)}</code> の遷移が中央値より <code>+${Math.round(r.slowBigram.excessMs)}ms</code>（サンプル ${r.slowBigram.count} 回）`;
  } else if (r.missedKey) {
    vuln.innerHTML = `VULN 検出：<code>${esc(r.missedKey.key)}</code> の手前でミス ${r.missedKey.count} 回（サンプル ${missedKeySamples} 打鍵）`;
  } else {
    vuln.textContent = 'VULN 検出なし：データが少ないか、目立った弱点なし';
  }
  if (r.slowBigram && r.missedKey) vuln.innerHTML += `　／　<code>${esc(r.missedKey.key)}</code> の手前でミス ${r.missedKey.count} 回（サンプル ${missedKeySamples} 打鍵）`;
  showOverlay('result-screen');
}

function toTitle() {
  mode = 'title';
  round = null;
  settingsOpen = false;
  clearTimeout(errTimer);
  clearTimeout(popTimer);
  els.readyHelp.classList.add('hidden');
  els.chainPop.classList.remove('visible');
  els.ime.classList.add('hidden');
  renderTitle();
  showOverlay('title-screen');
}

// ---- input ----------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const editable = e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [contenteditable]');
  // Composition can use Enter/Escape to confirm/cancel text. It must never
  // trigger a menu action, resume a round, or enter the typing log.
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    if (editable) return;
    if (mode === 'play' && !round?.paused) els.ime.classList.remove('hidden');
    e.preventDefault();
    return;
  }
  if (dialogFocus.active) {
    if (e.key === 'Tab') { dialogFocus.cycle(e); return; }
    if (!dialogFocus.contains(e.target)) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!e.repeat) settingsOpen ? closeSettings() : toTitle();
      return;
    }
    if (editable) return;
    if (e.repeat) { e.preventDefault(); return; }
    if (settingsOpen) {
      if (e.key === '1') cycleEffect('shake');
      else if (e.key === '2') cycleEffect('flash');
      else if (e.key === '3') cycleEffect('motion');
      else if (e.key.toLowerCase() === 's') closeSettings();
    } else if (round?.paused) {
      if (e.key.toLowerCase() === 'r') startRound(lastRun);
      else if (e.key.toLowerCase() === 'q') toTitle();
    }
    // Space/Enter activate only the focused native button, on its normal event.
    // All other modal keys finish here instead of reaching the game.
    return;
  }
  if (mode === 'play' && e.key === 'Escape') {
    e.preventDefault();
    if (!e.repeat) {
      if (e.target instanceof HTMLElement && e.target.closest('button, input, select, textarea, [contenteditable]')) {
        $('input-panel').focus({ preventScroll: true });
      } else pauseRound(e.timeStamp);
    }
    return;
  }
  // Native controls own their keys. Tab follows the browser's focus order;
  // Escape releases control focus on non-play screens.
  if (e.key === 'Tab') return;
  if (e.target instanceof HTMLElement && e.target.closest('button, input, select, textarea, [contenteditable]')) {
    if (e.key !== 'Escape') return;
    e.target.blur();
  }
  if (e.key === ' ') e.preventDefault();

  els.ime.classList.add('hidden');
  audio.ensure();

  if (mode === 'report') {
    if (e.repeat) return;
    if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') closeReport();
    else if (/^[1-8]$/.test(e.key)) startPatch(Number(e.key) - 1);
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
    else if (e.key.toLowerCase() === 'd') {
      dictIdx = (dictIdx + 1) % DICTIONARIES.length;
      reportRequest++;
      report = null;
      store.set('dict', dictIdx);
      renderTitle();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleSound();
    } else if (e.key === 's' || e.key === 'S') {
      openSettings();
    }
    return;
  }
  if (mode === 'result') {
    if (e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') startRound(lastRun);
    else if (e.key === 'Escape') toTitle();
    else if (e.key === 'r' || e.key === 'R') void openReport();
    return;
  }

  // play
  if (!round) return;
  if (e.repeat || e.key.length !== 1) return;
  if (round.finished) return;
  if (e.key === ' ' && !round.session.expected.includes(' ')) return;

  const out = round.input(e.key, e.timeStamp, e.code);
  if (out.late) return endRound();
  if (out.accepted) {
    audio.key(round.stage, out.critical);
    scene.hit(out.critical, out.criticalGainMs);
    if (effects.motion > 0) els.chain.animate([{ transform: `scale(${1 + 0.12 * effects.motion})` }, { transform: 'scale(1)' }], { duration: 140, easing: 'ease-out' });
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
    if (effects.flash > 0) {
      void els.edge.offsetWidth;
      els.edge.classList.add('on');
    }
    renderPanel(true);
    clearTimeout(errTimer);
    errTimer = window.setTimeout(() => mode === 'play' && renderPanel(), 160);
  }
  const announcements: string[] = [];
  if (out.wordDone && isInterceptWord(round.wordsDone - 1)) announcements.push('迎撃成功');
  if (out.accepted && [10, 30, 50, 100, 200].includes(round.chain)) announcements.push(`CHAIN ${round.chain}!`);
  if (out.stageChanged) announcements.push(`OVERCLOCK ${['0', 'I', 'II', 'III'][round.stage]}`);
  announce(announcements);
  renderHud();
  renderAccuracy();
  renderClock(e.timeStamp);
  if (round.finished) endRound();
});

window.addEventListener('blur', (e) => pauseRound(e.timeStamp));
document.addEventListener('visibilitychange', (e) => {
  if (document.hidden) pauseRound(e.timeStamp || performance.now());
});

// ---- loop -----------------------------------------------------------------

let lastFrame = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (mode === 'play' && round && !round.paused) {
    round.tick(now, dt);
    renderClock(now);
    if (round.finished) endRound();
  }
  scene.setActive(mode === 'play' && !!round?.started && !round.paused && !round.finished);
  scene.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

applyEffects();
renderAccuracy();
renderTitle();
showOverlay('title-screen');
