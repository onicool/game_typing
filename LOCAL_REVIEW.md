# ローカルレビュー一覧

2026-10-05。外部アップロードや公開をせず、この作業環境内で確認するための索引です。
`/tmp` の証跡はこの環境固有で、環境の消失後も保持される保証はありません。
作業ブランチは `improve/session-save-feedback`。保全対象の検証開始点は
`1cf3d7ad2dc1831ca9b38f918761a71495b46658`、main は `57fe2e5` のままです。

## 完成している範囲

| 項目 | 現状 | 証跡・再確認先 |
|---|---|---|
| 入力と保存 | 別綴り、IME/操作キー分離、正しい確定表示、失敗時の一時保持と次保存で再試行、旧完了の世代確認 | `src/engine/romaji.test.ts`、`src/stats/store.test.ts`、`checks/idb_recovery_check.py` |
| 計測・練習 | 日本語/英語60秒、診断とパッチ、原作長文4件・途中終了保存、練習はPB対象外 | `checks/passage_queue_check.py`、`src/game/round.test.ts` |
| 可読性・操作 | 大きなB文字、次の2語、長文追従、設定/停止ダイアログのフォーカスと背景分離 | `checks/dialog_input_check.py`、`checks/keyboard_check.py` |
| 先読み | NEXT1/2が出題順と保存された語IDに一致。停止・やり直し・辞書切替にも追従 | `checks/passage_queue_check.py` |
| SKYWAY | 浮遊都市と敵1体、入力進行の前進・破壊、迎撃の見た目、停止画素固定、低負荷/動き停止 | `checks/skyway_check.py`、`checks/intercept_check.py` |
| 軽量素材 | 通常617,068バイト、PNG比85.7%削減、原PNG保全、WebP失敗時1回のPNG再試行 | `checks/asset_load_check.py`、`scripts/encode_stage_assets.py` |
| 音声 | 任意の効果音、故障時も入力/保存継続、明示off→onのみ再試行 | `src/fx/audio.test.ts`、`checks/audio_check.py` |
| 反復安定性 | 20分11秒、24保存・再読込一致。終了後の分析21回もDOM/リスナ一定 | `checks/soak_check.py`、`checks/soak_history_check.py`、`/tmp/game-typing-qa/soak-cycle/` |
| 保存/大量履歴 | 確定キャッシュは5件、未確定は全件保持。全DB履歴を個別取得、部分表示を明示、閉じた分析の読取りを中止 | `checks/history_scale_check.py`、`checks/history_fallback_check.py`、`src/stats/store.test.ts` |

## 現在の停止チェックポイント

ユーザーの「区切りで止めて遊びたい」指示に従い、新しい改善・負荷拡大を停止。
先の文書/検証コードはローカル `a6ad27c` にコミット済みです。今回の保存/読取り
修正は199ユニットケース、型検査付きビルド、人工DBの実ブラウザ確認が成功し、
同じブランチの次のチェックポイントとして保存します。main/本番/素材は保全。

新規コンテキスト＋固有名のQA DBで、20/200/1000件（各300キー）を有限確認。
元の成功ログ保持はGC後20件2.57MiB→200件9.42MiB→1000件39.87MiB、
再読込で1.81MiBへ戻り、ページ内保持による増大を確認。確定5件キャッシュと
独立DBコピーの再利用後は1000件2.12MiB。DBの1000件・30万キーは残り、
全件の読取り件数は再読込後も一致しました。加速保存であり17時間の実プレイや
実ユーザー履歴を読んだ検証ではありません。

分析の待ち時間は元20件94〜234ms／200件401〜571ms／1000件1.11〜2.41秒。
最終方式は20件89〜235ms／200件241〜370ms／1000件1.10〜1.63秒でした。
共有ホスト、キャッシュ、ヘッドレス描画の影響があり、因果的な速度保証はしません。
1件ずつの逐次cursor案は総待ちが増えたため採用せず、軽いキー一覧から各記録を
まとめて要求します。一括デコードでの大きな停止を避ける設計ですが、最終版の
長い処理停止の再計測と、大量読取り中の実ブラウザcancel確認は停止指示で未実施。
キャンセルの保存保全・誤った障害通知を出さないことはユニットで確認しています。
大きい履歴の表示待ちと同期分析計算は残るため、瞬時表示を称しません。

最終版の実ブラウザでは長文22件/352キー、読取り障害の確定5件表示、未保存8件の
全保持、次保存での回復、元12件の完全保全と全件再読込一致が成功。部分表示の
警告は復旧後に消えます。既存11種類の保存障害と同じIDの実Native競合も成功。
追加6ユニットはキャッシュ後の全履歴/コピー独立性、未確定バッチ保全、
古いqueued保存の正しい確定結果、同ID世代、取消と保存保全を確認します。
入力・採点・学習用の全履歴・ステージ・長文・先読み・素材を変えていません。

- [最終大量履歴結果](/tmp/game-typing-qa/history-cycle/pipelined/results.json) /
  [比較前](/tmp/game-typing-qa/history-cycle/baseline-2/results.json)
- [保存/部分表示/回復](/tmp/game-typing-qa/history-cycle/pipelined-fallback/results.json) /
  [既存保存回帰](/tmp/game-typing-qa/history-cycle/pipelined-idb/results.json)
- [アクセス経路と最小成果物](/tmp/game-typing-qa/history-cycle/play-route-check.json)

既存のMac向けプレビュー転送ツール/URL設定/CLIがこの環境では見つかりません。
クラウド内の現行静的サーバーはHTTP200ですが、Macで開けるとは扱いません。
必要な移送は本番7ファイル5,093,674バイトのみ（構造を保つ）。外部送信は未許可で
実施せず、Mac側のPython3でHTTP起動する最小案をREADMEに記載しました。
新規公開、push、認証変更、トンネル作成、依存追加、外部保存はしていません。

## 以前の20分検証（1cf3d7a）

開始点 `1cf3d7a` の本番ビルドを別ディレクトリへ保全し、実時計・通常rAF・
音声ONの新規Chromium151で20分11.28秒確認しました。通常計測・長文・
途中保存、やり直し4回、停止12回を含み、9,787キー入力中9,051キー・24件を
保存（日本語16件／長文8件）。全保存キーが正解候補に一致し、両ストアの
セッションIDは同じ24件、先頭24個と停止復帰5個のNaN計測除外値を保全。
完全な記録は再読込後も一致しました。ページ例外はありません。

GC前のヒープは変動し、GC後は起動直後2.41MiB→4分3.87MiB→終了5.30MiB。
途中の12分5.21MiB／16分5.07MiBも記録しています。成功済みログを含む
ページ内フォールバックキャッシュの保持は既存仕様です。記録と資源の
残留を区別し、今回の結果を「将来も増えない」「リークが絶対ない」とは称しません。
音声は102,002ノード生成／101,995破棄、静止・GC後は固定7ノード・1コンテキスト。
画像は常に2枚、温まった後のGC時DOMリスナは60個で一定。今回起動したChromium
プロセスRSSの単純合計は5分頃997.3MiB／8分1000.7／16分998.0／終了前1011.5。
共有ページの重複を含む補助値で、起動前基準や実機の必要メモリ量ではありません。

古い保存完了を遅らせ、新しい途中結果が自身の確定まで「保存中」であることを
確認。停止後の実Chromium凍結3秒・復帰も時計と入力位置が一致しました。
ヘッドレスで別タブ・最小化・凍結を試しても `document.hidden` は false のまま。
実際の非表示時の自動停止、OSスリープは未確認で、合成イベント試験と区別します。

同じ24件の人工履歴を別の新規コンテキストに入れ、分析画面を21回開閉。
日本語7,978キーの表示が一致し、GC後DOM1,062ノード／リスナ46個で一定、
ヒープは1回目1.94MiB→11回目2.02MiB→21回目2.04MiBでした。
初期の要素取得を伴う計測では37ノード/回の増加が出ましたが、Locator待機だけ
では解消せず、要素ハンドルとセレクタ補助を使わない同等確認で解消しました。
計測側の保持を本体の漏れと誤認せず、ゲーム本体の修正は行っていません。

短い初期ハーネスの失敗（空DB生成、30秒では計測未完了）と、NaN総数の
誤った期待値（復帰分5個を忘れた）は補正済み。詳細と元証跡を保全しています。
チェックポイントの型検査付きビルド、ブラウザ検証、Python構文と差分確認は成功。
本体変更がないため、既に成功済みの193ユニットケースを今回再実行していません。
試験・サーバーは停止済み。検証開始点 `1cf3d7a` を保全し、親からの明示指示
（2026-10-05）に従って文書と再実行コードを同じローカルブランチの
検証済みチェックポイントとしてコミット保存します。push / PR / 公開 / 外部保存は
行っていません。

- [結果JSON](/tmp/game-typing-qa/soak-cycle/baseline/summary.json) /
  [全推移](/tmp/game-typing-qa/soak-cycle/baseline/progress.jsonl) /
  [記録整合性](/tmp/game-typing-qa/soak-cycle/record-integrity.json)
- [資源の推移図](/tmp/game-typing-qa/soak-cycle/resource-trends.png) /
  [分析反復結果](/tmp/game-typing-qa/soak-cycle/history-final/results.json) /
  [実分析画面](/tmp/game-typing-qa/soak-cycle/history-final/report.png)
- [計測修正・未確認の説明](/tmp/game-typing-qa/soak-cycle/harness-notes.json) /
  [保全ビルドのハッシュ](/tmp/game-typing-qa/soak-cycle/checkpoint-build.json)

## 見る順番

1. まずローカルビルドを起動し、短い単語→迎撃→Esc停止→長文を操作。
2. 現行の短い実録動画:
   [/tmp/game-typing-qa/asset-cycle/production-review/skyway-lightweight-interception.mp4](/tmp/game-typing-qa/asset-cycle/production-review/skyway-lightweight-interception.mp4)
   （18.6秒、1366×768、無音、実ブラウザ画面）。
3. 文字配置の実画面と結果:
   [/tmp/game-typing-qa/asset-cycle/passage-regression/results.json](/tmp/game-typing-qa/asset-cycle/passage-regression/results.json)、
   [/tmp/game-typing-qa/asset-cycle/interception/results.json](/tmp/game-typing-qa/asset-cycle/interception/results.json)。
4. 保存と素材の障害試験:
   [/tmp/game-typing-qa/idb-recovery-cycle/results.json](/tmp/game-typing-qa/idb-recovery-cycle/results.json)、
   [/tmp/game-typing-qa/asset-cycle/loading-results.json](/tmp/game-typing-qa/asset-cycle/loading-results.json)。

以前の PNG / WebM / MP4、参考画像、生成原本とチェックポイントは残しています。
4枚の旧A/B原本のDrive受渡しは以前の個別許可の範囲内で完了済みです。
この一覧や以後の証跡には、新たな外部送信・公開の許可はありません。

## 未確認・再開候補

実機Mac/PC、物理入力から表示までの遅延、Safari/Firefox、音を実際に聴いた評価、
実OS非表示/スリープ、physical GPU/描画、読み上げソフト、複数タブ同時書込、ブラウザ退避、1000件を超える履歴、
利用者の継続練習効果は未確認です。ヘッドレスのコールバック時間や
人工ネットワーク条件は、実機性能や有料製品比較の保証ではありません。

現在は改善を停止し、ユーザーの試遊を優先します。次の再開は明示指示後とし、
残る大量分析の同期計算や実機・非表示復帰を候補とします。
追加ステージ・パートナーやBGM統合には広げません。
