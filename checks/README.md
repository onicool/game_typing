# ブラウザ検証

現行のタイトル・横視点稽古・動作・実時計を検証します。章進行・保存・入力判定などのユニットテストは `src/` にあります。

```sh
npm test -- --maxWorkers=1
npm run build
```

## ブラウザの準備

Python Playwrightと既存のChromium系ブラウザを使います。初回だけプロジェクトのルートで準備します。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r checks/requirements.txt
```

[Playwrightの公式導入手順](https://playwright.dev/python/docs/library)も参照できます。
検証スクリプトはブラウザをダウンロードしません。MacではGoogle Chrome、LinuxではChromium、
それ以外はPlaywrightの既存Chromiumを選択します。別の実行体は `CHROMIUM_EXECUTABLE` で指定します。

## 現行の検証

別の端末で本番プレビューを起動します。

```sh
npm run preview -- --host 127.0.0.1 --port 5180 --strictPort
```

次の検証は順番に実行し、出力先には毎回まだ存在しないフォルダを指定します。

```sh
.venv/bin/python checks/title_screen_check.py http://127.0.0.1:5180 /tmp/title-screen-next
.venv/bin/python checks/side_combat_check.py http://127.0.0.1:5180 /tmp/side-combat-next
.venv/bin/python checks/battle_motion_check.py http://127.0.0.1:5180 /tmp/battle-motion-next
.venv/bin/python checks/angel_real_timer_check.py http://127.0.0.1:5180 /tmp/angel-timer-next
```

| 検証 | 対象 |
| --- | --- |
| `title_screen_check.py` | タイトル、Space・ボタン開始、保存済み天使との優先順、入力・BGM・停止・タイトルへの戻り・記録保持 |
| `side_combat_check.py` | 両キャラ、短文・長文と5画面サイズ、高速入力の固定64枠・全打鍵保存、部分ガード・パリィ、停止・非表示、演出・低負荷、独立BGMと7音源の復号・ループ |
| `battle_motion_check.py` | 両キャラの4通常攻撃＋2コンボと6コマ、敵3攻撃・被弾・反射、素材取得失敗・低負荷時の入力継続 |
| `angel_real_timer_check.py` | 実時計での60秒計測、自動終了、打鍵とメタ情報の保存 |

人工データ、新しいブラウザコンテキスト、固有のQAデータベースだけを使い、既存のユーザープロファイルは読みません。
結果のJSONと画像は指定先へ保存します。終了後は検証ブラウザを閉じ、プレビューはCtrl-Cで停止します。
`TITLE_CHECK_HEADFUL=1` でタイトル検証のブラウザを表示できます。

## 旧仕様の検証

次の4本は [archive/](archive/README.md) に保管しました。現行版の回帰検証には使いません。

- `angel_integration_check.py`、`angel_finish_check.py`: 全土地が解放済みで各5語、会話・ボスなしという旧仕様。
- `stage1_combat_check.py`、`stage1_frame_cost_check.py`: 旧ステージ1のSVG構造と固定周期の攻防演出。

全7章の会話・ボス・解放を含むブラウザ統合検証への更新は未実施です。
過去の実行結果は [確認資料の保管先](../docs/review/archive/zip-integration-edd518b.md) にあります。
現行の確認結果は [整理・検証記録](../docs/review/cleanup-20261016.md) を参照してください。
実物IME・読み上げ・物理入力遅延・GPU性能は自動検証の対象外です。
