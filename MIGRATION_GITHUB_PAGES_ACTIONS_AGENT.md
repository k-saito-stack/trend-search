# GitHub Pages + Actions 移行指示書（コーディングエージェント向け）

## 0. 目的
- このプロジェクトを「ローカル実行前提」から「URL共有できる公開運用」へ移行する。
- 低コスト（できるだけ無料）を優先し、インフラは GitHub Pages + GitHub Actions を使う。
- xAI API の課金は別扱い（必要に応じて `SOURCE_ENABLE_X=0` で無効化可能）。

## 1. 現在構成（事実）
- フロントは `public/app.js` で API を直接呼んでいる。
  - `GET /api/snapshot` を読む: `public/app.js` の `loadSnapshot()`
  - `POST /api/run` を叩く: `public/app.js` の `refresh()`
- バックエンドは `server.js`（Node HTTP サーバ）。
  - `/api/health`, `/api/snapshot`, `/api/run`, `/api/runs` がある。
- データはローカルファイル保存（`data/themes.json`, `data/trends.json`）。
  - 実装: `src/storage.js`

## 2. 目標構成（移行後）
- **配信**: GitHub Pages（静的ファイルのみ）
- **定期更新**: GitHub Actions の `schedule`（毎日08:00 JST、1日1回） + `workflow_dispatch`
- **データ取得**: Actions が `snapshot.json` を生成して `public/` に置く
- **ブラウザ表示**: `public/app.js` は `snapshot.json` を読む
- **秘密情報**: APIキーは GitHub Secrets（`.env` はコミットしない）

## 3. 非目標
- 常時起動の Node API サーバは Pages 上では提供しない。
- `/api/run` のリアルタイム手動実行は Pages では提供しない。
  - 代替: `workflow_dispatch`（GitHub Actions手動実行）

## 4. 実装方針（段階移行）
- 既存ローカル開発は壊さない（後方互換）。
- 「静的モード」と「ローカルAPIモード」を共存させる。
- フロントは `snapshot.json` 優先、失敗時のみ `/api/snapshot` へフォールバック。

## 5. 変更タスク（必須）

### 5.1 スナップショット生成スクリプトを追加
- 新規作成: `scripts/generateSnapshotForPages.js`
- 処理要件:
  1. `loadDotEnv()` を読む
  2. `readPrimaryTheme()` で対象テーマ取得
  3. `runTheme(theme, { apiKey, model })` を実行
  4. 以下のJSONを `public/snapshot.json` に UTF-8 で保存
     - `now`
     - `timezone` (`Asia/Tokyo`)
     - `topic`
     - `latestRun`
- 注意:
  - `latestRun` の構造は既存 `/api/snapshot` レスポンス互換にする。
  - 例外時は `process.exit(1)` で workflow を失敗させる。

### 5.2 package.json に pages 用スクリプト追加
- `package.json` に以下を追加:
  - `build:pages`: `node scripts/generateSnapshotForPages.js`

### 5.3 フロントのデータ読み込みを二段構えに変更
- 変更対象: `public/app.js`
- 方針:
  1. まず `/snapshot.json` を読む（Pages運用）
  2. 失敗したら `/api/snapshot` を読む（ローカル運用）
- 追加要件:
  - 静的モードでは Refresh ボタンを削除し、「毎日08:00 JSTの自動更新」である旨を表示。
  - 既存のローカルモード（`/api/run`）は保持する。

### 5.4 GitHub Actions workflow 追加
- 新規作成: `.github/workflows/deploy-pages.yml`
- 必須要件:
  - `on`:
    - `workflow_dispatch`
    - `schedule`（毎日08:00 JST、UTC cron: `0 23 * * *`）
  - `permissions`:
    - `contents: read`
    - `pages: write`
    - `id-token: write`
  - `concurrency` を設定（重複実行防止）
  - 実行ステップ:
    1. `actions/checkout`
    2. `actions/setup-node`（Node 20）
    3. `npm ci`
    4. `npm run build:pages`
    5. `actions/configure-pages`
    6. `actions/upload-pages-artifact`（`public`）
    7. `actions/deploy-pages`
  - 環境変数は Secrets から渡す:
    - `XAI_API_KEY`（任意）
    - `XAI_MODEL`
    - `SOURCE_ENABLE_X`

### 5.5 README / MANUAL 更新
- 以下を追記:
  - Pages URL の見方
  - 更新は Actions で行うこと
  - `workflow_dispatch` の手動実行手順
  - Secrets 設定手順
  - `SOURCE_ENABLE_X=0` で無料運用寄りにできる説明

## 6. GitHub 側の設定（手動作業）
- リポジトリ Settings > Pages:
  - Source: GitHub Actions
- Settings > Secrets and variables > Actions:
  - `XAI_API_KEY`（必要なら）
  - `XAI_MODEL`（例: `grok-4-1-fast-non-reasoning`）
  - `SOURCE_ENABLE_X`（`0` か `1`）

## 7. 受け入れ基準（Acceptance Criteria）
- 公開URLを開くと画面が表示される。
- `snapshot.json` が Pages 上に存在し、UIがその内容を表示できる。
- Actions が毎日08:00 JSTに1回実行され、`lastUpdated` が更新される。
- ローカル実行（`npm run start`）時は従来通り `/api/*` が使える。
- `.env` や APIキーがコミットされていない。

## 8. セキュリティ要件（必須）
- `.env` を絶対にコミットしない。
- APIキーは GitHub Secrets でのみ扱う。
- ログにキーを出力しない。
- PR差分で `xai-` 文字列や `API_KEY=` が混入していないか確認する。

## 9. 想定リスクと対処
- リスク: Actionsの `schedule` は遅延することがある。
  - 対処: `workflow_dispatch` を併用。
- リスク: xAI API 失敗時に snapshot が更新されない。
  - 対処: workflow fail を通知し、前回 snapshot は維持。
- リスク: 同時実行で API コスト増。
  - 対処: workflow `concurrency` を必須化。

## 10. 実装後チェック手順
1. ローカル:
   - `npm ci`
   - `npm test`
   - `npm run build:pages`
   - `public/snapshot.json` が生成されることを確認
2. GitHub:
   - `workflow_dispatch` 実行
   - Pages URL の表示確認
   - 更新時刻・内容が反映されることを確認

## 11. 作業完了時の成果物
- 追加:
  - `scripts/generateSnapshotForPages.js`
  - `.github/workflows/deploy-pages.yml`
- 変更:
  - `public/app.js`
  - `package.json`
  - `README.md`（必要なら `MANUAL.md` も）

---
この指示書は「将来、別のコーディングエージェントが読んでそのまま移行作業する」前提で作成。
