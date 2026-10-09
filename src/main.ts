import './style.css';
import './fx/combat.css';
import { Round, type RoundOptions } from './game/round';
import { DICTIONARIES, type Dictionary, type Word } from './content/words';
import { TypingSession, normalizeReading } from './engine/romaji';
import { Audio } from './fx/audio';
import { DialogFocus } from './ui/dialog';
import { renderReport } from './ui/report';
import { loadEvents, loadSessions, saveSession, type SessionMeta } from './stats/store';
import { analyze } from './stats/analyze';
import { loadBaselines, updateBaselines } from './stats/baselines';
import { PatchSource } from './stats/select';
import type { Report, StoredKey, Vuln } from './stats/types';
import { createSettingsStore, isBoolean, isDictionaryIndex, isEffectLevel, isNonNegativeNumber, isSpellingPreferences, isVolume } from './storage/settings';
import { CHARACTERS, PLACES, RecentSpeed, isCharacter, isPlaceIndex, journeyDictionary, journeySource } from './game/journey';
import { CombatScene, crossedMilestone } from './fx/combat';
import { chapterRank, comboTier, emptyScore, routeRank, routeStars, scoreInput } from './game/score';
import { Battle, isDifficulty, isCompatibleDifficulty, difficultyText, SERAPH_VERSION, type BattleEvent, type InputView } from './game/battle';
import { ChapterSource } from './game/chapter';
import { CHAPTER_ROUTE_WORDS, CHAPTER_VERSION, CHAPTER_WORD_LIMIT, SPEAKER_NAMES, chapterDictionary, getChapter, type ChapterDefinition, type Line } from './content/chapters';
import { chapterPrerequisite, canEnterPlace, emptyProgress, emptyRecord, isProgress, isRank, mergeProgress, migrateProgress, recordResult, ROUTE_VERSION } from './game/progress';
import { bossFields, bossPracticeDictionary, compareBossRecords, trainingBossSource, trainingFocus, type BossLesson } from './game/training';
import { dailyAt, dailySummary, readDaily, DAILY_PLACE, DAILY_DICT, type DailyChallenge } from './game/daily';
import { collectMemories, MEMORIES, MEMORY_VERSION, memoryBits, mergeMemories, type OwnedMemories } from './game/memories';
import { canPlaySeraph, isSeraphProgress, SERAPH_PROGRESS_KEY, SERAPH_ROUTE_VERSIONS } from './game/seraph';

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
let difficulty = settings.get('angel.difficulty', 'standard', isDifficulty);
let dictIndex = settings.get('dict', 0, isDictionaryIndex(DICTIONARIES.length));
const prefs = settings.get('prefs', {}, isSpellingPreferences);
const audio = new Audio(); audio.enabled = settings.get('sound', true, isBoolean); audio.setVolume(settings.get('volume', 1, isVolume));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const compactChapter = matchMedia('(max-width: 620px), (max-height: 650px)');
let motion = settings.get('effects.motion', reducedMotion.matches ? 0 : 1, isEffectLevel);
let lowGraphics = settings.get('graphics.low', false, isBoolean);
let view: 'characters' | 'journey' | 'training' | 'records' | 'memories' | 'lesson' | 'battle' | 'result' = 'characters';
let round: Round | null = null;
type Run = { dict: Dictionary; mode: NonNullable<RoundOptions['mode']>; place: number; character: typeof character; focus?: string; vulns?: Vuln[];
  difficulty?: typeof difficulty; bossOnly?: boolean; parentSession?: string; initialKanaPerSec?: number; seed?: number;
  study?: { lesson: BossLesson; trainingSession?: string; words?: number }; daily?: DailyChallenge };
let run: Run | null = null;
let endedRound: Round | null = null;
let scoring = emptyScore();
const routeVersions = Object.fromEntries(PLACES.map((p, i) => [p.key, getChapter(i) ? CHAPTER_VERSION : ROUTE_VERSION]));
let progress = migrateProgress(settings.get('angel.progress', emptyProgress(), isProgress), routeVersions);
let seraphProgress = migrateProgress(settings.get(SERAPH_PROGRESS_KEY, emptyProgress(), isSeraphProgress), SERAPH_ROUTE_VERSIONS);
let terminalEndedAt: number | null = null;
let finale: { round: Round; startedAt: number; duration: number } | null = null;
let resultReadyAt = 0;
let comboBrokenUntil = 0;
const speed = new RecentSpeed();
let read: AbortController | undefined;
let request = 0;
let report: { data: Report; dict: Dictionary } | undefined;
let recordDict = DICTIONARIES[dictIndex];
let reportMetric: 'latency' | 'miss' = 'latency';
let panelWord: Word | undefined;
let animations: Animation[] = [];
let modal: 'pause-dialog' | 'settings-dialog' | null = null;
let combat: CombatScene | null = null;
let chapter: { definition: ChapterDefinition; battle: Battle; phase: 'intro' | 'route' | 'boss-intro' | 'boss' | 'outro'; previousWordAt: number; bossLogStart: number; initialBossSpeed: number } | null = null;
let offeredLesson: BossLesson | null = null;
let lesson: BossLesson | null = null;
let conversation: { lines: Line[]; index: number; kind: 'intro' | 'boss-intro' | 'outro'; shownAt: number } | null = null;
let lastSession: string | undefined;
let dailyCardKey = '', dailyReadToken = 0;
let memoryCache: OwnedMemories = {};
const pendingMemorySessions = new Set<string>();
const setText = (id: string, value: string) => { const el = $(id); if (el.textContent !== value) el.textContent = value; };

function refreshProgress() {
  const latest = migrateProgress(settings.refresh('angel.progress', emptyProgress(), isProgress), routeVersions);
  progress = mergeProgress(progress, latest);
  seraphProgress = mergeProgress(seraphProgress, migrateProgress(settings.refresh(SERAPH_PROGRESS_KEY, emptyProgress(), isSeraphProgress), SERAPH_ROUTE_VERSIONS));
}
function currentRecord(key: string, level: typeof difficulty = 'standard') {
  const hard = level === 'seraph', p = (hard ? seraphProgress : progress).places[key];
  return p && p.routeVersion === (hard ? SERAPH_ROUTE_VERSIONS : routeVersions)[key] ? p.current : emptyRecord();
}
const placeOpen = (index: number) => canEnterPlace(PLACES[index].key, progress, routeVersions);
const journeyAllowed = (index: number, level: typeof difficulty) => placeOpen(index) && (level !== 'seraph' || canPlaySeraph(index, progress, routeVersions));
const unlockCondition = (index: number) => {
  const prerequisite = chapterPrerequisite(PLACES[index].key);
  const previous = PLACES.findIndex(p => p.key === prerequisite);
  return previous < 0 ? '' : `第${previous + 1}章の現在版クリアで解放`;
};
const nextSeraphAllowed = (spec: Run) => spec.place + 1 < PLACES.length && journeyAllowed(spec.place + 1, 'seraph');
const starsText = (stars: boolean[]) => stars.map(s => s ? '★' : '☆').join('');
const timeText = (ms: number) => {
  const centiseconds = Math.floor(ms / 10);
  return `${Math.floor(centiseconds / 6000)}:${(centiseconds % 6000 / 100).toFixed(2).padStart(5, '0')}`;
};

function motionEnabled() { return motion > 0 && !reducedMotion.matches && !lowGraphics; }
function applyEffects() {
  app.classList.toggle('no-motion', !motionEnabled());
  $('setting-motion').textContent = motion === 0 ? 'オフ' : motion === 0.5 ? '弱' : '標準';
  $('setting-graphics').textContent = lowGraphics ? '低負荷' : '標準';
  if (!motionEnabled()) { stopAnimations(); app.style.setProperty('--av-depth', '1'); }
  combat?.configure({ motion: motion > 0 && !reducedMotion.matches, low: lowGraphics, intensity: motion });
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
    button.disabled = view === 'battle' || (view === 'result' && performance.now() < resultReadyAt);
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  $<HTMLButtonElement>('open-settings').disabled = finale !== null || conversation !== null || (view === 'result' && performance.now() < resultReadyAt);
}
function changeView(next: typeof view) {
  if (next !== 'lesson') lesson = null;
  $('chapter-dialog')?.remove();
  read?.abort(); read = undefined; request++; report = undefined;
  showModal(null); stopAnimations(); combat = null; finale = null; chapter = null; conversation = null; app.style.setProperty('--av-depth', '1');
  view = next; updateNav(); render();
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (next !== 'battle') main.querySelector<HTMLElement>('h1,h2')?.focus({ preventScroll: true });
}
function render() {
  if (view === 'characters') {
    main.innerHTML = `<section class="av-page av-character-page"><div class="av-heading"><p class="av-eyebrow">空と祈り</p><h1 tabindex="-1">誰と旅に出る？</h1><p>言葉を唱えて、下界への道をひらこう。</p></div><div class="av-choice-grid">${Object.entries(CHARACTERS).map(([key, p]) => `<button type="button" class="av-choice" data-person="${key}" aria-pressed="${character === key}">${picture(`player-${key}`, p.name)}<div class="av-choice-copy"><strong>${p.name}</strong><p>${p.role}<br>「${p.quote}」</p></div></button>`).join('')}</div><div class="av-page-footer"><span>${CHARACTERS[character].name}を選択中</span>${action('この天使で旅に出る', 'map', 'primary')}</div></section>`;
  } else if (view === 'journey') {
    refreshProgress();
    if (!placeOpen(place)) place = 0;
    const p = PLACES[place];
    main.innerHTML = `<section class="av-page"><div class="av-heading"><p class="av-eyebrow">SEVEN PLACES</p><h1 tabindex="-1">旅の地図</h1><p>7つの章で、出会う相手に言葉を届けます。前の章をクリアして、次の場所へ進みましょう。</p>${action("旅の記憶を見る", "memories")}</div>${dailyCard()}<div class="av-map">${PLACES.map((p, i) => `<button type="button" class="av-choice" data-place="${i}" aria-pressed="${i === place}" ${placeOpen(i) ? '' : 'disabled aria-describedby="chapter-unlock-note"'}>${picture(p.art, p.name)}<div class="av-choice-copy"><small>STAGE ${String(i + 1).padStart(2, '0')}</small><strong>${p.name}</strong><span>${p.sub}</span><span class="av-place-record">${esc(placeRecordText(i))}</span></div></button>`).join('')}</div><div class="av-page-footer"><span>${CHARACTERS[character].name} · ${p.name}を選択中</span><label class="av-difficulty">章の難度 <select id="journey-difficulty"><option value="standard" ${difficulty === 'standard' ? 'selected' : ''}>標準</option><option value="challenge" ${difficulty === 'challenge' ? 'selected' : ''}>挑戦</option><option value="seraph" ${difficulty === 'seraph' ? 'selected' : ''}>熾天</option></select></label>${action('この場所へ', 'start-journey', 'primary')}</div><p id="difficulty-note" class="av-footnote" role="status"></p><p id="chapter-unlock-note" class="av-footnote">前の章の現在版をクリアすると、第2〜7章の鍵がひらきます。標準で一度クリアしたら挑戦がおすすめ。</p></section>`;
  } else if (view === 'training') {
    main.innerHTML = `<section class="av-page"><div class="av-heading"><p class="av-eyebrow">PRACTICE</p><h1 tabindex="-1">言葉を磨く</h1><p>旅のあいだに、打ちやすい指づかいを見つけよう。</p></div><div class="av-training-grid"><section class="av-card"><h2>60秒の計測</h2><p>日本語・英語の正確さと速度を記録。最初のキーで時計が動きます。</p><label>辞書 <select id="training-dict">${DICTIONARIES.map((d, i) => `<option value="${i}" ${i === dictIndex ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>${action('選んだ辞書で練習する', 'start-training', 'primary')}<p class="av-footnote">中断した計測と長文・弱点練習は自己ベストの対象外。</p></section><section class="av-card"><h2>ゆっくり長文</h2><p>読みとローマ字が入力位置を追いかけます。時間制限なし。途中終了も記録できます。</p>${action('長文を練習する', 'start-passage')}<hr><h2>自分の弱点を知る</h2><p>記録から遅い指の遷移やミスを確認し、弱点に合わせた練習へ。</p>${action('練習記録を見る', 'records')}</section></div><p class="av-help">shi / si・chi / tiなどの別綴りに対応。IMEはオフ。ミスはそのまま打ち直し、Backspaceは不要です。</p></section>`;
  } else if (view === 'lesson' && lesson) {
    const before = lesson.before, boss = getChapter(lesson.place)!;
    main.innerHTML = `<section class="av-page av-result" id="sera-lesson"><p class="av-eyebrow">セラの修行場</p><h1 tabindex="-1">次の祈りを、ここで整えましょう</h1><p class="av-help">セラ「${lesson.focus ? `『${esc(lesson.focus.label)}』の指づかいを確かめましょう。` : '今回は、同じ相手への祈りをゆっくり繰り返しましょう。'}」</p><section class="av-card"><h2>${esc(boss.bossName)}へ戻る修行</h2><p>${CHARACTERS[before.character!].name} · ${difficultyText(before.difficulty!)} · 戻ったらボス戦から始めます。</p><p>最初のキーから60秒。反撃はありません。Escから途中で終えて戻ることもできます。</p><p class="av-footnote">ボスの結果に合わせた祈りを練習し、戻ったあとはボス戦の正確率・弾き返し・ひびを比べます。このページを閉じると直接戻る道は終了します。</p></section><div class="av-page-footer">${action('修行を始める', 'study-start', 'primary')}${action('旅の地図', 'map')}</div></section>`;
  } else if (view === 'records') {
    main.innerHTML = `<section class="av-page av-records"><h1 tabindex="-1">練習の記録</h1><div class="av-record-controls"><label>見る辞書 <select id="record-dict">${[...DICTIONARIES, ...PLACES.map((_, i) => getChapter(i) ? chapterDictionary(i) : journeyDictionary(i))].map(d => `<option value="${d.id}" ${d.id === recordDict.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>${action('遅さ / ミス率を切り替える', 'metric')}${action('戻る', 'map')}</div><div id="report" class="rp" aria-busy="true"><p role="status">記録を読み込み中…</p></div></section>`;
    void showRecords();
  } else if (view === 'memories') {
    refreshProgress();
    main.innerHTML = `<section class="av-page av-memories"><p class="av-eyebrow">SEVEN PLACES · 21 MEMORIES</p><h1 tabindex="-1">旅の記憶</h1><p>各土地に三つ、全21の記憶。集めた記憶はいつでも読み返せます。休んでも失うものはありません。</p><p>現在は第1〜5章の15枠を集められます。日替わりの通し撃破も対象です。ボスだけの再挑戦・修行・道中練習では取得しません。</p><p id="memory-save-note" class="av-save" role="status"></p><div id="memory-report" aria-busy="true"><p role="status">記憶を読み込み中…</p></div><div class="av-page-footer">${action('旅の地図', 'map', 'primary')}</div></section>`;
    updateMemorySaveNote(); void showMemories();
  }
  applyEffects(); if (view === 'journey') { updateJourneyDifficulty(); syncDailyCard(true); }
}

function placeRecordText(index: number): string {
  const p = PLACES[index], record = currentRecord(p.key, difficulty), hard = difficulty === 'seraph';
  if (hard && !getChapter(index)) return '熾天は未実装 · 道中練習は標準／挑戦で';
  const locked = !journeyAllowed(index, difficulty);
  const recommended = PLACES.findIndex((_, i) => journeyAllowed(i, difficulty) && !currentRecord(PLACES[i].key, difficulty).cleared);
  return `${hard ? '熾天 · ' : ''}${locked ? hard ? '通常の章クリア待ち · ' : '鍵待ち · ' : ''}${record.cleared ? `クリア · ${starsText(record.stars)} · ${record.bestRank ?? '—'}` : !hard && progress.places[p.key]?.legacy?.cleared ? '旧道中クリア' : hard ? '未挑戦' : '未踏の道'}${index === recommended ? ' · おすすめ' : ''}`;
}
function updateJourneyDifficulty() {
  if (view !== 'journey') return;
  main.querySelectorAll<HTMLElement>('[data-place] .av-place-record').forEach(el => {
    const next = placeRecordText(Number(el.closest<HTMLElement>('[data-place]')!.dataset.place));
    if (el.textContent !== next) el.textContent = next;
  });
  main.querySelector<HTMLButtonElement>('[data-action=start-journey]')!.disabled = !journeyAllowed(place, difficulty);
  $('difficulty-note').textContent = difficulty !== 'seraph' ? '熾天は第1〜5章の、その章を標準／挑戦でクリアした後に遊べます。'
    : !getChapter(place) ? 'この土地の熾天は準備中です。標準／挑戦に切り替えると道中練習を遊べます。'
    : !canPlaySeraph(place, progress, routeVersions) ? 'この章の熾天は、標準または挑戦で現在の章をクリアすると遊べます。旧道中や熾天の成果では解放しません。'
    : '熾天：反撃の間隔が短く、後半の2語防御が増えます。ひびが三つで敗北。HP・ダメージ・採点は同じで、通常の成果・章の鍵・最高記録とは別に保存します。';
}

function updateMemorySaveNote() {
  const el = $('memory-save-note'); if (!el) return;
  el.textContent = pendingMemorySessions.size ? '取得判定を含む今回の記録に未保存分があります。一時保持分は再読み込みやページを閉じると失われます。次の保存時に再試行します。'
    : '取得の記録は、章の入力記録と一緒にこのブラウザに保存します。';
}
async function showMemories() {
  read?.abort(); const controller = new AbortController(); read = controller; const token = ++request;
  let partial = false, unreadable = 0;
  try {
    const collected = collectMemories(await loadSessions(undefined, () => { partial = true; }, controller.signal));
    if (controller.signal.aborted || token !== request || view !== 'memories') return;
    memoryCache = mergeMemories(memoryCache, collected.owned); unreadable = collected.unreadable;
  } catch { partial = true; }
  if (controller.signal.aborted || token !== request || view !== 'memories') return;
  if (read === controller) read = undefined;
  const report = $('memory-report');
  report.innerHTML = `<p id="memory-count" role="status">取得 ${Object.keys(memoryCache).length} / ${MEMORIES.length} · 準備中 ${MEMORIES.filter(m => !m.implemented).length}枠</p>${partial || unreadable ? '<p class="av-save" role="status">読み込めて判定できた記録と、このページで取得した記憶を表示しています。読み込めない・未対応の記録は変更せず保持しています。</p>' : ''}${PLACES.map((place, index) => `<section class="av-memory-place" aria-labelledby="memory-place-${index}"><h2 id="memory-place-${index}">${esc(place.name)} <small>第${index + 1}章</small></h2><div class="av-memory-grid">${MEMORIES.filter(m => m.place === index).map(slot => {
    const proof = memoryCache[slot.id], status = !slot.implemented ? '準備中' : proof ? '取得済み' : !placeOpen(index) ? '鍵待ち' : '未取得';
    const label = `<strong>${esc(slot.title)}</strong><span class="av-memory-status">${status}</span>`;
    const condition = `<p class="av-footnote">${esc(slot.condition)}${slot.implemented && !proof && !placeOpen(index) ? `。${unlockCondition(index)}` : ''}</p>`;
    return proof ? `<details class="av-card av-memory" data-memory="${slot.id}" data-status="${status}"><summary>${label}</summary><p class="av-memory-text">${esc(slot.text)}</p>${condition}<p class="av-footnote">取得記録 · ${esc(new Date(proof.endedAt).toLocaleString('ja-JP'))}</p></details>`
      : `<article class="av-card av-memory" data-memory="${slot.id}" data-status="${status}">${label}${condition}</article>`;
  }).join('')}</div></section>`).join('')}`;
  report.setAttribute('aria-busy', 'false'); updateMemorySaveNote();
}

function meter(kind: 'speed' | 'accuracy') {
  const isSpeed = kind === 'speed', label = isSpeed ? '速度' : '正確性', max = isSpeed ? 8 : 100;
  return `<div class="av-meter ${isSpeed ? '' : 'precision'}"><div class="av-meter-label">${label}</div><div class="av-gauge"><svg viewBox="0 0 126 126" role="meter" aria-label="${isSpeed ? '直近の正しい打鍵速度（目盛上限8打毎秒）' : '正確性'}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="0"><circle class="av-gauge-track" cx="63" cy="63" r="50" pathLength="100" transform="rotate(135 63 63)" stroke-dasharray="75 100"/><circle id="${kind}-arc" class="av-gauge-fill" cx="63" cy="63" r="50" pathLength="100" transform="rotate(135 63 63)" stroke-dasharray="0 100"/></svg><div class="av-meter-number"><strong id="${kind}-value">0</strong><small>${isSpeed ? '打／秒' : '%'}</small></div></div><div class="av-meter-caption">${isSpeed ? '直近12打鍵' : '言葉の精度'}</div></div>`;
}
function dailyCard(): string {
  return `<section class="av-card av-daily-card" aria-labelledby="daily-title"><p class="av-eyebrow">日替わりの固定出題</p><h2 id="daily-title">今日の祈り</h2><p id="daily-date" aria-live="polite"></p><p>第1章「出立の門」を、同じ日の祈りで最初から。何度挑んでも、休んでも大丈夫。</p><p id="daily-selected"></p><p id="daily-record" role="status"></p>${action('今日の祈りに挑む', 'start-daily', 'primary')}<p class="av-footnote">端末の時計とタイムゾーンで決まります。開始した祈りは日付が変わっても同じです。天使と難度は通常の旅と同じ選択を使います。</p></section>`;
}
function dailyRecordText(sessions: SessionMeta[], day: DailyChallenge, who: typeof character, level: typeof difficulty): string {
  const s = dailySummary(sessions, day, who, level);
  return `挑戦 ${s.attempts}回 · 撃破 ${s.clears}回${s.bestScore !== null ? ` · 最高 ${s.bestScore.toLocaleString('ja-JP')}点` : ''}${s.bestTimeMs !== null ? ` · 最短 ${timeText(s.bestTimeMs)}` : ''}`;
}
function syncDailyCard(force = false) {
  if (view !== 'journey' || !$('daily-record')) return;
  if (force) { refreshProgress(); updateJourneyDifficulty(); }
  const day = dailyAt(), key = `${day?.date}:${day?.zone}:${character}:${difficulty}`;
  if (!force && key === dailyCardKey) return;
  dailyCardKey = key; const token = ++dailyReadToken, who = character, level = difficulty;
  main.querySelector<HTMLButtonElement>('[data-action=start-daily]')!.disabled = !day || !journeyAllowed(DAILY_PLACE, level);
  setText('daily-date', day ? `${day.date} · ${day.zone}` : '端末の日付を確認できません。時計とタイムゾーンを確認してください。');
  setText('daily-selected', `${CHARACTERS[who].name} · ${difficultyText(level)}${level === 'seraph' && !journeyAllowed(DAILY_PLACE, level) ? ' · 通常の第1章クリア待ち' : ''}`);
  setText('daily-record', day ? '今日の記録を読み込み中…' : '');
  if (!day) return;
  let partial = false;
  void loadSessions(DAILY_DICT, () => { partial = true; }).then(sessions => {
    if (view !== 'journey' || token !== dailyReadToken || !$('daily-record')) return;
    setText('daily-record', `${dailyRecordText(sessions, day, who, level)}${partial ? ' · 読み込めた記録と一時保持分のみ' : ''}`);
  }).catch(() => { if (view === 'journey' && token === dailyReadToken) setText('daily-record', '今日の記録を確認できません。祈りは始められます。'); });
}
function start(spec: Run) {
  refreshProgress();
  if (spec.mode === 'journey' && !journeyAllowed(spec.place, spec.difficulty ?? difficulty)) { changeView('journey'); return; }
  combat = null; chapter = null; conversation = null; finale = null; terminalEndedAt = null; comboBrokenUntil = 0; offeredLesson = null;
  spec = { ...spec, ...(spec.mode === 'journey' && getChapter(spec.place) ? { dict: chapterDictionary(spec.place), difficulty: spec.difficulty ?? difficulty } : {}) };
  read?.abort(); request++; report = undefined; run = { ...spec }; endedRound = null;
  const opts: RoundOptions = { mode: spec.mode, baselines: loadBaselines(spec.dict), seed: spec.seed ?? Math.floor(Math.random() * 2 ** 32) };
  if (spec.mode === 'journey') {
    const definition = getChapter(spec.place), isChapter = definition !== null;
    opts.source = isChapter ? spec.study ? trainingBossSource(opts.seed!, spec.study.lesson.sourceBossOnly, spec.place) : new ChapterSource(opts.seed!, spec.bossOnly, spec.place) : journeySource(spec.dict);
    opts.wordLimit = isChapter ? CHAPTER_WORD_LIMIT : spec.dict.words.length;
    if (isChapter) chapter = { definition: definition!, battle: new Battle({ character: spec.character, difficulty: spec.difficulty!, bossHp: 240, seed: opts.seed!, initialKanaPerSec: spec.initialKanaPerSec }), phase: spec.bossOnly ? 'boss' : 'intro', previousWordAt: 0, bossLogStart: -1, initialBossSpeed: 2 };
  }
  if (spec.mode === 'patch') {
    try { opts.source = new PatchSource(spec.dict.words, spec.dict.id, spec.vulns ?? [], prefs, { seed: opts.seed!, focus: spec.focus }); }
    catch { changeView('training'); main.insertAdjacentHTML('beforeend', '<p class="av-help" role="status">この辞書は弱点練習の候補が不足しています。通常練習を利用してください。</p>'); return; }
  }
  round = new Round(spec.dict, prefs, opts); scoring = emptyScore(); speed.reset(); panelWord = undefined;
  refreshProgress();
  audio.reset(); audio.ensure(); stopAnimations(); app.style.setProperty('--av-depth', '1');
  view = 'battle'; updateNav(); showModal(null);
  const p = PLACES[spec.place], person = CHARACTERS[spec.character];
  main.innerHTML = `<section class="av-battle" aria-label="${p.name} タイピング"><div class="av-landscape" style="background-image:url('${art(p.art)}')" aria-hidden="true"></div><div class="av-hud"><div class="av-pilot"><div class="av-eyebrow">旅する天使</div><div class="av-pilot-name">${person.name}</div><div class="av-route-label">${spec.mode === 'journey' ? '道中の祈り' : esc(spec.dict.name)}</div></div><div class="av-stage"><div class="av-eyebrow">STAGE ${String(spec.place + 1).padStart(2, '0')} ／ ${p.sub}</div><div class="av-stage-name">${p.name}</div><div class="av-stage-progress" aria-label="旅の第${spec.place + 1}章">${PLACES.map((_, i) => `<i class="${currentRecord(PLACES[i].key, spec.difficulty).cleared ? 'active' : ''}"></i>`).join('')}</div></div><div class="av-score-box"><div class="av-eyebrow">SCORE</div><div class="av-score" id="score">0</div><div class="av-combo"><strong id="combo">0</strong> COMBO</div><div id="combo-status" class="av-combo-status" role="status"></div></div></div><div class="av-arena"><section class="av-quest"><div class="av-quest-top"><span>${spec.mode === 'journey' ? 'QUEST' : 'PRACTICE'}</span><span id="quest-count">0 / 5</span></div><div class="av-quest-title">${spec.mode === 'journey' ? '五つの封印を<br>解き放つ' : spec.mode === 'passage' ? '言葉を最後まで<br>届けよう' : spec.mode === 'patch' ? `指づかいを磨く<br>${esc(spec.focus ?? '')}` : '自分の速さを<br>見つけよう'}</div><div class="av-quest-track" id="quest-track" role="progressbar" aria-label="練習の進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="quest-progress"></i></div><div class="av-quest-note" id="quest-note">${spec.mode === 'journey' ? `目的：${p.sub}への道をひらく` : spec.mode === 'passage' ? '時間制限なし' : '最初のキーから60秒'}</div></section><div class="av-obstacle-area" aria-hidden="true"><div class="av-obstacle" id="seal"><span id="seal-label">${p.landmark}</span></div><div class="av-spell" id="spell"></div><div class="av-obstacle-note" id="seal-note">一語の祈りで、道をひらく</div></div><aside class="av-speaker" aria-label="${person.name}の台詞"><div class="av-speech"><div class="av-speaker-name">${person.name}</div><div class="av-speech-text" id="speech">${spec.mode === 'journey' ? p.intro ?? person.opening : person.opening}</div></div><div class="av-portrait">${picture(`player-${spec.character}`, person.name)}</div></aside></div><div class="av-combat-dock">${meter('speed')}<section class="av-main-panel" id="input-panel" tabindex="-1" aria-label="タイピング入力"><div class="av-input-top"><span id="input-label">言葉を唱える</span>${action('一時停止', 'pause')}</div><div class="av-current-word" id="word"></div><div class="av-reading" id="reading"></div><div class="av-romaji" id="romaji"></div><div class="av-input-status" id="input-status" role="status">最初のキーでスタート · ミスは打ち直し</div><div class="av-next"><span>次の言葉</span><div><strong id="next-word"></strong><span class="av-guide" id="next-guide"></span></div></div></section><div class="av-right-side">${meter('accuracy')}<div class="av-later"><span>その次の言葉</span><strong id="following-word"></strong><span class="av-guide" id="following-guide"></span></div></div></div><div class="av-bottom"><div class="av-shortcuts">Esc 一時停止 ／ IME OFF<br><span id="clock">最初のキーでスタート</span></div><span class="av-footnote">かなの確定と、正確な祈りでスコアを積み重ねよう。</span></div><div id="ime-warning" class="av-ime" role="status" hidden>IMEをオフにしてください（英数入力）</div><div id="achievement" class="av-achievement" role="status" hidden><small>この挑戦の実績</small><strong>${p.sub}への道をひらいた</strong></div></section>`;
  if (chapter) {
    main.querySelector('.av-pilot')!.insertAdjacentHTML('beforeend', '<div class="av-barrier" id="barrier" role="status">結界 · ひび 0 / 3</div><div id="ring-streak" class="av-ring-streak"></div>');
    main.querySelector('.av-stage')!.insertAdjacentHTML('beforeend', `<div class="av-boss-hud" id="boss-hud" hidden><div>${esc(chapter.definition.bossName)} <span id="boss-hp-value">240 / 240</span></div><div class="av-boss-track" id="boss-hp" role="progressbar" aria-label="${esc(chapter.definition.bossName)}のHP" aria-valuemin="0" aria-valuemax="240" aria-valuenow="240"><i id="boss-hp-fill"></i></div></div><small>${difficultyText(spec.difficulty!)}</small>`);
    main.querySelector('.av-quest-title')!.textContent = chapter.definition.quest;
    $('quest-note').insertAdjacentHTML('afterend', '<div id="defense-note" class="av-defense-note"></div><div id="battle-feedback" class="av-battle-feedback" role="status"></div>');
    $('input-panel').querySelector('.av-input-top')!.insertAdjacentHTML('afterend', '<div id="compact-battle-info" class="av-compact-battle-info" aria-label="戦闘の状況" hidden><div class="av-compact-vitals"><span id="compact-hp"></span><span id="compact-barrier"></span></div></div>');
    $('input-panel').insertAdjacentHTML('beforeend', '<div id="chapter-queue" class="av-chapter-queue" hidden></div>');
    const later = main.querySelector<HTMLElement>('.av-later')!, copy = document.createElement('div');
    copy.append(later.querySelector('strong')!, later.querySelector('.av-guide')!); later.append(copy);
    for (const host of [$('input-panel'), main.querySelector<HTMLElement>('.av-next')!, main.querySelector<HTMLElement>('.av-later')!]) {
      host.insertAdjacentHTML('beforeend', '<span class="av-defense-tag" aria-hidden="true">防御</span><svg class="av-defense-arc" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" pathLength="100" transform="rotate(-90 16 16)"/></svg>');
    }
    layoutChapter();
  }
  if (spec.daily) main.querySelector('.av-stage')!.insertAdjacentHTML('beforeend', `<small id="daily-run-date">今日の祈り · ${spec.daily.date}</small>`);
  if (spec.mode === 'patch' && spec.study) {
    main.querySelector('.av-battle')!.classList.add('av-study-practice');
    main.querySelector('.av-stage-name')!.textContent = 'セラの修行場';
    main.querySelector('.av-stage .av-eyebrow')!.textContent = `戻る相手 · ${getChapter(spec.place)!.bossName}`;
    main.querySelector('.av-route-label')!.textContent = spec.focus ? `確かめる指づかい · ${spec.focus}` : 'ボスの祈りを反復';
    main.querySelector('.av-speaker-name')!.textContent = 'セラ'; main.querySelector('.av-speaker')!.setAttribute('aria-label', 'セラの台詞');
    main.querySelector<HTMLElement>('.av-portrait')!.hidden = true;
    $('speech').textContent = 'ゆっくりで大丈夫です。一語ずつ唱えましょう。';
    $('input-panel').insertAdjacentHTML('beforeend', '<div id="study-queue" class="av-chapter-queue" hidden></div>');
    layoutChapter();
  }
  applyEffects(); renderPanel(); renderMeters(performance.now()); $('input-panel').focus({ preventScroll: true });
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (chapter) {
    if (spec.bossOnly) enterBoss();
    else { round.pause(performance.now()); showConversation('intro', chapter.definition.intro(spec.character, !settings.get('angel.tutorial.seen', false, isBoolean))); }
  }
  else focusChapterInput();
}
function showConversation(kind: NonNullable<typeof conversation>['kind'], lines: Line[]) {
  conversation = { kind, lines, index: 0, shownAt: performance.now() };
  root.insertAdjacentHTML('beforeend', '<section id="chapter-dialog" class="av-chapter-dialog" role="dialog" aria-modal="true" aria-labelledby="chapter-speaker" aria-describedby="chapter-line" tabindex="-1"><div class="av-conversation-card"><p class="av-eyebrow" id="chapter-context"></p><h2 id="chapter-speaker"></h2><p id="chapter-line"></p><div class="av-conversation-footer"><span id="chapter-dialog-help"></span><button type="button" class="av-action primary" data-action="dialog-next">次へ</button></div></div></section>');
  paintConversation(); updateNav(); dialogs.show($('chapter-dialog'), document.activeElement);
  $('chapter-dialog').focus({ preventScroll: true });
}
function paintConversation() {
  if (!conversation) return;
  const line = conversation.lines[conversation.index];
  $('chapter-context').textContent = conversation.kind === 'intro' ? `第${run!.place + 1}章 · ${chapter!.definition.title}` : conversation.kind === 'boss-intro' ? chapter!.definition.bossName : `${chapter!.definition.title} · 後日談`;
  $('chapter-speaker').textContent = SPEAKER_NAMES[line.speaker];
  $('chapter-line').textContent = line.text;
  $('chapter-dialog-help').textContent = conversation.kind === 'boss-intro' ? '自動で進みます · キーでスキップ' : `Space / Enterで次へ${conversation.kind === 'intro' ? ' · Escでスキップ' : ''} · ${conversation.index + 1} / ${conversation.lines.length}`;
  $('chapter-dialog').querySelector<HTMLButtonElement>('button')!.textContent = conversation.kind === 'outro' && conversation.index === conversation.lines.length - 1 ? (run!.place === PLACES.length - 1 || (run!.difficulty === 'seraph' && !nextSeraphAllowed(run!))) ? '旅の地図へ' : '次の場所へ' : '次へ';
}
function advanceConversation(skip = false) {
  if (!conversation || !chapter) return;
  if (!skip && ++conversation.index < conversation.lines.length) {
    conversation.shownAt = performance.now(); paintConversation(); return;
  }
  const kind = conversation.kind;
  conversation = null; dialogs.show(null, null); $('chapter-dialog').remove(); updateNav();
  if (kind === 'intro') {
    settings.set('angel.tutorial.seen', true); chapter.phase = 'route'; round!.resume(performance.now());
    focusChapterInput();
  } else if (kind === 'boss-intro') enterBoss();
  else perform('next-place');
}
function focusChapterInput() {
  const panel = $('input-panel'); panel.focus({ preventScroll: true });
  panel.scrollIntoView({ block: compactChapter.matches ? 'center' : 'nearest', behavior: 'instant' });
}
function layoutChapter() {
  const study = run?.mode === 'patch' && run.study;
  if ((!chapter && !study) || view !== 'battle') return;
  const compact = compactChapter.matches, panel = $('input-panel'), queue = $(chapter ? 'chapter-queue' : 'study-queue');
  const next = main.querySelector<HTMLElement>('.av-next')!, later = main.querySelector<HTMLElement>('.av-later')!;
  const info = $('compact-battle-info');
  main.querySelector('.av-battle')!.classList.toggle('av-compact-chapter', compact);
  if (compact) { queue.append(next, later); if (info) info.append($('defense-note'), $('battle-feedback')); }
  else { panel.insertBefore(next, queue); main.querySelector('.av-right-side')!.append(later); if (chapter) main.querySelector('.av-quest')!.append($('defense-note'), $('battle-feedback')); }
  queue.hidden = !compact; if (info) info.hidden = !compact || chapter!.phase !== 'boss';
}
function enterBoss() {
  if (!chapter || !round) return;
  round.resume(performance.now()); chapter.phase = 'boss'; chapter.battle.startBoss(round.elapsedMs(performance.now()));
  chapter.bossLogStart = round.log.length; chapter.initialBossSpeed = chapter.battle.snapshot().kanaPerSec;
  const host = main.querySelector<HTMLElement>('.av-obstacle-area')!;
  host.classList.add('av-machine-arena'); host.removeAttribute('aria-hidden');
  const firstChapter = chapter.definition.key === 'heaven';
  main.querySelector('.av-battle')!.classList.toggle('av-first-chapter', firstChapter);
  host.insertAdjacentHTML('afterbegin', `<div class="av-combat-scene" role="img" aria-label="${esc(chapter.definition.bossName)}。${firstChapter ? '祈りは守護機へ、反撃はあなたの結界へ' : '光の輪から反撃する'}"></div>`);
  $('seal-note').setAttribute('aria-live', 'off');
  combat = new CombatScene(host.querySelector('.av-combat-scene')!, $('seal-note'), kind => audio.combatCue(kind), `${chapter.definition.bossName} · 言葉で光の術を放つ`, firstChapter);
  $('boss-hud').hidden = false; main.querySelector('.av-quest-title')!.textContent = chapter.definition.bossQuest;
  main.querySelector('.av-route-label')!.textContent = `${chapter.definition.title} · ボス戦`; $('speech').textContent = chapter.definition.opening(run!.character);
  $('quest-note').textContent = '金の枠の言葉を期限までに完成させる';
  layoutChapter();
  applyEffects(); renderBattle(performance.now()); renderMeters(performance.now()); focusChapterInput();
}
function inputView(): InputView {
  const r = round!, kana = normalizeReading(r.word.reading).length;
  return { current: { index: r.wordsDone, kana }, remainingKana: kana - r.session.kanaDone,
    previews: [{ index: r.wordsDone + 1, kana: normalizeReading(r.nextWord.reading).length },
      { index: r.wordsDone + 2, kana: normalizeReading(r.followingWord.reading).length }] };
}
function battleEvents(events: BattleEvent[], now: number) {
  if (!chapter || !round) return;
  combat?.feedback(events, round.elapsedMs(now));
  const firstChapter = chapter.definition.key === 'heaven';
  for (const e of events) {
    if (e.type === 'windup') { audio.battleCue('windup'); $('battle-feedback').textContent = e.marked.length === 2 ? '二語防御 · 金の枠を二つ唱える' : '予兆 · 金の枠の言葉で防御'; }
    else if (e.type === 'parry') { scoring.score += 200; audio.battleCue('parry'); $('battle-feedback').textContent = firstChapter ? '防御成功 · 弾き返し！' : '弾き返し！'; }
    else if (e.type === 'crack') { audio.battleCue('crack'); $('battle-feedback').textContent = firstChapter ? '被弾 · 結界にひび' : '結界にひび · 次の祈りを続けよう'; }
    else if (e.type === 'damage' && e.special) {
      scoring.score += 100; audio.battleCue('special');
      setText('battle-feedback', `${events.some(event => event.type === 'parry') ? firstChapter ? '防御成功 · 弾き返し／' : '弾き返し · ' : firstChapter ? '攻撃命中 · ' : ''}${e.special === 'judgment' ? '裁きの一撃' : '光輪連撃'}！`);
    }
    else if (e.type === 'damage' && firstChapter && !events.some(event => event.type === 'parry')) setText('battle-feedback', '攻撃命中 · 守護機へ祈りが届いた');
    else if (e.type === 'restore') $('battle-feedback').textContent = '光輪連撃 · 結界をひとつ回復';
    else if (e.type === 'prayer-reset') $('battle-feedback').textContent = '祈り直し · 結界が回復。祈りを続けよう';
    else if (e.type === 'phase2') $('speech').textContent = chapter.definition.phase2Line;
    else if (e.type === 'victory') { scoring.score += 1000; audio.battleCue('victory'); round.finish(now); }
    else if (e.type === 'defeat') round.finish(now);
  }
}
function renderBattle(now: number) {
  if (!chapter || !round || chapter.phase !== 'boss') return;
  const snapshot = chapter.battle.snapshot(), gameMs = round.elapsedMs(now);
  combat?.render(snapshot, gameMs);
  const hp = `${Math.ceil(snapshot.hp)} / ${snapshot.bossHp}`;
  setText('boss-hp-value', hp); setText('compact-hp', `${chapter.definition.bossName} HP ${hp}`);
  if ($('boss-hp').getAttribute('aria-valuenow') !== String(snapshot.hp)) $('boss-hp').setAttribute('aria-valuenow', String(snapshot.hp));
  const width = `${snapshot.hp / snapshot.bossHp * 100}%`;
  if ($('boss-hp-fill').style.width !== width) $('boss-hp-fill').style.width = width;
  const barrier = `結界 · ひび ${snapshot.cracks} / 3 ${'◇'.repeat(3 - snapshot.cracks)}${'◆'.repeat(snapshot.cracks)}`;
  setText('barrier', barrier); setText('compact-barrier', `ひび ${snapshot.cracks} / 3`);
  setText('ring-streak', run?.character === 'towa' ? `光輪連撃 ${'●'.repeat(snapshot.ringStreak)}${'○'.repeat(3 - snapshot.ringStreak)}` : '裁きの一撃 · ミスなしの祈り');
  const attack = snapshot.attack, marked = attack?.marked.filter(i => !attack.completed.includes(i)) ?? [];
  const remaining = attack ? Math.max(0, (attack.dueAt - gameMs) / (attack.dueAt - attack.startedAt)) : 0;
  [$('input-panel'), main.querySelector<HTMLElement>('.av-next')!, main.querySelector<HTMLElement>('.av-later')!].forEach((host, i) => {
    const active = marked.includes(round!.wordsDone + i);
    host.classList.toggle('av-defense-word', active);
    host.querySelector(':scope > .av-defense-arc circle')!.setAttribute('stroke-dasharray', `${remaining * 100} 100`);
  });
  setText('defense-note', attack ? `防御まで ${Math.max(0, (attack.dueAt - gameMs) / 1000).toFixed(1)}秒 · 残り${marked.length}語` : '次の予兆に備えよう');
}
function follow(container: HTMLElement, marker: HTMLElement | null) {
  if (!marker) return;
  const top = marker.offsetTop, bottom = top + marker.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}
function renderPanel(miss = false) {
  if (!round || !run || view !== 'battle' || finale) return;
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
  $('input-label').textContent = long ? '長文 · 句読点は , と .' : run.mode === 'patch' ? `${run.study ? 'セラの修行場' : '弱点練習'} · ${run.focus ?? '祈りの反復'}` : chapter && run.difficulty === 'seraph' ? '熾天 · 言葉を唱える' : '言葉を唱える';
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
  $('combo').textContent = String(round.chain); $('score').textContent = scoring.score.toLocaleString('ja-JP');
  const tier = comboTier(round.chain);
  $('input-panel').dataset.comboTier = String(tier);
  combat?.setComboTier(tier);
  $('combo-status').textContent = now < comboBrokenUntil ? 'コンボ途切れ' : tier > 0 ? `コンボ段階 ${tier}` : '';
  const elapsed = round.elapsedMs(now), untimed = run.mode === 'journey' || run.mode === 'passage';
  $('clock').textContent = !round.started ? '最初のキーでスタート' : untimed ? `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')} · 時間制限なし` : `残り ${Math.ceil(round.remainingMs(now) / 1000)} 秒`;
  const fraction = chapter ? chapter.phase === 'boss' ? 1 - chapter.battle.snapshot().hp / 240 : Math.min(1, round.wordsDone / CHAPTER_ROUTE_WORDS) : run.mode === 'journey' ? round.wordsDone / round.wordLimit : run.mode === 'passage' ? round.session.kanaDone / normalizeReading(round.word.reading).length : elapsed / 60000;
  $('quest-track').setAttribute('aria-valuenow', String(Math.min(100, fraction * 100))); $('quest-progress').style.width = `${Math.min(100, fraction * 100)}%`;
  $('quest-count').textContent = chapter ? chapter.phase === 'boss' ? `祈り ${round.wordsDone - (run.bossOnly ? 0 : 8)} 語` : `${Math.min(8, round.wordsDone)} / 8` : run.mode === 'journey' ? `${round.wordsDone} / ${round.wordLimit}` : `${round.wordsDone} 語`;
}
function breakthrough() {
  if (!round || !run || chapter?.phase === 'boss') return;
  const completed = run.mode === 'journey' && round.wordsDone === round.wordLimit;
  $('speech').textContent = run.study ? '一語ずつ、落ち着いて。戻る相手を思いながら唱えましょう。' : completed ? PLACES[run.place].outro ?? CHARACTERS[run.character].clear
    : run.mode === 'journey' && round.wordsDone === Math.ceil(round.wordLimit / 2) ? '半分まで届いた。次の言葉も、丁寧に。'
    : round.wordsDone === 1 ? CHARACTERS[run.character].clear : $('speech').textContent;
  if (run.mode === 'journey' && round.wordsDone === round.wordLimit) $('achievement').hidden = false;
  if (combat) { combat.hit('word'); return; }
  $('seal-note').textContent = `封印を突破 · ${round.wordsDone} 語`;
  if (!motionEnabled()) return;
  stopAnimations();
  animations = [
    $('seal').animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.55)', opacity: 0, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 540, easing: 'ease-out' }),
    $('spell').animate([{ transform: 'translateY(90px)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'translateY(-60px)', opacity: 0 }], { duration: 380, easing: 'ease-out' }),
  ];
  app.style.setProperty('--av-depth', String(1 + Math.min(round.wordsDone * 0.015 * motion, 0.12)));
}
function pause(now = performance.now()) {
  if (conversation) return;
  if (view !== 'battle' || !round || round.finished) return;
  round.pause(now); if (round.finished) { end(); return; }
  speed.reset(); for (const animation of animations) animation.pause();
  // Freeze the CSS background transition along with the input and clock.
  const landscape = main.querySelector<HTMLElement>('.av-landscape');
  if (landscape) { landscape.style.transform = getComputedStyle(landscape).transform; landscape.style.transition = 'none'; }
  $('pause-finish').hidden = (!round.started && !run?.study) || (round.mode !== 'journey' && round.mode !== 'passage' && !run?.study);
  $('pause-note').textContent = '時計と入力を停止しています。Escでも再開できます。再開後の最初の打鍵は速度の分析から除外します。やり直し・地図へ戻ると未保存の入力は残りません。';
  $('ime-warning').hidden = true; showModal('pause-dialog');
}
function resume() {
  if (!round || view !== 'battle') return;
  round.resume(performance.now()); speed.reset(); audio.ensure(); showModal(null);
  for (const animation of animations) animation.play();
  const landscape = main.querySelector<HTMLElement>('.av-landscape');
  if (landscape) { landscape.style.transform = ''; landscape.style.transition = ''; }
  focusChapterInput();
}
function captureEnd() { terminalEndedAt ??= Date.now(); }
function beginFinale() {
  if (!round || finale || !round.finished) return;
  captureEnd();
  finale = { round, startedAt: performance.now(), duration: motionEnabled() ? chapter ? 900 : 600 : 300 };
  stopAnimations(); updateNav();
  const battle = main.querySelector<HTMLElement>('.av-battle')!;
  battle.classList.add('av-finale'); battle.dataset.finale = motionEnabled() ? 'animated' : 'static';
  $('ime-warning').hidden = true;
  // The result carries the achievement; keep the final hit itself unobstructed.
  $('achievement').hidden = true;
  $('input-status').textContent = '祈りが届いた · Esc / クリックで結果へ';
  $('seal-note').textContent = '決着 · 最後の祈りが届いた';
  $('input-panel').querySelector<HTMLButtonElement>('[data-action=pause]')!.disabled = true;
  if (motionEnabled()) {
    if (!combat) animations.push($('seal').animate([
      { transform: 'scale(1)', opacity: 1, offset: 0 }, { transform: 'scale(1)', opacity: 1, offset: .133 },
      { transform: 'scale(1.7) rotate(25deg)', opacity: 0 },
    ], { duration: 600, easing: 'ease-out', fill: 'forwards' }));
    animations.push(battle.animate([{ filter: 'brightness(1)', offset: 0 }, { filter: 'brightness(1)', offset: 80 / finale.duration },
      { filter: 'brightness(1.8)', offset: .22 }, { filter: 'brightness(1)' }], { duration: finale.duration }));
  }
  combat?.finale(0);
}
function end() {
  if (!round || !run || endedRound === round) return;
  captureEnd();
  endedRound = round; const finished = round, spec = run, result = round.result(), elapsedMs = round.elapsedMs(performance.now());
  finale = null; resultReadyAt = performance.now() + 500;
  showModal(null); stopAnimations(); combat = null; view = 'result'; updateNav();
  const battleResult = chapter?.battle.snapshot();
  const fullJourney = spec.mode === 'journey' && (battleResult ? battleResult.outcome === 'cleared' : round.wordsDone === round.wordLimit);
  const rank = battleResult ? chapterRank(fullJourney, result.accuracy, battleResult.stats.parries, battleResult.stats.resolved, battleResult.stats.resets)
    : spec.mode === 'journey' ? routeRank(fullJourney, result.accuracy, scoring.cleanWords, round.wordsDone) : null;
  const stars: [boolean, boolean, boolean] = battleResult ? [fullJourney, fullJourney && result.accuracy >= .95, fullJourney && battleResult.stats.resolved >= 1 && battleResult.stats.cracks === 0]
    : routeStars(fullJourney, result.accuracy, scoring.cleanWords, round.wordsDone);
  const scope: NonNullable<SessionMeta['scope']> = chapter ? spec.bossOnly ? 'boss' : 'chapter' : 'route';
  const outcome: NonNullable<SessionMeta['outcome']> = battleResult?.outcome ?? (fullJourney ? 'cleared' : 'quit');
  const endReason: NonNullable<SessionMeta['endReason']> = outcome === 'lost' ? 'defeat' : outcome === 'cleared' ? 'finish' : battleResult && round.wordsDone >= round.wordLimit ? 'word-limit' : 'user';
  let progressStatus = '', personalBest = '';
  if (fullJourney) {
    // A localStorage failure must never prevent the independent IndexedDB write.
    try {
      refreshProgress();
      const hard = spec.difficulty === 'seraph', versions = hard ? SERAPH_ROUTE_VERSIONS : routeVersions;
      const previous = currentRecord(PLACES[spec.place].key, spec.difficulty);
      personalBest = scope === 'boss' ? 'ボス再挑戦の成果 · 最高スコアと時間は章を通した記録で比べます。' : `${scoring.score > previous.bestScore ? '最高スコア更新' : `最高スコア ${previous.bestScore.toLocaleString('ja-JP')}`} · ${previous.bestTimeMs === null || elapsedMs < previous.bestTimeMs ? '自己ベスト時間更新' : `自己ベスト ${timeText(previous.bestTimeMs)}`}`;
      const updated = recordResult(hard ? seraphProgress : progress, { key: PLACES[spec.place].key, routeVersion: versions[PLACES[spec.place].key],
        completed: true, score: scoring.score, rank, elapsedMs, stars, scope });
      if (hard) seraphProgress = updated; else progress = updated;
      personalBest = `${hard ? '熾天 · ' : ''}${personalBest}`;
      progressStatus = settings.set(hard ? SERAPH_PROGRESS_KEY : 'angel.progress', updated) === 'persistent'
        ? `${hard ? '熾天の' : '旅の'}成果をこのブラウザに保存しました。` : `${hard ? '熾天の' : '旅の'}成果はこのページでのみ保持`;
    } catch { progressStatus = `${spec.difficulty === 'seraph' ? '熾天の' : '旅の'}成果はこのページでのみ保持`; }
  }
  const mode = spec.mode === 'journey' ? fullJourney ? 'journey' : 'practice' : spec.mode === 'patch' ? 'patch' : spec.mode === 'passage' || round.interrupted ? 'practice' : 'benchmark';
  const bestKey = `pb.${spec.dict.id}`, best = settings.get(bestKey, 0, isNonNegativeNumber);
  if (mode === 'benchmark' && result.kanaPerSec > best) settings.set(bestKey, result.kanaPerSec);
  settings.set('prefs', prefs); updateBaselines(spec.dict, round.log);
  const session = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const events: StoredKey[] = round.log.map(e => ({ ...e, session, dict: spec.dict.id, mode }));
  lastSession = session;
  const meta: SessionMeta = { session, dict: spec.dict.id, mode, kanaPerSec: result.kanaPerSec, accuracy: result.accuracy,
    endedAt: terminalEndedAt!, character: spec.character, score: scoring.score, rank, elapsedMs, seed: round.seed,
    ...(spec.mode === 'journey' ? { routeVersion: routeVersions[PLACES[spec.place].key], scope,
      outcome, endReason, ...(chapter ? { difficulty: spec.difficulty, parentSession: spec.parentSession,
        ...(spec.difficulty === 'seraph' ? { seraphVersion: SERAPH_VERSION } : {}) } : {}) } : {}),
    ...(battleResult && chapter!.bossLogStart >= 0 ? bossFields(events.slice(chapter!.bossLogStart), battleResult) : {}),
    ...(spec.daily ? { dailyDate: spec.daily.date, dailyZone: spec.daily.zone, dailyVersion: spec.daily.version } : {}),
    ...(spec.study ? spec.mode === 'patch' ? { trainingForSession: spec.study.lesson.before.session, trainingWords: round.wordsDone }
      : { trainingSession: spec.study.trainingSession, trainingWords: spec.study.words } : {}) };
  const earnedBits = memoryBits(meta), previouslyKnown = memoryCache;
  if (earnedBits) {
    meta.memoryVersion = MEMORY_VERSION; meta.memoryBits = earnedBits;
    memoryCache = mergeMemories(memoryCache, collectMemories([meta]).owned);
    pendingMemorySessions.add(session);
  }
  if (spec.mode === 'patch' && spec.study) spec.study = { ...spec.study, trainingSession: session, words: round.wordsDone };
  offeredLesson = battleResult && chapter!.bossLogStart >= 0 ? { before: meta, place: spec.place, initialKanaPerSec: chapter!.initialBossSpeed,
    sourceBossOnly: spec.study?.lesson.sourceBossOnly ?? !!spec.bossOnly, events: events.slice(chapter!.bossLogStart) } : null;
  const label = battleResult ? outcome === 'cleared' ? chapter!.definition.clearLabel : outcome === 'lost' ? '結界が砕けた · 敗北' : endReason === 'word-limit' ? '祈りの上限に到達 · 途中記録' : '章の途中記録' : fullJourney ? '五つの封印を突破' : spec.mode === 'journey' ? '道中の途中記録' : spec.mode === 'passage' ? round.session.complete ? '長文を完了' : '長文の途中記録' : spec.mode === 'patch' ? spec.study ? 'セラの修行の記録' : '弱点練習の記録' : '60秒の記録';
  const feedback = result.slowBigram ? `「${result.slowBigram.pair}」の遷移が中央値より${Math.round(result.slowBigram.excessMs)}ms長め（${result.slowBigram.count}回）。` : result.missedKey ? `「${result.missedKey.key}」で${result.missedKey.count}回打ち直しました。` : '言葉をひとつずつ、正確に届けよう。';
  main.innerHTML = `<section class="av-page av-result"><p class="av-eyebrow">${esc(spec.dict.name)} ／ ${CHARACTERS[spec.character].name}${battleResult ? ` ／ ${difficultyText(spec.difficulty!)}${spec.bossOnly ? ' · ボス再挑戦' : ''}` : ''}</p><h1 tabindex="-1">${label}</h1><p>${battleResult && fullJourney ? esc(chapter!.definition.victory) : fullJourney ? PLACES[spec.place].outro ?? CHARACTERS[spec.character].clear : 'おつかれさま。自分のペースで、また続けよう。'}</p>${fullJourney ? `<p class="av-earned">${starsText(stars)} · ${spec.difficulty === "seraph" ? "熾天の成果" : `${PLACES[spec.place].sub}への道をひらいた`}</p>` : ''}${spec.daily ? `<p class="av-earned" id="daily-result-date">今日の祈り · ${spec.daily.date} · ${esc(spec.daily.zone)}</p><p id="daily-result-record" role="status">今日の記録を保存中…</p><p class="av-footnote">同じ日・天使・難度の章を通した結果で比べます。ボスだけの再挑戦とセラの修行は今日の記録に含めません。</p>` : ""}<div class="av-result-grid"><div><span>スコア</span><strong id="result-score">${scoring.score.toLocaleString('ja-JP')}</strong><small>正確な祈りの積み重ね</small></div>${spec.mode === 'journey' ? `<div><span>ランク</span><strong id="result-rank">${rank ?? '—'}</strong><small>${fullJourney ? `ミスなし ${scoring.cleanWords} / ${round.wordsDone} 語` : '途中記録 · ランクなし'}</small></div>` : ''}<div><span>所要時間</span><strong id="result-time">${timeText(elapsedMs)}</strong><small>入力中の時間</small></div><div><span>速度</span><strong>${result.kanaPerSec.toFixed(2)}<small>字／秒</small></strong><small>${Math.round(result.keysPerMin)} 打鍵／分（参考）</small></div><div><span>正確率</span><strong>${(result.accuracy * 100).toFixed(1)}<small>%</small></strong><small>ミス ${result.misses}</small></div><div><span>最大コンボ</span><strong>${result.maxChain}</strong><small>完了 ${round.wordsDone} 語</small></div></div>${battleResult ? `<div class="av-battle-results"><span>弾き返し <b id="result-parries">${battleResult.stats.parries} / ${battleResult.stats.resolved}</b></span><span>大技 <b id="result-specials">${battleResult.stats.specials}</b></span><span>祈り直し <b id="result-resets">${battleResult.stats.resets}</b></span><span>ひび <b>${battleResult.stats.cracks}回</b></span></div>` : ''}${battleResult && spec.study?.trainingSession ? renderBossComparison(spec.study.lesson.before, meta) : ""}${spec.mode === "patch" && spec.study ? `<p class="av-help">セラ「${round.wordsDone ? "唱えた祈りを、元の相手へ届けてみましょう。" : "今回は一語も完了していません。戻ってからの記録は参考として見てください。"}」</p>` : ""}<p class="av-help">${esc(feedback)}</p><p class="av-footnote">${mode === 'benchmark' ? result.kanaPerSec > best ? '自己ベスト更新' : `自己ベスト ${best.toFixed(2)} 字／秒` : '練習記録です。60秒計測の自己ベストの対象外。'}${round.interrupted ? ' · 中断あり' : ''}</p>${personalBest ? `<p class="av-earned" id="personal-best">${personalBest}</p>` : ''}${progressStatus ? `<p id="progress-save-state" class="av-save" role="status">${progressStatus}</p>` : ''}${earnedBits ? '<p id="memory-earned" class="av-earned" role="status">旅の記憶を確認中…</p>' : ""}<p id="session-save-state" class="av-save" role="status">今回の記録を保存中…</p><div id="recent-sessions"></div><div class="av-page-footer">${spec.mode === "patch" && spec.study ? action("元のボスに戻る", "study-return", "primary") : battleResult && fullJourney ? action('後日談へ', 'postlude', 'primary') : battleResult && outcome === 'lost' ? action('ボスから再挑戦', 'boss-retry', 'primary') : fullJourney && spec.place < PLACES.length - 1 ? action('次の場所へ', 'next-place', 'primary') : action('旅の地図', 'map', 'primary')}${action(spec.daily ? '同じ日の祈りをもう一度' : 'もう一度', 'retry')}${fullJourney && spec.place < PLACES.length - 1 ? action('旅の地図', 'map') : ''}${offeredLesson ? action("セラの修行場へ", "study") : ""}${action('この辞書の記録', 'run-records')}${action("旅の記憶を見る", "memories")}</div></section>`;
  main.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  main.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
  setTimeout(() => {
    if (round !== finished || view !== 'result') return;
    main.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; });
    updateNav();
  }, 500);
  const pendingBeforeSave = [...pendingMemorySessions];
  void saveSession(events, meta).then(async status => {
    // A successful write retries every older pending snapshot in the same batch.
    // Keep this status correct even if the player has left the result screen.
    if (status === 'persistent') for (const id of pendingBeforeSave) pendingMemorySessions.delete(id);
    updateMemorySaveNote();
    if (round !== finished || view !== 'result') return;
    $('session-save-state').textContent = status === 'persistent' ? '今回の練習記録をこのブラウザに保存しました。' : '今回の記録は一時保持のみです。再読み込みやページを閉じると失われます。次の保存時に再試行します。';
    let partial = false;
    const sessions = await loadSessions(spec.dict.id, () => { partial = true; });
    if (round !== finished || view !== 'result') return;
    if (earnedBits) {
      const before = mergeMemories(previouslyKnown, collectMemories(sessions.filter(s => s.session !== session)).owned);
      const earned = collectMemories([meta]).owned;
      memoryCache = mergeMemories(memoryCache, before);
      const added = MEMORIES.filter(m => earned[m.id] && !before[m.id]);
      $('memory-earned').textContent = added.length ? `旅の記憶 · ${added.map(m => m.title).join('、')}${partial ? '（読み込めた記録内での判定）' : ''}` : 'この章の条件を満たした記憶は、すでに集めています。';
    }
    if (spec.daily) $('daily-result-record').textContent = `${dailyRecordText(sessions, spec.daily, spec.character, spec.difficulty!)}${partial ? ' · 読み込めた記録と一時保持分のみ' : ''}`;
    const recent = [meta, ...sessions.filter(s => s.session !== session)].sort((a, b) => b.endedAt - a.endedAt).slice(0, 5);
    $('recent-sessions').innerHTML = `<h2>直近の練習</h2>${partial ? '<p role="status">読み込めた記録と一時保持分だけを表示しています。</p>' : ''}${recent.map(s => `<div class="av-record-row"><span>${s.session === session ? '今回' : esc(new Date(s.endedAt).toLocaleString('ja-JP'))}</span><b>${s.kanaPerSec.toFixed(2)} 字／秒</b><span>${(s.accuracy * 100).toFixed(1)}%</span><small>${s.outcome === 'lost' ? '敗北' : s.mode === 'journey' ? '完了' : s.mode === 'benchmark' ? '計測' : '練習'}${s.difficulty ? ` · ${difficultyText(s.difficulty)}` : ''}</small></div>`).join('')}`;
  }).catch(() => { if (round === finished && view === 'result') {
    $('session-save-state').textContent = '保存状態を確認できませんでした。この画面の結果を確認してください。';
    if (earnedBits) $('memory-earned').textContent = '今回の取得判定は旅の記憶で確認できます。過去の記録を読み込めず、新規取得との比較はできませんでした。';
  } });
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
  const chapters = sessions.filter(s => s.difficulty && s.difficulty !== 'seraph').sort((a, b) => b.endedAt - a.endedAt).slice(0, 5);
  if (chapters.length) el.insertAdjacentHTML('beforeend', `<section class="av-chapter-history"><h2>直近の章の記録</h2>${chapters.map(s => `<div class="av-record-row"><span>${esc(new Date(s.endedAt).toLocaleString('ja-JP'))}</span><b>${difficultyText(s.difficulty!)} · ${s.outcome === 'cleared' ? '撃破' : s.outcome === 'lost' ? '敗北' : '途中記録'}</b><span>${s.scope === 'boss' ? 'ボス再挑戦' : '章'} · ランク ${s.rank ?? '—'}</span><small>${(s.score ?? 0).toLocaleString('ja-JP')}点</small></div>`).join('')}</section>`);
  const hardChapters = sessions.filter(s => s.difficulty === 'seraph').sort((a,b) => b.endedAt - a.endedAt).slice(0,5);
  if (hardChapters.length) el.insertAdjacentHTML('beforeend', `<section class="av-chapter-history" id="seraph-history"><h2>熾天の記録</h2><p class="av-footnote">通常の最高記録・章の鍵とは別の成果です。ボスのみの結果を通しスコア・時間に混ぜません。</p>${hardChapters.map(s => `<div class="av-record-row"><span>${esc(new Date(s.endedAt).toLocaleString('ja-JP'))}</span><b>熾天 · ${isCompatibleDifficulty(s) ? s.outcome === 'cleared' ? '撃破' : s.outcome === 'lost' ? '敗北' : '途中記録' : '未対応の版 · 参考記録'}</b><span>${s.scope === 'boss' ? 'ボス再挑戦' : '章'} · ランク ${isRank(s.rank) ? s.rank : "—"}</span><small>${typeof s.score === 'number' && Number.isFinite(s.score) && s.score >= 0 ? `${s.score.toLocaleString('ja-JP')}点` : '未測定'}</small></div>`).join('')}</section>`);
  const bySession = new Map(sessions.map(s => [s.session, s]));
  const dailyRows = sessions.filter(s => readDaily(s) && isCharacter(s.character) && isDifficulty(s.difficulty)).sort((a,b) => b.endedAt - a.endedAt).slice(0, 5);
  if (dailyRows.length) el.insertAdjacentHTML('beforeend', `<section class="av-chapter-history" id="daily-history"><h2>今日の祈りの履歴</h2>${dailyRows.map(s => `<div class="av-record-row"><span>${esc(s.dailyDate!)}<small>${esc(s.dailyZone!)}</small></span><b>${CHARACTERS[s.character!].name} · ${difficultyText(s.difficulty!)}</b><span>${s.outcome === 'cleared' ? '撃破' : s.outcome === 'lost' ? '敗北' : '途中記録'}</span><small>${(s.score ?? 0).toLocaleString('ja-JP')}点</small></div>`).join('')}</section>`);
  for (const after of [...chapters, ...hardChapters].filter(s => s.trainingSession).sort((a,b) => b.endedAt-a.endedAt).slice(0, 3)) {
    const before = bySession.get(after.parentSession!), practice = bySession.get(after.trainingSession!);
    if (before && practice?.trainingForSession === before.session && practice.mode === 'patch' && practice.dict === after.dict)
      el.insertAdjacentHTML('beforeend', renderBossComparison(before, after));
  }
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
function renderBossComparison(before: SessionMeta, after: SessionMeta): string {
  const comparison = compareBossRecords(before, after); if (!comparison) return '';
  const boss = getChapter(PLACES.findIndex(p => `jp-angel-${p.key}` === after.dict)); if (!boss) return '';
  const accuracy = (m: typeof comparison.before) => m.accuracy === null ? '— · 入力なし' : `${(m.accuracy * 100).toFixed(1)}% · ${m.attempts}打`;
  const parries = (m: typeof comparison.before) => `${m.parries} / ${m.resolved}${m.resolved ? ` · ${Math.round(m.parries / m.resolved * 100)}%` : ' · 反撃なし'}`;
  const outcome = (m: SessionMeta) => m.outcome === 'cleared' ? '撃破' : m.outcome === 'lost' ? '敗北' : '途中';
  return `<section class="av-study-comparison"><h2>修行前と、戻ってからの祈り</h2><p>${boss.bossName} · ${CHARACTERS[after.character!].name} · ${difficultyText(after.difficulty!)} · 修行 ${after.trainingWords ?? 0}語</p><table><thead><tr><th scope="col">ボス戦の記録</th><th scope="col">修行前</th><th scope="col">再挑戦</th></tr></thead><tbody>${[['結果', outcome(before), outcome(after)], ['正確率', accuracy(comparison.before), accuracy(comparison.after)], ['弾き返し', parries(comparison.before), parries(comparison.after)], ['ひび', `${comparison.before.cracks}回`, `${comparison.after.cracks}回`], ['祈り直し', `${comparison.before.resets}回`, `${comparison.after.resets}回`]].map(([name,a,b]) => `<tr><th scope="row">${name}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table><p class="av-footnote">同じ相手・天使・難度・出題順での記録です。入力や反撃の回数は変わるため、結果は参考として見比べてください。</p></section>`;
}
function openSettings() {
  if (view === 'battle' && !round?.paused) pause();
  renderSound(); applyEffects(); showModal('settings-dialog');
}
function closeSettings() { showModal(view === 'battle' && round?.paused ? 'pause-dialog' : null); }
function perform(name: string) {
  if (finale || (view === 'result' && performance.now() < resultReadyAt)) return;
  if (name === 'map') { round = null; changeView('journey'); }
  else if (name === 'memories') changeView('memories');
  else if (name === 'records') { recordDict = DICTIONARIES[dictIndex]; changeView('records'); }
  else if (name === 'run-records' && run) { recordDict = run.dict; changeView('records'); }
  else if (name === 'start-journey') start({ dict: journeyDictionary(place), mode: 'journey', place, character });
  else if (name === 'start-daily' && view === 'journey') {
    const daily = dailyAt(); if (!daily) { syncDailyCard(true); return; }
    start({ dict: chapterDictionary(DAILY_PLACE), mode: 'journey', place: DAILY_PLACE, character, difficulty, seed: daily.seed, daily });
  }
  else if (name === 'start-training') { const dict = DICTIONARIES[dictIndex]; start({ dict, mode: dict.kind === 'passage' ? 'passage' : 'benchmark', place, character }); }
  else if (name === 'start-passage') start({ dict: DICTIONARIES.find(d => d.kind === 'passage')!, mode: 'passage', place, character });
  else if (name === 'retry' && run) start({ ...run, bossOnly: false, parentSession: undefined, initialKanaPerSec: undefined, seed: run.daily?.seed, study: run.mode === 'patch' && run.study ? { lesson: run.study.lesson } : undefined });
  else if (name === 'boss-retry' && run && chapter?.battle.snapshot().outcome === 'lost') start({ ...run, bossOnly: true, parentSession: lastSession, initialKanaPerSec: chapter.battle.snapshot().kanaPerSec, seed: undefined, study: undefined, daily: undefined });
  else if (name === 'study' && view === 'result' && offeredLesson) {
    lesson = { ...offeredLesson, focus: trainingFocus(offeredLesson.events, bossPracticeDictionary(offeredLesson.place), prefs) }; changeView('lesson');
  }
  else if (name === 'study-start' && view === 'lesson' && lesson) start({ dict: bossPracticeDictionary(lesson.place), mode: 'patch', place: lesson.place,
    character: lesson.before.character!, focus: lesson.focus?.label, vulns: lesson.focus ? [lesson.focus] : [], study: { lesson } });
  else if (name === 'study-return' && view === 'result' && run?.mode === 'patch' && run.study?.trainingSession) {
    const study = run.study, before = study.lesson.before;
    start({ dict: chapterDictionary(study.lesson.place), mode: 'journey', place: study.lesson.place, character: before.character!, difficulty: before.difficulty!,
      bossOnly: true, parentSession: before.session, seed: before.seed!, initialKanaPerSec: study.lesson.initialKanaPerSec, study });
  }
  else if (name === 'postlude' && chapter?.battle.snapshot().outcome === 'cleared') { chapter.phase = 'outro'; showConversation('outro', chapter.definition.outro(run!.character)); }
  else if (name === 'dialog-next') advanceConversation();
  else if (name === 'next-place' && run) {
    if (run.place === PLACES.length - 1 || (run.difficulty === 'seraph' && !nextSeraphAllowed(run))) { changeView('journey'); return; }
    place = Math.min(PLACES.length - 1, run.place + 1); settings.set('angel.place', place);
    start({ dict: journeyDictionary(place), mode: 'journey', place, character: run.character, difficulty: run.difficulty });
  }
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
  if (finale && view === 'battle') {
    if ((event.target as HTMLElement).closest('.av-battle')) { event.preventDefault(); end(); }
    return;
  }
  if (view === 'result' && performance.now() < resultReadyAt) { event.preventDefault(); return; }
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
  if (target.id === 'journey-difficulty' && isDifficulty(target.value)) { difficulty = target.value; settings.set('angel.difficulty', difficulty); updateJourneyDifficulty(); syncDailyCard(true); }
  else if (target.id === 'training-dict' && isDictionaryIndex(DICTIONARIES.length)(Number(target.value))) { dictIndex = Number(target.value); settings.set('dict', dictIndex); }
  else if (target.id === 'record-dict') { const d = [...DICTIONARIES, ...PLACES.map((_, i) => getChapter(i) ? chapterDictionary(i) : journeyDictionary(i))].find(d => d.id === target.value); if (d) { recordDict = d; report = undefined; $('report').textContent = '記録を読み込み中…'; void showRecords(); } }
});
$('sound-volume').addEventListener('input', event => { audio.setVolume(Number((event.target as HTMLInputElement).value)); settings.set('volume', audio.volume); audio.ensure(); renderSound(); });

// Same composition/modifier/native-control boundaries as the established app.
window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const editable = target?.closest('input,select,textarea,[contenteditable]');
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
    if (editable) return;
    if (view === 'battle' && !round?.paused && !finale && !conversation) $('ime-warning').hidden = false;
    event.preventDefault(); return;
  }
  if (finale && finale.round === round && view === 'battle') {
    event.preventDefault();
    if (event.key === 'Escape' && !event.repeat) end();
    return;
  }
  if (view === 'result' && performance.now() < resultReadyAt) { event.preventDefault(); return; }
  if (conversation) {
    if (event.key === 'Tab') { dialogs.cycle(event); return; }
    event.preventDefault();
    if (!event.repeat && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      if (conversation.kind === 'boss-intro') advanceConversation(true);
      else if (event.key === ' ' || event.key === 'Enter') advanceConversation();
      else if (event.key === 'Escape' && conversation.kind === 'intro') advanceConversation(true);
    }
    return;
  }
  if (dialogs.active) {
    if (event.key === 'Tab') { dialogs.cycle(event); return; }
    if (!dialogs.contains(event.target)) { event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) modal === 'settings-dialog' ? closeSettings() : resume(); return; }
    if (event.repeat) { event.preventDefault(); return; }
    return; // Focused native button/slider owns Space, Enter and arrows.
  }
  if (event.key === 'Tab') return;
  if (target?.closest('button,input,select,textarea,a,summary,[contenteditable]')) {
    if (event.key === 'Escape' && view === 'battle') { event.preventDefault(); focusChapterInput(); }
    return;
  }
  if (event.repeat) return;
  if (view === 'lesson') { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); perform('study-start'); } else if (event.key === 'Escape') perform('map'); return; }
  if (view === 'records') { if (/^[1-8]$/.test(event.key)) patch(Number(event.key) - 1); else if (event.key.toLowerCase() === 'h') perform('metric'); else if (event.key === 'Escape') perform('map'); return; }
  if (view === 'result') { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); perform(main.querySelector<HTMLButtonElement>('.av-page-footer .primary')?.dataset.action ?? 'retry'); } else if (event.key === 'Escape') perform('map'); return; }
  if (view !== 'battle' || !round || round.paused || round.finished) return;
  if (event.key === 'Escape') { event.preventDefault(); pause(event.timeStamp); return; }
  if (event.key.length !== 1 || (event.key === ' ' && !round.session.expected.includes(' '))) return;
  event.preventDefault(); $('ime-warning').hidden = true; audio.ensure();
  if (chapter?.phase === 'boss' && round.started) {
    battleEvents(chapter.battle.tick(round.elapsedMs(event.timeStamp), inputView()), event.timeStamp);
    if (round.finished) { end(); return; }
  }
  const previousWord = round.word, previousSession = round.session, previousKana = round.session.kanaDone, previousChain = round.chain;
  const wordClean = !scoring.wordMissed;
  const outcome = round.input(event.key, event.timeStamp, event.code);
  if (outcome.late) { end(); return; }
  const committedKana = outcome.wordDone ? normalizeReading(previousWord.reading).length - previousKana
    : round.session.kanaDone - previousKana;
  scoring = scoreInput(scoring, committedKana, outcome.accepted, outcome.wordDone);
  if (chapter && outcome.wordDone) {
    const gameMs = round.elapsedMs(event.timeStamp), kana = normalizeReading(previousWord.reading).length;
    if (chapter.phase === 'route') {
      chapter.battle.routeWordDone({ kana, durationMs: gameMs - chapter.previousWordAt }); chapter.previousWordAt = gameMs;
    } else if (chapter.phase === 'boss') battleEvents(chapter.battle.wordDone({ index: round.wordsDone - 1, kana, clean: wordClean, gameMs }, inputView()), event.timeStamp);
  }
  if (round.finished) captureEnd();
  if (outcome.accepted) {
    speed.accepted(event.timeStamp, !!round.log.at(-1)?.afterPause);
    audio.key(round.stage, outcome.critical, comboTier(round.chain));
    combat?.hit(outcome.wordDone ? 'word' : crossedMilestone(previousWord, previousKana, round.session.kanaDone) ? 'milestone' : 'key');
    if (outcome.wordDone) { audio.word(round.stage); breakthrough(); }
    $('input-status').textContent = outcome.wordDone ? chapter?.phase === 'boss' ? '祈りが命中' : '封印を突破' : 'ローマ字を打つ';
  } else {
    audio.miss();
    if (previousChain >= 10) { comboBrokenUntil = event.timeStamp + 800; audio.comboBreak(); }
    $('speech').textContent = run?.study && run.mode === 'patch' ? '消さずに、もう一度。同じ言葉を落ち着いて唱えましょう。' : CHARACTERS[run!.character].miss; $('input-status').textContent = 'もう一度 · Backspaceは不要';
  }
  if (round.finished && chapter) {
    $('word').textContent = previousWord.display; $('reading').innerHTML = `<span class="done">${esc(normalizeReading(previousWord.reading))}</span>`;
    $('romaji').innerHTML = `<span class="av-typed">${esc(previousSession.typed)}</span>`;
  } else renderPanel(!outcome.accepted);
  renderMeters(event.timeStamp); renderBattle(event.timeStamp);
  if (round.finished) {
    if (!chapter || chapter.battle.snapshot().outcome === 'cleared') beginFinale(); else end();
  } else if (chapter?.phase === 'route' && round.wordsDone === CHAPTER_ROUTE_WORDS) {
    round.pause(event.timeStamp); chapter.phase = 'boss-intro'; showConversation('boss-intro', chapter.definition.bossIntro);
  }
});
window.addEventListener('blur', event => pause(event.timeStamp));
// Reflow can move the active long-text cursor outside its scroll window.
window.addEventListener('resize', () => {
  layoutChapter(); renderPanel($('input-panel')?.classList.contains('miss'));
  if (view === 'battle' && !conversation && !modal && !finale) focusChapterInput();
});
document.addEventListener('visibilitychange', () => {
  if (finale) { if (!document.hidden) end(); }
  else if (document.hidden) pause();
  if (!document.hidden) syncDailyCard(true);
});
window.addEventListener('focus', () => syncDailyCard(true));
setInterval(() => syncDailyCard(), 30_000);
let lastFrame = performance.now();
function frame(now: number) {
  if (conversation?.kind === 'boss-intro' && !document.hidden && now - conversation.shownAt >= 1000) advanceConversation();
  if (view === 'battle' && round && !round.paused) {
    if (finale) {
      if (finale.round === round) {
        const elapsed = now - finale.startedAt;
        combat?.finale(elapsed);
        if (elapsed >= finale.duration) end();
      }
      lastFrame = now; requestAnimationFrame(frame); return;
    }
    round.tick(now, Math.min(0.05, (now - lastFrame) / 1000));
    if (chapter?.phase === 'boss' && round.started) battleEvents(chapter.battle.tick(round.elapsedMs(now), inputView()), now);
    if (round.finished) end(); else { renderMeters(now); renderBattle(now); }
  }
  lastFrame = now; requestAnimationFrame(frame);
}
renderSound(); render(); updateNav(); requestAnimationFrame(frame);
