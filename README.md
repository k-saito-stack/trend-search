# Trend Atelier

出版業界とその周辺業界の話題を、低コスト中心で横断収集するローカルWebアプリです。

- テーマは固定: `出版業界と周辺業界`
- 毎朝 `09:00 JST` に自動実行
- それ以外は `Refresh` ボタンで都度実行
- 収集ソース: Google News RSS / Amazonランキング / 任意で X(Grok)

## クイックスタート

```bash
cp .env.example .env
npm run start
```

起動後: `http://localhost:3000`

## 環境変数

- `XAI_API_KEY` (任意): X(Grok) 収集を使う場合
- `XAI_MODEL` (任意): 既定値 `grok-4-1-fast`
- `HOST` (任意): 既定値 `127.0.0.1`（ローカルのみ待受）
- `SOURCE_ENABLE_X` (任意): `0` で X収集を無効化
- `ENABLED_SOURCE_IDS` (任意): 収集元IDを絞り込み
- `SOURCE_HTTP_TIMEOUT_MS` (任意): 外部取得タイムアウト（ms）
- `SOURCE_CONCURRENCY` (任意): 並列収集数
- `SOURCE_MAX_RESPONSE_BYTES` (任意): 外部レスポンス上限（byte）
- `RUN_API_TOKEN` (任意): `POST /api/run` の共有トークン認証
- `RUN_AUTH_PROXY_HEADER` (任意): 逆プロキシ認証済みヘッダー名（例: `x-forwarded-user`）
- `RUN_MIN_INTERVAL_MS` (任意): 手動実行の最小間隔（ms、既定 `30000`）
- `PORT` (任意): 既定値 `3000`
- `RUN_ON_START` (任意): `1` のとき起動時に scheduler tick を1回実行

## API

- `GET /api/snapshot`: 現在の topic と最新run
- `POST /api/run`: 手動Refresh実行（同時実行禁止・レート制限あり）
  - `RUN_API_TOKEN` 設定時は `Authorization: Bearer <token>` または `X-Run-Token: <token>` が必要
  - `RUN_AUTH_PROXY_HEADER` 設定時は当該ヘッダーが必要
- `GET /api/runs?limit=10`: 最新履歴
- `GET /api/sources`: 有効な収集ソース一覧
- `GET /api/health`: 状態確認

## 主な構成

- `src/sourceCatalog.js`: ソース定義
- `src/sourceCollector.js`: マルチソース収集
- `src/signalDigest.js`: 重複排除 / スコアリング / クラスタ化
- `src/scheduler.js`: 09:00 JST 自動実行
- `src/storage.js`: 固定テーマと run 保存
- `public/*`: Today’s Insights UI

詳細は `MANUAL.md` を参照してください。
