# 旧仕様のブラウザ検証

2026-10-16に現行の検証から分離しました。削除せず、当時の期待値と確認範囲を残しています。

| ファイル | 当時の対象 |
| --- | --- |
| `angel_integration_check.py` | 各5語の7土地、旧入力画面、保存失敗と回復、長文・分析 |
| `angel_finish_check.py` | 旧長文と小画面、5語道中の遷移と保存 |
| `stage1_combat_check.py` | 旧ステージ1のSVG構造、固定周期の予兆・防御・衝撃 |
| `stage1_frame_cost_check.py` | 同じ旧SVGのJSフレーム処理時間 |

`dafc599` 頃の仕様を対象とした資料です。現在の7章の会話・ボス・解放条件や横視点描画とは期待値が異なります。
現行の実行手順は [checks/README.md](../README.md)、当時の結果は
[ZIP統合確認](../../docs/review/archive/zip-integration-edd518b.md) を参照してください。

共通の `browser_support.py` は親フォルダにあります。過去版に対してこれらを再利用する場合は、
プロジェクトルートで `PYTHONPATH=checks` を指定して実行します。
