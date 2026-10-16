# 実装構成

2026-10-16確認。入口は `index.html` → `src/main.ts` です。
Viteで単一HTMLをビルドし、DOM・CSS・SVGで描画します。存在しないページは404です。

## 画面と入力

- `src/ui/title.ts`、`title.css`: 打天使のタイトル。Space・開始ボタンからエルナの横視点稽古へ進みます。
- `src/main.ts`、`src/style.css`: 天使・地図・練習・記録・旅の記憶・会話・入力・結果の統合。
- `src/game/round.ts`: 出題、先読み、入力ログ、時計、停止・再開と終了。
- `src/engine/romaji.ts`: 別綴り、かなの確定、英語、長文の句読点。
- `src/ui/dialog.ts`、`report.ts`: ダイアログのフォーカス管理、分析画面。

IME、長押し、修飾キー、操作部品にフォーカスがある間のキーはゲーム入力から分離します。
計測と弱点練習は60秒、長文と道中は時間制限なしです。

## 章・稽古・成果

- `src/content/chapters.ts` と土地別の `town.ts` など: 全7章の会話・道中・ボス・結末・出題。
- `src/game/chapter.ts`、`battle.ts`: 道中とボスの進行、結界、攻撃・防御、標準・挑戦・熾天の規則。
- `src/game/duel.ts`: 横視点稽古。受理された1打鍵ごとの攻撃・部分ガード、完成時のコンボ・パリィ。
- `src/game/score.ts`: 確定かな単位の加点、コンボ、ランク、星。別綴りの打鍵数で加点を変えません。
- `src/game/progress.ts`: 版ごとの成果、章の解放、成果の統合と移行。旧版の出所を保持し、異なる版のベストを混ぜません。
- `src/game/training.ts`、`daily.ts`、`memories.ts`、`seraph.ts`: ボスの修行、日替わり、21の旅の記憶、熾天の成果。
- `src/game/journey.ts`: 姉弟、7土地、旧道中の出題、直近の打鍵速度。
- `src/content/knowledge.ts`、`words.ts`、`passages.ts`: 出典付き教養文、日本語・英語辞書と長文。

章の現在版クリアが次の章を解放します。熾天の成果は標準・挑戦と別に保存します。
日替わりは開始時の日付・タイムゾーン・seedを固定します。

## 表示・音声・素材

`src/fx/side-combat.ts` は横視点のSVG演出、`sprite-actor.ts`、`battle-motion.ts`、
`motion-manifest.ts` は人物の姿勢と6コマの動作を担当します。
`key-effects.ts`、`painted-effect.ts` は即時の斬撃・ガードなどを担当し、演出の待ち列を作りません。
`combat.ts`、`combat.css` には既存の術式演出と共通の戦闘スタイルもあります。
停止したゲーム時計で演出も止まり、演出の弱・オフ、低負荷、OSの動き軽減に対応します。

`src/fx/music.ts` は7曲の通常速度ループと独立音量・ミュート・停止・再開を扱います。
`audio.ts` は任意の効果音です。画像・音声が使えなくても入力と保存を続行します。

- `public/angel/`: 背景と人物のWebP。原画との対応は `src/content/art-assets.json`。
- `public/battle-art/`: 横視点の人物・背景・動作・効果。出典は同フォルダの `CREDITS.md`。
- `public/fx/`: 追加効果と同梱ライセンス。出典は同フォルダの `CREDITS.md`。
- `public/audio/music/boss/`: MP3と採用・利用条件・ハッシュを記録した `manifest.json`。
- `concept/`: 世界観、原画、生成条件、採用前の音源生成記録。

## 保存と分析

`src/stats/store.ts` はIndexedDBの書込み確定を待ち、失敗時はページ内に一時保持します。
未保存分は次の保存で再試行します。確定済みのページ内キャッシュは直近5件に制限し、DB履歴は保持します。
閉じた分析画面の読み込みは中止します。
`analyze.ts` は速度・正確率・キー遷移・苦手を、`select.ts` と `baselines.ts` は弱点練習と基準を扱います。

`src/storage/settings.ts` は検証済みの設定とlocalStorageの読み書きを担当し、保存前に他タブの最新成果を読み直します。
これはトランザクションによる複数タブの排他制御ではありません。同時書込みの厳密な保証は未実施です。
既存記録との互換性のため `icebreaker-stats` と `icebreaker.*` は継続します。
入力途中からの再開は未実装です。

## 検証と資料

ユニットテストは対応するソースの隣に置きます。
現行のブラウザ検証はタイトル、横視点稽古、動作、実時計の4本です。
旧5語道中・旧SVG向けの4本は `checks/archive/` に保管します。
手順と適用範囲は [checks/README.md](../checks/README.md) を参照してください。

現在の確認は [docs/review/](review/README.md)、過去の確認は `docs/review/archive/`、
当初の設計は [GAME_DESIGN.md](GAME_DESIGN.md)、今後の課題は [ROADMAP.md](ROADMAP.md) に置きます。
