# 天使版のブラウザ検証

通常の確認は、既存のNode依存だけで実行できます。

```sh
npm test -- --maxWorkers=1
npm run build
```

追加のブラウザ検証にはPython PlaywrightとChromium系のブラウザを使います。
このMacではプロジェクトの `.venv` にPlaywrightをインストール済みです。
別の端末では、プロジェクトのルートで次の準備を行います。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r checks/requirements.txt
```

[Playwrightの公式導入手順](https://playwright.dev/python/docs/library)も参照できます。
これらはアプリの依存ではありません。検証スクリプトはブラウザをダウンロードしません。
Macではインストール済みのGoogle Chrome、Linuxではインストール済みのChromiumを自動選択します。
それ以外はPlaywrightの既存のChromiumを使います。
別の実行体は `CHROMIUM_EXECUTABLE` にパスを指定できます。

別の端末で本番プレビューを起動:

```sh
npm run preview -- --host 127.0.0.1 --port 5180 --strictPort
```

検証は順番に実行し、出力先は毎回まだ存在しない新しいフォルダを指定します。

```sh
.venv/bin/python checks/angel_integration_check.py http://127.0.0.1:5180 /tmp/angel-integration-next
.venv/bin/python checks/angel_finish_check.py http://127.0.0.1:5180 /tmp/angel-finish-next
.venv/bin/python checks/angel_real_timer_check.py http://127.0.0.1:5180 /tmp/angel-timer-next
.venv/bin/python checks/stage1_combat_check.py http://127.0.0.1:5180 /tmp/stage1-combat-next
.venv/bin/python checks/stage1_frame_cost_check.py http://127.0.0.1:5180 /tmp/stage1-frame-cost-next.json
```

| 検証 | 対象 |
| --- | --- |
| `angel_integration_check.py` | 7土地、入力境界、停止、保存失敗・回復・遅い完了、計測・長文・分析、画像・音声故障 |
| `angel_finish_check.py` | 4長文、5つの小画面サイズ、次の土地・最後の土地、設定・停止の往復と中断保存 |
| `angel_real_timer_check.py` | 実時計での60秒計測、自動終了、キーイベントとメタ情報の保存 |
| `stage1_combat_check.py` | ステージ1の軌道・防御と衝撃の形・接触時間・強打の持続、全打鍵保存、演出ON/OFFのログ一致、小画面、低負荷・動き軽減 |
| `stage1_frame_cost_check.py` | 他のブラウザ検証終了後、3組の新規コンテキストでJSフレーム処理時間を測定。物理遅延やGPU/FPSは測らない |

人工データと新しいブラウザコンテキスト、固有のQAデータベースだけを使用します。
既存のユーザープロファイルは読み取りません。スクリーンショットとJSONは出力先に保存します。
終了後は検証ブラウザを閉じ、プレビューは起動端末のCtrl-Cで停止します。

現在のステージ1攻防演出を含む検証結果は [ZIP統合確認](../docs/review/zip-integration-edd518b.md) にあります。
過去の [クラウド統合確認](../docs/review/archive/angel-integration.md)、
[Mac確認](../docs/review/archive/local-mac-20261006.md)、
[旧版削除の確認](../docs/review/archive/cleanup-20261006.md) は当時の記録です。
自動ブラウザ検証は実物のIME、読み上げソフト、物理入力・描画遅延を測りません。
