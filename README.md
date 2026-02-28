# Today's InSaito

出版業界とその周辺業界の話題を、低コスト中心で横断収集するWebアプリです。

- テーマは固定: `出版業界と周辺業界`
- 毎日 `08:00 JST` と `16:00 JST` に GitHub Actions が自動収集・GitHub Pagesに公開
- `08:00 JST`: 全ソース更新（記事 / X / ランキング / セール）
- `16:00 JST`: 記事 + X を再取得し、ランキング/セールは直近データを維持
- 収集ソース: Google News RSS / 各書店ランキング / Yahoo! フォロー / はてブ / 新文化オンライン / HON.jp / Kindle日替わりセール / 任意で X(Grok)

## GitHub Pages への公開（社内限定ログイン）

### 1. GitHub側の設定

1. リポジトリ **Settings → Pages** → Source を **「GitHub Actions」** に変更
2. **Settings → Secrets and variables → Actions** で以下を登録:
   - Secrets:
     - `XAI_API_KEY`（xAI APIキー）
     - `FIREBASE_SERVICE_ACCOUNT_JSON`（FirebaseサービスアカウントJSON全文）
   - Variables:
     - `XAI_MODEL`（例: `grok-4-1-fast-non-reasoning`）
     - `SOURCE_ENABLE_X`（`1` か `0`）
     - `FIREBASE_API_KEY`
     - `FIREBASE_AUTH_DOMAIN`
     - `FIREBASE_PROJECT_ID`
     - `FIREBASE_APP_ID`
     - `FIREBASE_STORAGE_BUCKET`（任意）
     - `FIREBASE_MESSAGING_SENDER_ID`（任意）
     - `FIREBASE_MEASUREMENT_ID`（任意）
     - `FIREBASE_SNAPSHOT_DOC_PATH`（任意、既定 `snapshots/latest`）
     - `APP_ALLOWED_EMAIL_DOMAIN`（任意、既定 `kodansha.co.jp`）

### 2. Firebase側の設定（初回のみ）

1. Firebaseプロジェクトを作成
2. **Authentication → Sign-in method** で Google を有効化
3. **Authentication → Settings → Authorized domains** に `*.github.io` 側の実ドメインを追加
4. Firestoreを作成
5. Firestoreルールを [`firestore.rules`](firestore.rules) の内容で反映
6. サービスアカウント鍵(JSON)を発行し、`FIREBASE_SERVICE_ACCOUNT_JSON` に登録

※ `FIREBASE_SNAPSHOT_DOC_PATH` を `snapshots/latest` 以外に変更する場合は、`firestore.rules` の対象パスも同じ構造に合わせてください。

### 3. 初回デプロイ

GitHub の **Actions タブ → Deploy to GitHub Pages → Run workflow** で手動実行。
完了後、Pages の URL（`https://<user>.github.io/<repo>/`）で公開されます。
ページは Google ログインが必須で、`@kodansha.co.jp` 以外は閲覧不可です。

### 4. 以降は自動

毎日 `08:00 JST`（全ソース）と `16:00 JST`（記事+X更新）に自動収集・デプロイされます。
手動で即時更新したい場合も `workflow_dispatch` から実行できます。
データは Firestore に公開され、`public/snapshot.json` はPages成果物に含まれません。

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `XAI_API_KEY` | 任意 | X(Grok) 収集を使う場合 |
| `XAI_MODEL` | 任意 | 既定値 `grok-4-1-fast-non-reasoning` |
| `SOURCE_ENABLE_X` | 任意 | `0` で X収集を無効化 |
| `ENABLED_SOURCE_IDS` | 任意 | 収集元IDを絞り込み（カンマ区切り） |
| `SOURCE_HTTP_TIMEOUT_MS` | 任意 | 外部取得タイムアウト（ms） |
| `SOURCE_CONCURRENCY` | 任意 | 並列収集数 |
| `SOURCE_MAX_RESPONSE_BYTES` | 任意 | 外部レスポンス上限（byte） |
| `XAI_TIMEOUT_MS` | 任意 | xAI API タイムアウト（ms、既定 `30000`） |
| `XAI_RETRY_COUNT` | 任意 | xAI API の再試行回数（既定 `1`） |

## 主な構成

- `src/sourceCatalog.js`: ソース定義（Google News / 書店ランキング / RSS / Kindle deals）
- `src/sourceCollector.js`: マルチソース収集
- `src/signalDigest.js`: 重複排除 / スコアリング / クラスタ化
- `src/storage.js`: テーマとrun保存
- `scripts/generateSnapshotForPages.js`: GitHub Pages 用スナップショット生成
- `scripts/publishSnapshotToFirestore.js`: snapshot を Firestore に公開
- `firestore.rules`: `@kodansha.co.jp` 限定の参照ルール
- `.github/workflows/deploy-pages.yml`: 自動デプロイワークフロー
- `public/*`: Today's InSaito UI

詳細は `MANUAL.md` を参照してください。
