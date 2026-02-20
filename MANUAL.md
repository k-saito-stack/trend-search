# Trend Atelier マニュアル

## 1. 概要

`Trend Atelier` は、**出版業界とその周辺業界**の話題を横断収集して表示するアプリです。  
テーマは固定で、ユーザーがテーマを選んだり設定を開いたりする必要はありません。

- 表示名: `Today's Insights`
- 自動実行: 毎朝 `09:00 JST`
- 手動実行: `Refresh` ボタン

## 2. 収集対象（低コスト優先）

- Google News RSS（出版全般 / PR / 書評 / 人事 / TV / ラジオ / 流通など）
- Amazonランキング（本 / Kindle）
- X(Grok)（任意。APIキー設定時のみ）

## 3. 画面の使い方

1. 画面を開くと最新runが表示されます。
2. 日中に更新したい時は `Refresh` を押します。
3. カードを押すと元記事・元投稿へ遷移します。

表示される主な情報:
- 今日の短文サマリー
- トピックタグ
- ソース混在のフィード（ニュース/レビュー/ランキング/PRなど）

## 4. API

### 4.1 現在状態
```http
GET /api/snapshot
```

### 4.2 手動実行（Refresh）
```http
POST /api/run
Content-Type: application/json

{}
```

### 4.3 実行履歴
```http
GET /api/runs?limit=10
```

### 4.4 収集ソース一覧
```http
GET /api/sources
```

### 4.5 ヘルス
```http
GET /api/health
```

## 5. セットアップ

```bash
cp .env.example .env
npm run start
```

必要に応じて `.env` を編集:

```env
XAI_API_KEY=YOUR_XAI_API_KEY
XAI_MODEL=grok-4-1-fast
SOURCE_ENABLE_X=1
# ENABLED_SOURCE_IDS=news_publish_general,news_pr_times,ranking_amazon_books
# SOURCE_HTTP_TIMEOUT_MS=12000
# SOURCE_CONCURRENCY=4
PORT=3000
RUN_ON_START=0
```

## 6. 運用メモ

- サーバーが `09:00 JST` に起動していないと自動実行されません。
- 外部サイト都合で一部ソースが失敗しても、他ソースは継続します。
- データは `data/trends.json` に保存されます（上限1000件）。

## 7. 開発者向け主要ファイル

- `server.js`: APIと静的配信
- `src/storage.js`: 固定テーマ管理とrun保存
- `src/sourceCatalog.js`: 収集ソース定義
- `src/sourceCollector.js`: 並列収集処理
- `src/signalDigest.js`: 統合整形
- `src/scheduler.js`: 09:00 JST スケジュール
- `public/index.html`, `public/app.js`, `public/styles.css`: UI
