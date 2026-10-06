import './style.css';
import { Round, type RoundOptions } from './game/round';
import { DICTIONARIES, type Dictionary, type Word } from './content/words';
import { TypingSession, normalizeReading } from './engine/romaji';
import { Audio } from './fx/audio';
import { DialogFocus } from './ui/dialog';
import { renderReport } from './ui/report';
import { loadEvents, loadSessions, saveSession } from './stats/store';
import { analyze } from './stats/analyze';
import { loadBaselines, updateBaselines } from './stats/baselines';
import { PatchSource } from './stats/select';
import type { Report, StoredKey, Vuln } from './stats/types';
import { createSettingsStore, isBoolean, isDictionaryIndex, isEffectLevel, isNonNegativeNumber, isSpellingPreferences, isVolume } from './storage/settings';
import { CHARACTERS, PLACES, RecentSpeed, isCharacter, isPlaceIndex, journeyDictionary, journeySource } from './game/journey';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $('angel-ui-studio'), app = $('angel-app'), main = $('angel-main');
const dialogs = new DialogFocus(root);
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const art = (name: string) => `${import.meta.env.BASE_URL}angel/${name}.webp`;
const picture = (name: string, alt: string, cls = '') => `<img class="${cls}" src="${art(name)}" alt="${esc(alt)}" loading="lazy" decoding="async" />`;
const action = (label: string, name: string, cls = '') => `<button type="button" class="av-action ${cls}" data-action="${name}">${label}</button>`;
const settings = createSettingsStore(issue => {
  const text = issue === 'invalid' ? '保存設定の一部を読み込めません。一時設定で動作しています。元の保存内容は保持しています。'
    : issue === 'unavailable' ? '設定はこのページ内でのみ保持します。再読み込みすると失われます。' : '';
  for (const id of ['settings-storage-state', 'settings-save-state']) {
    const el = $(id); if (el.textContent !== text) el.textContent = text; el.hidden = !text;
  }
});
let character = settings.get('angel.character', 'elna', isCharacter);
let place = settings.get('angel.place', 0, isPlaceIndex);
let dictIndex = settings.get('dict', 0, isDictionaryIndex(DICTIONARIES.length));
const prefs = settings.get('prefs', {}, isSpellingPreferences);
const audio = new Audio(); audio.enabled = settings.get('sound', true, isBoolean); audio.setVolume(settings.get('volume', 1, isVolume));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motion = settings.get('effects.motion', reducedMotion.matches ? 0 : 1, isEffectLevel);
let lowGraphics = settings.get('graphics.low', false, isBoolean);
let view: 'characters' | 'journey' | 'training' | 'records' | 'battle' | 'result' = 'characters';
let round: Round | null = null;
type Run = { dict: Dictionary; mode: NonNullable<RoundOptions['mode']>; place: number; character: typeof character; focus?: string; vulns?: Vuln[] };
let run: Run | null = null;
let endedRound: Round | null = null;
let score = 0;
const speed = new RecentSpeed();
let read: AbortController | undefined;
let request = 0;
let report: { data: Report; dict: Dictionary } | undefined;
let recordDict = DICTIONARIES[dictIndex];
let reportMetric: 'latency' | 'miss' = 'latency';
let panelWord: Word | undefined;
let animations: Animation[] = [];
let modal: 'pause-dialog' | 'settings-dialog' | null = null;

function motionEnabled() { return motion > 0 && !reducedMotion.matches && !lowGraphics; }
function applyEffects() {
  app.classList.toggle('no-motion', !motionEnabled());
  $('setting-motion').textContent = motion === 0 ? 'オフ' : motion === 0.5 ? '弱' : '標準';
  $('setting-graphics').textContent = lowGraphics ? '低負荷' : '標準';
  if (!motionEnabled()) { stopAnimations(); app.style.setProperty('--av-depth', '1'); }
}
function stopAnimations() { for (const animation of animations) animation.cancel(); animations = []; }
reducedMotion.addEventListener('change', applyEffects);
function renderSound() {
  $('setting-sound').textContent = audio.enabled ? audio.unavailable ? '利用不可（オフ→オンで再試行）' : 'オン' : 'オフ';
  $('sound-toggle').setAttribute('aria-pressed', String(audio.enabled));
  $<HTMLInputElement>('sound-volume').value = String(audio.volume);
}
audio.onAvailabilityChange = renderSound;
function showModal(id: typeof modal) {
  const origin = document.activeElement;
  modal = id;
  for (const name of ['pause-dialog', 'settings-dialog']) $(name).hidden = name !== id;
  dialogs.show(id ? $(id) : null, origin);
}
function updateNav() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.disabled = view === 'battle';
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}
function changeView(next: typeof view) {
  read?.abort(); read = undefined; request++; report = undefined;
  showModal(null); stopAnimations(); app.style.setProperty('--av-depth', '1');
  view = next; updateNav(); render();
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (next !== 'battle') main.querySelector<HTMLElement>('h1,h2')?.focus({ preventScroll: true });
}
function render() {
  if (view === 'characters') {
    main.innerHTML = `<section class="av-page av-character-page"><div class="av-heading"><p class="av-eyebrow">空と祈り</p><h1 tabindex="-1">誰と旅に出る？</h1><p>言葉を唱えて、下界への道をひらこう。</p></div><div class="av-choice-grid">${Object.entries(CHARACTERS).map(([key, p]) => `<button type="button" class="av-choice" data-person="${key}" aria-pressed="${character === key}">${picture(`player-${key}`, p.name)}<div class="av-choice-copy"><strong>${p.name}</strong><p>${p.role}<br>「${p.quote}」</p></div></button>`).join('')}</div><div class="av-page-footer"><span>${CHARACTERS[character].name}を選択中</span>${action('この天使で旅に出る', 'map', 'primary')}</div></section>`;
  } else if (view === 'journey') {
    const p = PLACES[place];
    main.innerHTML = `<section class="av-page"><div class="av-heading"><p class="av-eyebrow">SEVEN PLACES</p><h1 tabindex="-1">旅の地図</h1><p>ひとつの言葉で、ひとつの封印を。時間制限のない道中練習です。</p></div><div class="av-map">${PLACES.map((p, i) => `<button type="button" class="av-choice" data-place="${i}" aria-pressed="${i === place}">${picture(p.art, p.name)}<div class="av-choice-copy"><small>STAGE ${String(i + 1).padStart(2, '0')}</small><strong>${p.name}</strong><span>${p.sub}</span></div></button>`).join('')}</div><div class="av-page-footer"><span>${CHARACTERS[character].name} · ${p.name}を選択中</span>${action('この場所へ', 'start-journey', 'primary')}</div><p class="av-footnote">各場所で五つの封印を突破する道中。ボス戦と物語の結末は制作中です。</p></section>`;
  } else if (view === 'training') {
    main.innerHTML = `<section class="av-page"><div class="av-heading"><p class="av-eyebrow">PRACTICE</p><h1 tabindex="-1">言葉を磨く</h1><p>旅のあいだに、打ちやすい指づかいを見つけよう。</p></div><div class="av-training-grid"><section class="av-card"><h2>60秒の計測</h2><p>日本語・英語の正確さと速度を記録。最初のキーで時計が動きます。</p><label>辞書 <select id="training-dict">${DICTIONARIES.map((d, i) => `<option value="${i}" ${i === dictIndex ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>${action('選んだ辞書で練習する', 'start-training', 'primary')}<p class="av-footnote">中断した計測と長文・弱点練習は自己ベストの対象外。</p></section><section class="av-card"><h2>ゆっくり長文</h2><p>読みとローマ字が入力位置を追いかけます。時間制限なし。途中終了も記録できます。</p>${action('長文を練習する', 'start-passage')}<hr><h2>自分の弱点を知る</h2><p>記録から遅い指の遷移やミスを確認し、弱点に合わせた練習へ。</p>${action('練習記録を見る', 'records')}</section></div><p class="av-help">shi / si・chi / tiなどの別綴りに対応。IMEはオフ。ミスはそのまま打ち直し、Backspaceは不要です。</p></section>`;
  } else if (view === 'records') {
    main.innerHTML = `<section class="av-page av-records"><h1 tabindex="-1">練習の記録</h1><div class="av-record-controls"><label>見る辞書 <select id="record-dict">${[...DICTIONARIES, ...PLACES.map((_, i) => journeyDictionary(i))].map(d => `<option value="${d.id}" ${d.id === recordDict.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>${action('遅さ / ミス率を切り替える', 'metric')}${action('戻る', 'map')}</div><div id="report" class="rp" aria-busy="true"><p role="status">記録を読み込み中…</p></div></section>`;
    void showRecords();
  }
  applyEffects();
}

function meter(kind: 'speed' | 'accuracy') {
  const isSpeed = kind === 'speed', label = isSpeed ? '速度' : '正確性', max = isSpeed ? 8 : 100;
  return `<div class="av-meter ${isSpeed ? '' : 'precision'}"><div class="av-meter-label">${label}</div><div class="av-gauge"><svg viewBox="0 0 126 126" role="meter" aria-label="${isSpeed ? '直近の正しい打鍵速度（目盛上限8打毎秒）' : '正確性'}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="0"><circle class="av-gauge-track" cx="63" cy="63" r="50" pathLength="100" transform="rotate(135 63 63)" stroke-dasharray="75 100"/><circle id="${kind}-arc" class="av-gauge-fill" cx="63" cy="63" r="50" pathLength="100" transform="rotate(135 63 63)" stroke-dasharray="0 100"/></svg><div class="av-meter-number"><strong id="${kind}-value">0</strong><small>${isSpeed ? '打／秒' : '%'}</small></div></div><div class="av-meter-caption">${isSpeed ? '直近12打鍵' : '言葉の精度'}</div></div>`;
}
function start(spec: Run) {
  read?.abort(); request++; report = undefined; run = { ...spec }; endedRound = null;
  const opts: RoundOptions = { mode: spec.mode, baselines: loadBaselines(spec.dict), seed: Math.floor(Math.random() * 2 ** 32) };
  if (spec.mode === 'journey') { opts.source = journeySource(spec.dict); opts.wordLimit = spec.dict.words.length; }
  if (spec.mode === 'patch') {
    try { opts.source = new PatchSource(spec.dict.words, spec.dict.id, spec.vulns ?? [], prefs, { seed: opts.seed!, focus: spec.focus }); }
    catch { changeView('training'); main.insertAdjacentHTML('beforeend', '<p class="av-help" role="status">この辞書は弱点練習の候補が不足しています。通常練習を利用してください。</p>'); return; }
  }
  round = new Round(spec.dict, prefs, opts); score = 0; speed.reset(); panelWord = undefined;
  audio.reset(); audio.ensure(); stopAnimations(); app.style.setProperty('--av-depth', '1');
  view = 'battle'; updateNav(); showModal(null);
  const p = PLACES[spec.place], person = CHARACTERS[spec.character];
  main.innerHTML = `<section class="av-battle" aria-label="${p.name} タイピング"><div class="av-landscape" style="background-image:url('${art(p.art)}')" aria-hidden="true"></div><div class="av-hud"><div class="av-pilot"><div class="av-eyebrow">旅する天使</div><div class="av-pilot-name">${person.name}</div><div class="av-route-label">${spec.mode === 'journey' ? '道中の祈り' : esc(spec.dict.name)}</div></div><div class="av-stage"><div class="av-eyebrow">STAGE ${String(spec.place + 1).padStart(2, '0')} ／ ${p.sub}</div><div class="av-stage-name">${p.name}</div><div class="av-stage-progress" aria-label="旅の第${spec.place + 1}章">${PLACES.map((_, i) => `<i class="${i <= spec.place ? 'active' : ''}"></i>`).join('')}</div></div><div class="av-score-box"><div class="av-eyebrow">SCORE</div><div class="av-score" id="score">0</div><div class="av-combo"><strong id="combo">0</strong> COMBO</div></div></div><div class="av-arena"><section class="av-quest"><div class="av-quest-top"><span>${spec.mode === 'journey' ? 'QUEST' : 'PRACTICE'}</span><span id="quest-count">0 / 5</span></div><div class="av-quest-title">${spec.mode === 'journey' ? '五つの封印を<br>解き放つ' : spec.mode === 'passage' ? '言葉を最後まで<br>届けよう' : spec.mode === 'patch' ? `指づかいを磨く<br>${esc(spec.focus ?? '')}` : '自分の速さを<br>見つけよう'}</div><div class="av-quest-track" id="quest-track" role="progressbar" aria-label="練習の進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="quest-progress"></i></div><div class="av-quest-note" id="quest-note">${spec.mode === 'journey' ? '実績：門をひらく者' : spec.mode === 'passage' ? '時間制限なし' : '最初のキーから60秒'}</div></section><div class="av-obstacle-area" aria-hidden="true"><div class="av-obstacle" id="seal"><span id="seal-label">${p.landmark}</span></div><div class="av-spell" id="spell"></div><div class="av-obstacle-note" id="seal-note">一語の祈りで、道をひらく</div></div><aside class="av-speaker" aria-label="${person.name}の台詞"><div class="av-speech"><div class="av-speaker-name">${person.name}</div><div class="av-speech-text" id="speech">${person.opening}</div></div><div class="av-portrait">${picture(`player-${spec.character}`, person.name)}</div></aside></div><div class="av-combat-dock">${meter('speed')}<section class="av-main-panel" id="input-panel" tabindex="-1" aria-label="タイピング入力"><div class="av-input-top"><span id="input-label">言葉を唱える</span>${action('一時停止', 'pause')}</div><div class="av-current-word" id="word"></div><div class="av-reading" id="reading"></div><div class="av-romaji" id="romaji"></div><div class="av-input-status" id="input-status" role="status">最初のキーでスタート · ミスは打ち直し</div><div class="av-next"><span>次の言葉</span><div><strong id="next-word"></strong><span class="av-guide" id="next-guide"></span></div></div></section><div class="av-right-side">${meter('accuracy')}<div class="av-later"><span>その次の言葉</span><strong id="following-word"></strong><span class="av-guide" id="following-guide"></span></div></div></div><div class="av-bottom"><div class="av-shortcuts">Esc 一時停止 ／ IME OFF<br><span id="clock">最初のキーでスタート</span></div><span class="av-footnote">スコアは旅の演出用。記録の速度・正確率とは別です。</span></div><div id="ime-warning" class="av-ime" role="status" hidden>IMEをオフにしてください（英数入力）</div><div id="achievement" class="av-achievement" role="status" hidden><small>この挑戦の実績</small><strong>門をひらく者</strong></div></section>`;
  applyEffects(); renderPanel(); renderMeters(performance.now()); $('input-panel').focus({ preventScroll: true });
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}
function follow(container: HTMLElement, marker: HTMLElement | null) {
  if (!marker) return;
  const top = marker.offsetTop, bottom = top + marker.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}
function renderPanel(miss = false) {
  if (!round || !run || view !== 'battle') return;
  const s = round.session, w = round.word, long = !!w.segments;
  const panel = $('input-panel'); panel.classList.toggle('long-input', long); panel.classList.toggle('miss', miss);
  main.querySelector('.av-next > span')!.textContent = long ? '次の文章（冒頭）' : '次の言葉';
  main.querySelector('.av-later > span')!.textContent = long ? 'その次の文章（冒頭）' : 'その次の言葉';
  if (panelWord !== w) {
    panelWord = w;
    $('word').innerHTML = w.segments ? w.segments.map(segment => `<span>${esc(segment.display)}</span>`).join('') : esc(w.display);
    for (const id of ['word', 'reading', 'romaji']) $(id).scrollTop = 0;
  }
  if (w.segments) {
    let end = 0, active = w.segments.length - 1;
    w.segments.some((segment, i) => { end += normalizeReading(segment.reading).length; if (s.kanaDone < end) { active = i; return true; } return false; });
    [...$('word').children].forEach((el, i) => { el.classList.toggle('done', i < active); el.classList.toggle('current-sentence', i === active); });
    follow($('word'), $('word').children[active] as HTMLElement);
  }
  const reading = run.dict.id.startsWith('jp') ? normalizeReading(w.reading) : '';
  $('reading').innerHTML = `<span class="done">${esc(reading.slice(0, s.kanaDone))}</span><span class="reading-position">${esc(reading.slice(s.kanaDone, s.kanaDone + 1))}</span>${esc(reading.slice(s.kanaDone + 1))}`;
  $('romaji').innerHTML = `<span class="av-typed">${esc(s.typed)}</span><span class="current-unit">${esc(s.guide.slice(s.typed.length, s.typed.length + 1)) || ' '}</span>${esc(s.guide.slice(s.typed.length + 1))}`;
  if (long) { follow($('reading'), $('reading').querySelector('.reading-position')); follow($('romaji'), $('romaji').querySelector('.current-unit')); }
  $('input-label').textContent = long ? '長文 · 句読点は , と .' : run.mode === 'patch' ? `弱点練習 · ${run.focus}` : '言葉を唱える';
  const remaining = run.mode === 'journey' ? round.wordLimit - round.wordsDone - 1 : Infinity;
  for (const [prefix, word, available] of [['next', round.nextWord, remaining > 0], ['following', round.followingWord, remaining > 1]] as const) {
    const preview = word.segments?.[0] ?? word;
    $(`${prefix}-word`).textContent = available ? preview.display : 'この道中の終わり';
    $(`${prefix}-word`).title = available ? word.display : '';
    $(`${prefix}-guide`).textContent = available ? new TypingSession(preview.reading, { prefs }).guide : '';
  }
  const fraction = s.kanaDone / Math.max(1, normalizeReading(w.reading).length);
  $('seal').style.setProperty('--charge', `${fraction * 100}%`);
  $('seal').style.borderWidth = `${1 + fraction * 3}px`;
}
function renderMeters(now: number) {
  if (!round || !run || view !== 'battle') return;
  const rate = speed.value(now), accuracy = round.accuracy() * 100;
  for (const [kind, value, max] of [['speed', rate, 8], ['accuracy', accuracy, 100]] as const) {
    $(`${kind}-value`).textContent = kind === 'speed' ? value.toFixed(1) : value === 100 ? '100' : value.toFixed(1);
    const arc = $(`${kind}-arc`); arc.setAttribute('stroke-dasharray', `${Math.min(value / max, 1) * 75} 100`);
    arc.parentElement!.setAttribute('aria-valuenow', String(Math.min(value, max)));
    arc.parentElement!.setAttribute('aria-valuetext', kind === 'speed' ? `${value.toFixed(1)}打毎秒` : `${value.toFixed(1)}%`);
  }
  $('combo').textContent = String(round.chain); $('score').textContent = score.toLocaleString('ja-JP');
  const elapsed = round.elapsedMs(now), untimed = run.mode === 'journey' || run.mode === 'passage';
  $('clock').textContent = !round.started ? '最初のキーでスタート' : untimed ? `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')} · 時間制限なし` : `残り ${Math.ceil(round.remainingMs(now) / 1000)} 秒`;
  const fraction = run.mode === 'journey' ? round.wordsDone / round.wordLimit : run.mode === 'passage' ? round.session.kanaDone / normalizeReading(round.word.reading).length : elapsed / 60000;
  $('quest-track').setAttribute('aria-valuenow', String(Math.min(100, fraction * 100))); $('quest-progress').style.width = `${Math.min(100, fraction * 100)}%`;
  $('quest-count').textContent = run.mode === 'journey' ? `${round.wordsDone} / ${round.wordLimit}` : `${round.wordsDone} 語`;
}
function breakthrough() {
  if (!round || !run) return;
  $('speech').textContent = CHARACTERS[run.character].clear;
  $('seal-note').textContent = `封印を突破 · ${round.wordsDone} 語`;
  if (run.mode === 'journey' && round.wordsDone === round.wordLimit) $('achievement').hidden = false;
  if (!motionEnabled()) return;
  stopAnimations();
  animations = [
    $('seal').animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.55)', opacity: 0, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 540, easing: 'ease-out' }),
    $('spell').animate([{ transform: 'translateY(90px)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'translateY(-60px)', opacity: 0 }], { duration: 380, easing: 'ease-out' }),
  ];
  app.style.setProperty('--av-depth', String(1 + Math.min(round.wordsDone * 0.015 * motion, 0.12)));
}
function pause(now = performance.now()) {
  if (view !== 'battle' || !round || round.finished) return;
  round.pause(now); if (round.finished) { end(); return; }
  speed.reset(); for (const animation of animations) animation.pause();
  // Freeze the CSS background transition along with the input and clock.
  const landscape = main.querySelector<HTMLElement>('.av-landscape');
  if (landscape) { landscape.style.transform = getComputedStyle(landscape).transform; landscape.style.transition = 'none'; }
  $('pause-finish').hidden = !round.started || (round.mode !== 'journey' && round.mode !== 'passage');
  $('pause-note').textContent = '時計と入力を停止しています。再開後の最初の打鍵は速度の分析から除外します。やり直し・地図へ戻ると未保存の入力は残りません。';
  $('ime-warning').hidden = true; showModal('pause-dialog');
}
function resume() {
  if (!round || view !== 'battle') return;
  round.resume(performance.now()); speed.reset(); audio.ensure(); showModal(null);
  for (const animation of animations) animation.play();
  const landscape = main.querySelector<HTMLElement>('.av-landscape');
  if (landscape) { landscape.style.transform = ''; landscape.style.transition = ''; }
  $('input-panel').focus({ preventScroll: true });
}
function end() {
  if (!round || !run || endedRound === round) return;
  endedRound = round; const finished = round, spec = run, result = round.result();
  showModal(null); stopAnimations(); view = 'result'; updateNav();
  const fullJourney = spec.mode === 'journey' && round.wordsDone === round.wordLimit;
  const mode = spec.mode === 'journey' ? fullJourney ? 'journey' : 'practice' : spec.mode === 'patch' ? 'patch' : spec.mode === 'passage' || round.interrupted ? 'practice' : 'benchmark';
  const bestKey = `pb.${spec.dict.id}`, best = settings.get(bestKey, 0, isNonNegativeNumber);
  if (mode === 'benchmark' && result.kanaPerSec > best) settings.set(bestKey, result.kanaPerSec);
  settings.set('prefs', prefs); updateBaselines(spec.dict, round.log);
  const session = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const events: StoredKey[] = round.log.map(e => ({ ...e, session, dict: spec.dict.id, mode }));
  const meta = { session, dict: spec.dict.id, mode, kanaPerSec: result.kanaPerSec, accuracy: result.accuracy, endedAt: Date.now() };
  const label = fullJourney ? '五つの封印を突破' : spec.mode === 'journey' ? '道中の途中記録' : spec.mode === 'passage' ? round.session.complete ? '長文を完了' : '長文の途中記録' : spec.mode === 'patch' ? '弱点練習の記録' : '60秒の記録';
  const feedback = result.slowBigram ? `「${result.slowBigram.pair}」の遷移が中央値より${Math.round(result.slowBigram.excessMs)}ms長め（${result.slowBigram.count}回）。` : result.missedKey ? `「${result.missedKey.key}」で${result.missedKey.count}回打ち直しました。` : '言葉をひとつずつ、正確に届けよう。';
  main.innerHTML = `<section class="av-page av-result"><p class="av-eyebrow">${esc(spec.dict.name)} ／ ${CHARACTERS[spec.character].name}</p><h1 tabindex="-1">${label}</h1><p>${fullJourney ? CHARACTERS[spec.character].clear : 'おつかれさま。自分のペースで、また続けよう。'}</p>${fullJourney ? '<p class="av-earned">この挑戦の実績：門をひらく者</p>' : ''}<div class="av-result-grid"><div><span>速度</span><strong>${result.kanaPerSec.toFixed(2)}<small>字／秒</small></strong><small>${Math.round(result.keysPerMin)} 打鍵／分（参考）</small></div><div><span>正確率</span><strong>${(result.accuracy * 100).toFixed(1)}<small>%</small></strong><small>ミス ${result.misses}</small></div><div><span>最大コンボ</span><strong>${result.maxChain}</strong><small>完了 ${round.wordsDone} 語</small></div></div><p class="av-help">${esc(feedback)}</p><p class="av-footnote">${mode === 'benchmark' ? result.kanaPerSec > best ? '自己ベスト更新' : `自己ベスト ${best.toFixed(2)} 字／秒` : '練習記録です。60秒計測の自己ベストの対象外。'}${round.interrupted ? ' · 中断あり' : ''}</p><p id="session-save-state" class="av-save" role="status">今回の記録を保存中…</p><div id="recent-sessions"></div><div class="av-page-footer">${action('もう一度', 'retry', 'primary')}${fullJourney && spec.place < PLACES.length - 1 ? action('次の場所へ', 'next-place') : ''}${action('旅の地図', 'map')}${action('この辞書の記録', 'run-records')}</div></section>`;
  main.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  void saveSession(events, meta).then(async status => {
    if (round !== finished || view !== 'result') return;
    $('session-save-state').textContent = status === 'persistent' ? '今回の練習記録をこのブラウザに保存しました。' : '今回の記録は一時保持のみです。再読み込みやページを閉じると失われます。次の保存時に再試行します。';
    let partial = false;
    const sessions = await loadSessions(spec.dict.id, () => { partial = true; });
    if (round !== finished || view !== 'result') return;
    const recent = [meta, ...sessions.filter(s => s.session !== session)].sort((a, b) => b.endedAt - a.endedAt).slice(0, 5);
    $('recent-sessions').innerHTML = `<h2>直近の練習</h2>${partial ? '<p role="status">読み込めた記録と一時保持分だけを表示しています。</p>' : ''}${recent.map(s => `<div class="av-record-row"><span>${s.session === session ? '今回' : esc(new Date(s.endedAt).toLocaleString('ja-JP'))}</span><b>${s.kanaPerSec.toFixed(2)} 字／秒</b><span>${(s.accuracy * 100).toFixed(1)}%</span><small>${s.mode === 'journey' ? '道中完了' : s.mode === 'benchmark' ? '計測' : '練習'}</small></div>`).join('')}`;
  }).catch(() => { if (round === finished && view === 'result') $('session-save-state').textContent = '保存状態を確認できませんでした。この画面の結果を確認してください。'; });
}
async function showRecords() {
  read?.abort(); const controller = new AbortController(); read = controller; const token = ++request, dict = recordDict;
  report = undefined;
  $('report').setAttribute('aria-busy', 'true');
  let partial = false; const unavailable = () => { partial = true; };
  const [events, sessions] = await Promise.all([loadEvents(dict.id, unavailable, controller.signal), loadSessions(dict.id, unavailable, controller.signal)]);
  if (controller.signal.aborted || token !== request || view !== 'records') return;
  if (read === controller) read = undefined;
  const data = analyze(events.filter(e => e.mode !== 'patch'), { dict: dict.id });
  const metas = new Map(sessions.map(s => [s.session, s]));
  const benchmarks = new Set(events.filter(e => e.mode === 'benchmark').map(e => e.session));
  data.trend = data.trend.filter(p => metas.get(p.session)?.mode === 'benchmark' || (!metas.has(p.session) && benchmarks.has(p.session))).map(p => ({ ...p, kanaPerSec: metas.get(p.session)?.kanaPerSec, accuracy: metas.get(p.session)?.accuracy ?? p.accuracy }));
  const seen = new Set(data.trend.map(p => p.session));
  data.trend.push(...sessions.filter(s => s.mode === 'benchmark' && !seen.has(s.session)).map(s => ({ session: s.session, kanaPerSec: s.kanaPerSec, latencyMs: NaN, accuracy: s.accuracy })));
  const el = $('report'); renderReport(el, data, dict.name, reportMetric);
  el.querySelector('h1')!.textContent = '指づかいの分析';
  el.querySelector('.rp-head .eyebrow')!.textContent = dict.name;
  el.querySelector('.rp-footer')!.textContent = 'ログはこのブラウザだけに保存されます。旅・長文・弱点練習は計測の成長グラフから除外します。';
  el.querySelectorAll('tbody tr').forEach((row, i) => {
    if (data.vulns[i]) row.lastElementChild!.innerHTML = `<button type="button" class="av-action" data-patch="${i}">ここを練習</button>`;
  });
  if (partial) el.insertAdjacentHTML('afterbegin', '<p role="status" class="av-help">保存領域の一部を読み込めません。取得できた記録と一時保持分だけを表示しています。確定済みの一時保持は直近5件、未保存分は全件です。復旧後に開き直してください。</p>');
  el.setAttribute('aria-busy', 'false'); report = { data, dict };
}
function patch(index: number) {
  const item = report?.data.vulns[index]; if (!item || !report || view !== 'records') return;
  start({ dict: report.dict, mode: 'patch', focus: item.label, vulns: report.data.vulns, place, character });
}
function openSettings() {
  if (view === 'battle' && !round?.paused) pause();
  renderSound(); applyEffects(); showModal('settings-dialog');
}
function closeSettings() { showModal(view === 'battle' && round?.paused ? 'pause-dialog' : null); }
function perform(name: string) {
  if (name === 'map') { round = null; changeView('journey'); }
  else if (name === 'records') { recordDict = DICTIONARIES[dictIndex]; changeView('records'); }
  else if (name === 'run-records' && run) { recordDict = run.dict; changeView('records'); }
  else if (name === 'start-journey') start({ dict: journeyDictionary(place), mode: 'journey', place, character });
  else if (name === 'start-training') { const dict = DICTIONARIES[dictIndex]; start({ dict, mode: dict.kind === 'passage' ? 'passage' : 'benchmark', place, character }); }
  else if (name === 'start-passage') start({ dict: DICTIONARIES.find(d => d.kind === 'passage')!, mode: 'passage', place, character });
  else if (name === 'retry' && run) start(run);
  else if (name === 'next-place' && run) { place = Math.min(PLACES.length - 1, run.place + 1); settings.set('angel.place', place); changeView('journey'); }
  else if (name === 'pause') pause();
  else if (name === 'resume') resume();
  else if (name === 'finish' && round) { round.finish(performance.now()); end(); }
  else if (name === 'settings') openSettings();
  else if (name === 'close-settings') closeSettings();
  else if (name === 'motion') { motion = motion === 0 ? 0.5 : motion === 0.5 ? 1 : 0; settings.set('effects.motion', motion); applyEffects(); }
  else if (name === 'graphics') { lowGraphics = !lowGraphics; settings.set('graphics.low', lowGraphics); applyEffects(); }
  else if (name === 'sound') { audio.enabled = !audio.enabled; settings.set('sound', audio.enabled); audio.ensure(); renderSound(); }
  else if (name === 'metric') { reportMetric = reportMetric === 'latency' ? 'miss' : 'latency'; if (view === 'records') void showRecords(); }
}
root.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || button.disabled || !root.contains(button)) return;
  if (dialogs.active && !dialogs.contains(button)) return;
  if (button.dataset.action) perform(button.dataset.action);
  else if (button.dataset.view && view !== 'battle') changeView(button.dataset.view as typeof view);
  else if (button.dataset.person && isCharacter(button.dataset.person)) {
    character = button.dataset.person; settings.set('angel.character', character); render(); main.querySelector<HTMLElement>(`[data-person="${character}"]`)?.focus();
  } else if (button.dataset.place !== undefined && isPlaceIndex(Number(button.dataset.place))) {
    place = Number(button.dataset.place); settings.set('angel.place', place); render(); main.querySelector<HTMLElement>(`[data-place="${place}"]`)?.focus();
  } else if (button.dataset.patch !== undefined) patch(Number(button.dataset.patch));
});
root.addEventListener('change', event => {
  const target = event.target as HTMLSelectElement;
  if (target.id === 'training-dict' && isDictionaryIndex(DICTIONARIES.length)(Number(target.value))) { dictIndex = Number(target.value); settings.set('dict', dictIndex); }
  else if (target.id === 'record-dict') { const d = [...DICTIONARIES, ...PLACES.map((_, i) => journeyDictionary(i))].find(d => d.id === target.value); if (d) { recordDict = d; report = undefined; $('report').textContent = '記録を読み込み中…'; void showRecords(); } }
});
$('sound-volume').addEventListener('input', event => { audio.setVolume(Number((event.target as HTMLInputElement).value)); settings.set('volume', audio.volume); audio.ensure(); renderSound(); });

// Same composition/modifier/native-control boundaries as the established app.
window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const editable = target?.closest('input,select,textarea,[contenteditable]');
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
    if (editable) return;
    if (view === 'battle' && !round?.paused) $('ime-warning').hidden = false;
    event.preventDefault(); return;
  }
  if (dialogs.active) {
    if (event.key === 'Tab') { dialogs.cycle(event); return; }
    if (!dialogs.contains(event.target)) { event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) modal === 'settings-dialog' ? closeSettings() : perform('map'); return; }
    if (event.repeat) { event.preventDefault(); return; }
    return; // Focused native button/slider owns Space, Enter and arrows.
  }
  if (event.key === 'Tab') return;
  if (target?.closest('button,input,select,textarea,a,[contenteditable]')) {
    if (event.key === 'Escape' && view === 'battle') { event.preventDefault(); $('input-panel').focus({ preventScroll: true }); }
    return;
  }
  if (event.repeat) return;
  if (view === 'records') { if (/^[1-8]$/.test(event.key)) patch(Number(event.key) - 1); else if (event.key.toLowerCase() === 'h') perform('metric'); else if (event.key === 'Escape') perform('map'); return; }
  if (view === 'result') { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); perform('retry'); } else if (event.key === 'Escape') perform('map'); return; }
  if (view !== 'battle' || !round || round.paused || round.finished) return;
  if (event.key === 'Escape') { event.preventDefault(); pause(event.timeStamp); return; }
  if (event.key.length !== 1 || (event.key === ' ' && !round.session.expected.includes(' '))) return;
  event.preventDefault(); $('ime-warning').hidden = true; audio.ensure();
  const outcome = round.input(event.key, event.timeStamp, event.code);
  if (outcome.late) { end(); return; }
  if (outcome.accepted) {
    speed.accepted(event.timeStamp, !!round.log.at(-1)?.afterPause); score += 20 + Math.min(round.chain, 50);
    audio.key(round.stage, outcome.critical);
    if (outcome.wordDone) { score += 100; audio.word(round.stage); breakthrough(); }
    $('input-status').textContent = outcome.wordDone ? '封印を突破' : 'ローマ字を打つ';
  } else { audio.miss(); $('speech').textContent = CHARACTERS[run!.character].miss; $('input-status').textContent = 'もう一度 · Backspaceは不要'; }
  renderPanel(!outcome.accepted); renderMeters(event.timeStamp); if (round.finished) end();
});
window.addEventListener('blur', event => pause(event.timeStamp));
// Reflow can move the active long-text cursor outside its scroll window.
window.addEventListener('resize', () => renderPanel($('input-panel')?.classList.contains('miss')));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
let lastFrame = performance.now();
function frame(now: number) {
  if (view === 'battle' && round && !round.paused) {
    round.tick(now, Math.min(0.05, (now - lastFrame) / 1000));
    if (round.finished) end(); else renderMeters(now);
  }
  lastFrame = now; requestAnimationFrame(frame);
}
renderSound(); render(); updateNav(); requestAnimationFrame(frame);
