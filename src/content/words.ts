import { JP_WORDS } from './data_jp';
import { EN_WORDS } from './data_en';
export interface Word {
  display: string;
  /** Stable dictionary/display identity when supplied by a word source. */
  id?: string;
  /** Kana reading for Japanese, literal text for English. */
  reading: string;
}

export interface Dictionary {
  id: string;
  name: string;
  label: string; // shown in the input panel footer
  words: Word[];
}

const jp = (pairs: string): Word[] =>
  pairs
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [display, reading] = line.split(/\s+/);
      return { display, reading: reading ?? display };
    });

const JAPANESE = jp(`
脆弱性 ぜいじゃくせい
接続 せつぞく
侵入 しんにゅう
暗号化 あんごうか
復号 ふくごう
防壁 ぼうへき
認証 にんしょう
権限 けんげん
回線 かいせん
信号 しんごう
解析 かいせき
演算 えんざん
記憶領域 きおくりょういき
中枢 ちゅうすう
電脳 でんのう
深層 しんそう
経路 けいろ
迂回 うかい
偽装 ぎそう
追跡 ついせき
遮断 しゃだん
突破 とっぱ
制御 せいぎょ
同期 どうき
送信 そうしん
受信 じゅしん
端末 たんまつ
鍵束 かぎたば
合言葉 あいことば
抜け道 ぬけみち
監視網 かんしもう
自律機械 じりつきかい
人工知能 じんこうちのう
量子計算 りょうしけいさん
仮想空間 かそうくうかん
情報戦 じょうほうせん
夜明け よあけ
摩天楼 まてんろう
高速道路 こうそくどうろ
地下鉄 ちかてつ
自動販売機 じどうはんばいき
雨上がり あめあがり
蛍光灯 けいこうとう
真夜中 まよなか
交差点 こうさてん
観覧車 かんらんしゃ
喫茶店 きっさてん
写真機 しゃしんき
新幹線 しんかんせん
商店街 しょうてんがい
発電所 はつでんしょ
天気予報 てんきよほう
宇宙船 うちゅうせん
銀河 ぎんが
流れ星 ながれぼし
稲妻 いなずま
花火大会 はなびたいかい
満月 まんげつ
朝焼け あさやけ
秘密基地 ひみつきち
作戦会議 さくせんかいぎ
緊急事態 きんきゅうじたい
脱出経路 だっしゅつけいろ
最終防衛線 さいしゅうぼうえいせん
一騎当千 いっきとうせん
電光石火 でんこうせっか
疾風迅雷 しっぷうじんらい
臨機応変 りんきおうへん
試行錯誤 しこうさくご
起死回生 きしかいせい
不撓不屈 ふとうふくつ
集中力 しゅうちゅうりょく
反射神経 はんしゃしんけい
指先 ゆびさき
鍵盤 けんばん
旋律 せんりつ
共鳴 きょうめい
残響 ざんきょう
協力 きょうりょく
挑戦 ちょうせん
到達 とうたつ
限界突破 げんかいとっぱ
キーボード キーボード
ネットワーク ネットワーク
ファイアウォール ファイアウォール
パスワード パスワード
サーバー サーバー
プロトコル プロトコル
アルゴリズム アルゴリズム
シグナル シグナル
ノイズ ノイズ
エラー エラー
データベース データベース
バックドア バックドア
ハッキング ハッキング
クラッシュ クラッシュ
コマンド コマンド
ダウンロード ダウンロード
アクセス アクセス
シャットダウン シャットダウン
ウィルス ウィルス
ヴァーチャル ヴァーチャル
チェックポイント チェックポイント
ネオンサイン ネオンサイン
`);

const ENGLISH = `
access breach cipher signal packet kernel shell socket proxy router
vector matrix neural circuit syntax buffer cache thread daemon script
binary pixel quantum vertex shader render module compile deploy commit
branch merge rebase stash token secret cookie session firewall gateway
tunnel payload exploit patch debug trace stack heap queue array
string object class method lambda closure promise async await yield
network server client domain portal mirror phantom ghost echo
neon chrome laser plasma vapor static glitch override reboot uplink
`
  .trim()
  .split(/\s+/)
  .map((w) => ({ display: w, reading: w }));

const strip = (ws: { display: string; reading: string }[]): Word[] => ws.map(({ display, reading }) => ({ display, reading }));

export const DICTIONARIES: Dictionary[] = [
  { id: 'jp-core', name: '日本語', label: 'JP / ROMAJI', words: uniqueWords([...JAPANESE, ...strip(JP_WORDS)], 'jp-core') },
  { id: 'en-core', name: 'English', label: 'EN / DIRECT', words: uniqueWords([...ENGLISH, ...strip(EN_WORDS)], 'en-core') },
];

/** Stable across seeds, sessions and spelling preferences. */
export function wordId(dictId: string, display: string): string {
  return `${dictId}:${display}`;
}

export function uniqueWords(words: Word[], dictId: string): Word[] {
  const seen = new Set<string>();
  return words.filter(word => {
    if (seen.has(word.display)) return false;
    seen.add(word.display);
    return true;
  }).map(word => ({ ...word, id: wordId(dictId, word.display) }));
}

/** Mulberry32: reproducible on every browser; never uses global randomness. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Endless shuffled passes, balanced between short/long halves in 10-word blocks. */
export class WordStream {
  readonly seed: number;
  readonly poolSize: number;
  private readonly pool: Word[];
  private readonly random: () => number;
  private bag: Word[] = [];
  private recent: string[] = [];

  constructor(dict: Dictionary, seed = Math.floor(Math.random() * 2 ** 32)) {
    this.seed = seed >>> 0;
    this.random = seededRandom(this.seed);
    this.pool = uniqueWords(dict.words, dict.id).sort((a, b) => a.reading.length - b.reading.length);
    this.poolSize = this.pool.length;
    if (!this.poolSize) throw new Error('A word stream needs at least one word');
  }

  next(): Word {
    if (this.bag.length === 0) this.refill();
    let idx = this.bag.slice(0, 10).findIndex((w) => !this.recent.includes(w.display));
    if (idx < 0) idx = this.bag.findIndex((w) => !this.recent.includes(w.display));
    if (idx < 0) idx = 0; // Tiny dictionaries cannot satisfy an eight-word cooldown.
    const [w] = this.bag.splice(idx, 1);
    this.recent.push(w.display);
    if (this.recent.length > 8) this.recent.shift();
    return w;
  }

  private shuffle(words: Word[]): Word[] {
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words;
  }

  private refill(): void {
    const split = Math.ceil(this.pool.length / 2);
    const short = this.shuffle(this.pool.slice(0, split));
    const long = this.shuffle(this.pool.slice(split));
    this.bag = [];
    while (short.length || long.length) {
      const block = [...short.splice(0, 5), ...long.splice(0, 5)];
      this.bag.push(...this.shuffle(block));
    }
  }
}
