# アーキテクチャ図の補足（日本語）

このプロジェクトの draw.io 図は、`architecture.drawio` です。

## 今回の反映内容

- 対象: `Source Collector (src/sourceCollector.js)` の補足説明
- 追記内容: `honto: URL-priority dedupe`

## 何を意味するか

- honto（ジュンク堂ランキング相当）の重複判定は、タイトル優先ではなく URL 優先です。
- そのため、同じタイトルでも URL が異なる商品は別アイテムとして残ります。
- 目的は、ランキング取得時の取りこぼし（抜け）を減らすことです。

## 影響範囲

- 変更は `parseHontoRanking` の重複判定ロジックに限定されます。
- X 取得ロジック（`collectXGrok` / `x_grok`）には影響しません。
