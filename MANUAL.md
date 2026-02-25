# Today's InSaito マニュアル

## 1. 概要

`Today's InSaito` は、**出版業界とその周辺業界**の話題を横断収集して表示するアプリです。
テーマは固定で、ユーザーがテーマを選んだり設定を開いたりする必要はありません。

- 表示名: `Today's InSaito`
- **ローカル版**: 毎日 `08:00 JST` / `16:00 JST` に自動実行 + `Refresh` ボタンで手動実行
- **GitHub Pages版**: 毎日 `08:00 JST` / `16:00 JST` に GitHub Actions が自動収集・公開（Refreshボタンなし）
- `08:00 JST`: 全ソース更新（記事 / X / ランキング / セール）
- `16:00 JST`: 記事 + X を再取得し、ランキング/セールは直近データを維持

## 2. 収集対象

| ソース | 種別 |
|---|---|
| Google News RSS（出版全般 / PR / 書評 / 新刊 / 人事 / TV / ラジオ / 書店 / 電子書籍 / 流通 / 図書館 / 映像化 / 受賞） | ニュース |
| 新文化オンライン | 業界専門紙 RSS |
| HON.jp News Blog | 電子書籍専門 RSS |
| Yahoo! フォロー / 出版業界 | ニュース |
| はてなブックマーク / 本 | RSS |
| Amazonランキング（本 / Kindle） | ランキング |
| 楽天ブックスランキング | ランキング |
| 丸善ランキング / ジュンク堂ランキング | ランキング |
| 有隣堂ランキング | ランキング |
| トーハン週間ランキング | ランキング |
| Kindle日替わりセール | セール |
| X(Grok)（任意。APIキー設定時のみ） | SNS |

## 3. 画面の使い方

1. 画面を開くと最新runが表示されます。
2. 日中に更新したい時は `Refresh` を押します（ローカル版のみ）。
3. カードを押すと元記事・元投稿へ遷移します。

表示される主な情報:
- 今日の短文サマリー
- トピックタグ
- ソース混在のフィード（ニュース / レビュー / ランキング / PR / セールなど）

## 4. セットアップ

### ローカル版

```bash
cp .env.example .env
# .env を編集して設定
npm run start
```

`.env` の設定例:

```env
XAI_API_KEY=YOUR_XAI_API_KEY
XAI_MODEL=grok-4-1-fast-non-reasoning
HOST=127.0.0.1
SOURCE_ENABLE_X=1
# ENABLED_SOURCE_IDS=news_publish_general,news_pr_times,ranking_amazon_books
# SOURCE_HTTP_TIMEOUT_MS=12000
# SOURCE_CONCURRENCY=4
# SOURCE_MAX_RESPONSE_BYTES=2097152
RUN_API_TOKEN=replace-with-long-random-token
# RUN_MIN_INTERVAL_MS=30000
# XAI_TIMEOUT_MS=30000
# XAI_RETRY_COUNT=1
PORT=3000
RUN_ON_START=0
```

### GitHub Pages版

1. リポジトリ **Settings → Pages** → Source を **「GitHub Actions」** に変更
2. **Settings → Secrets and variables → Actions** で以下を登録:
   - **Secrets**: `XAI_API_KEY`（xAI APIキー）
   - **Variables**: `XAI_MODEL`（例: `grok-4-1-fast-non-reasoning`）、`SOURCE_ENABLE_X`（`1` か `0`）
3. **Actions タブ → Deploy to GitHub Pages → Run workflow** で初回デプロイ
4. 以降は毎日 `08:00 JST`（全ソース）と `16:00 JST`（記事+X更新）に自動実行

## 5. API（ローカル版）

### 現在状態
```http
GET /api/snapshot
```

### 手動実行（Refresh）
```http
POST /api/run
Content-Type: application/json

{}
```

- `POST /api/run` は常に `Authorization: Bearer <token>` または `X-Run-Token: <token>` が必要です。
- `RUN_API_TOKEN` が未設定の場合、サーバーは起動しません。

### 実行履歴
```http
GET /api/runs?limit=10
```

### 収集ソース一覧
```http
GET /api/sources
```

### ヘルス
```http
GET /api/health
```

## 6. 運用メモ

- **ローカル版**: サーバーが `08:00 JST` / `16:00 JST` に起動していないと自動実行されません。
- **GitHub Pages版**: Actions の `schedule` は数分〜数十分遅延することがあります。
- 外部サイト都合で一部ソースが失敗しても、他ソースは継続します。
- データは `data/trends.json` に保存されます（上限1000件、ローカル版のみ）。
- `POST /api/run` は同時実行されません。短時間連打時は `429` が返ります。
- `POST /api/run` は常にトークン認証が必要です。

## 7. 開発者向け主要ファイル

- `server.js`: APIと静的配信（ローカル版）
- `src/storage.js`: 固定テーマ管理とrun保存
- `src/sourceCatalog.js`: 収集ソース定義
- `src/sourceCollector.js`: 並列収集処理
- `src/signalDigest.js`: 統合整形
- `src/scheduler.js`: 08:00 / 16:00 JST スケジュール（ローカル版）
- `scripts/generateSnapshotForPages.js`: GitHub Pages用スナップショット生成
- `.github/workflows/deploy-pages.yml`: 自動デプロイワークフロー
- `public/index.html`, `public/app.js`, `public/styles.css`: UI
