# Trend Atelier

出版業界とその周辺業界の話題を、低コスト中心で横断収集するWebアプリです。

- テーマは固定: `出版業界と周辺業界`
- **GitHub Pages版**: 毎日 `08:00 JST` に GitHub Actions が自動収集・公開
- **ローカル版**: `09:00 JST` に自動実行 + `Refresh` ボタンで手動実行
- 収集ソース: Google News RSS / 各書店ランキング / Yahoo! フォロー / はてブ / 新文化オンライン / HON.jp / Kindle日替わりセール / 任意で X(Grok)

## クイックスタート（ローカル）

```bash
cp .env.example .env
# .env を編集して XAI_API_KEY などを設定
npm run start
```

起動後: `http://localhost:3000`

## GitHub Pages への公開

### 1. GitHub側の設定

1. リポジトリ **Settings → Pages** → Source を **「GitHub Actions」** に変更
2. **Settings → Secrets and variables → Actions** で以下を登録:
   - Secrets: `XAI_API_KEY`（xAI APIキー）
   - Variables: `XAI_MODEL`（例: `grok-4-1-fast-non-reasoning`）、`SOURCE_ENABLE_X`（`1` か `0`）

### 2. 初回デプロイ

GitHub の **Actions タブ → Deploy to GitHub Pages → Run workflow** で手動実行。
完了後、Pages の URL（`https://<user>.github.io/<repo>/`）で公開されます。

### 3. 以降は自動

毎日 `08:00 JST` に自動収集・デプロイされます。
手動で即時更新したい場合も `workflow_dispatch` から実行できます。

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `XAI_API_KEY` | 任意 | X(Grok) 収集を使う場合 |
| `XAI_MODEL` | 任意 | 既定値 `grok-4-1-fast-non-reasoning` |
| `SOURCE_ENABLE_X` | 任意 | `0` で X収集を無効化 |
| `HOST` | 任意 | 既定値 `127.0.0.1`（ローカルのみ待受） |
| `PORT` | 任意 | 既定値 `3000` |
| `ENABLED_SOURCE_IDS` | 任意 | 収集元IDを絞り込み（カンマ区切り） |
| `SOURCE_HTTP_TIMEOUT_MS` | 任意 | 外部取得タイムアウト（ms） |
| `SOURCE_CONCURRENCY` | 任意 | 並列収集数 |
| `SOURCE_MAX_RESPONSE_BYTES` | 任意 | 外部レスポンス上限（byte） |
| `RUN_API_TOKEN` | 任意 | `POST /api/run` の共有トークン認証 |
| `RUN_AUTH_PROXY_HEADER` | 任意 | 逆プロキシ認証済みヘッダー名 |
| `RUN_MIN_INTERVAL_MS` | 任意 | 手動実行の最小間隔（ms、既定 `30000`） |
| `RUN_ON_START` | 任意 | `1` のとき起動時に1回実行 |

## API（ローカル版）

- `GET /api/snapshot`: 現在の topic と最新run
- `POST /api/run`: 手動Refresh実行（同時実行禁止・レート制限あり）
- `GET /api/runs?limit=10`: 最新履歴
- `GET /api/sources`: 有効な収集ソース一覧
- `GET /api/health`: 状態確認

## 主な構成

- `src/sourceCatalog.js`: ソース定義（Google News / 書店ランキング / RSS / Kindle deals）
- `src/sourceCollector.js`: マルチソース収集
- `src/signalDigest.js`: 重複排除 / スコアリング / クラスタ化
- `src/scheduler.js`: 09:00 JST 自動実行（ローカル版）
- `src/storage.js`: 固定テーマと run 保存
- `scripts/generateSnapshotForPages.js`: GitHub Pages 用スナップショット生成
- `.github/workflows/deploy-pages.yml`: 自動デプロイワークフロー
- `public/*`: Today's Insights UI

詳細は `MANUAL.md` を参照してください。
