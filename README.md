# Trend Atelier

詳細な説明書は `MANUAL.md` を参照してください。

記事の「Grok + GAS で毎朝トレンド収集」の考え方を、以下の要件で実装したローカルWebアプリです。

- オシャレなダッシュボードでトレンドを可視化
- 任意テーマを複数登録して自動集計
- xAI Grok (`x_search`) で 2段階検索（クラスタ抽出 → 再検索）

## できること

- テーマ管理
  - 追加 / 編集 / 削除
  - クエリ文字列、期間（日数）、自動収集ON/OFF
- 収集実行
  - 毎朝 7:00 JST に enabled テーマを自動実行
  - 手動で単一テーマ or 全テーマ実行
- ダッシュボード表示
  - クラスター（最大5）
  - materials（いいね順上位10）
  - 実行履歴（最新10件）

## クイックスタート

```bash
cp .env.example .env
# .env に XAI_API_KEY を設定
npm run start
```

起動後: `http://localhost:3000`

デモ表示を先に確認したい場合:
```bash
npm run demo:seed
```

## 環境変数

- `XAI_API_KEY` (必須): xAI API key
- `XAI_MODEL` (任意): 既定値 `grok-4-1-fast`
- `PORT` (任意): 既定値 `3000`
- `RUN_ON_START` (任意): `1` のとき起動時に scheduler tick を1回実行

## 実装構成

- `server.js`: HTTPサーバー / API / 静的配信
- `src/xaiClient.js`: xAI Responses API 呼び出し + JSON抽出
- `src/trendService.js`: テーマ単位の収集処理
- `src/scheduler.js`: 毎朝 7:00 JST 実行
- `src/storage.js`: テーマ・収集結果のローカル保存（`data/*.json`）
- `public/*`: ダッシュボードUI

## API

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/themes`
- `POST /api/themes`
- `PATCH /api/themes/:id`
- `DELETE /api/themes/:id`
- `POST /api/run` (`{ "themeId": "..." }` で単一、body空で全テーマ)
- `GET /api/runs?themeId=...&limit=10`

## 注意

- 本実装はデータ保存先をローカルJSONにしています。
- 本番運用する場合は DB 化（PostgreSQL など）と認証を推奨します。
