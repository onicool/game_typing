export interface Word {
  display: string;
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
network server client domain portal mirror phantom ghost signal echo
neon chrome laser plasma vapor static glitch override reboot uplink
`
  .trim()
  .split(/\s+/)
  .map((w) => ({ display: w, reading: w }));

export const DICTIONARIES: Dictionary[] = [
  { id: 'jp-core', name: '日本語', label: 'JP / ROMAJI', words: JAPANESE },
  { id: 'en-core', name: 'English', label: 'EN / DIRECT', words: ENGLISH },
];

/** Shuffled endless word stream that avoids immediate repeats. */
export class WordStream {
  private bag: Word[] = [];
  private recent: string[] = [];

  constructor(private readonly dict: Dictionary) {}

  next(): Word {
    if (this.bag.length === 0) this.refill();
    let idx = this.bag.findIndex((w) => !this.recent.includes(w.display));
    if (idx < 0) idx = 0;
    const [w] = this.bag.splice(idx, 1);
    this.recent.push(w.display);
    if (this.recent.length > 8) this.recent.shift();
    return w;
  }

  private refill() {
    this.bag = [...this.dict.words];
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
  }
}
