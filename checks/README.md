# 天使版のブラウザ検証

通常の確認は、既存のNode依存だけで実行できます。

```sh
npm test -- --maxWorkers=1
npm run build
```

追加のブラウザ検証は、Python PlaywrightとChromium系のブラウザがすでに利用できる環境で行います。
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
python3 checks/angel_integration_check.py http://127.0.0.1:5180 /tmp/angel-integration-next
python3 checks/angel_finish_check.py http://127.0.0.1:5180 /tmp/angel-finish-next
python3 checks/angel_real_timer_check.py http://127.0.0.1:5180 /tmp/angel-timer-next
```

| 検証 | 対象 |
| --- | --- |
| `angel_integration_check.py` | 7土地、入力境界、停止、保存失敗・回復・遅い完了、計測・長文・分析、画像・音声故障 |
| `angel_finish_check.py` | 4長文、5つの小画面サイズ、次の土地・最後の土地、設定・停止の往復と中断保存 |
| `angel_real_timer_check.py` | 実時計での60秒計測、自動終了、キーイベントとメタ情報の保存 |

人工データと新しいブラウザコンテキスト、固有のQAデータベースだけを使用します。
既存のユーザープロファイルは読み取りません。スクリーンショットとJSONは出力先に保存します。
終了後は検証ブラウザを閉じ、プレビューは起動端末のCtrl-Cで停止します。

過去の [クラウド統合確認](../docs/review/angel-integration.md) と
[Mac確認](../docs/review/local-mac-20261006.md) は当時の記録です。
現在の [整理後の確認](../docs/review/cleanup-20261006.md) と区別してください。
自動ブラウザ検証は実物のIME、読み上げソフト、物理入力・描画遅延を測りません。
