# Today's InSaito マニュアル

## 1. 概要

`Today's InSaito` は、**出版業界とその周辺業界**の話題を横断収集して表示するアプリです。
テーマは固定で、ユーザーがテーマを選んだり設定を開いたりする必要はありません。

- 表示名: `Today's InSaito`
- 毎日 `08:00 JST` / `16:00 JST` に GitHub Actions が自動収集・GitHub Pagesに公開（Googleログイン必須）
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

1. 画面を開くとGoogleログイン画面が表示されます。
2. `@kodansha.co.jp` のGoogleアカウントでログインすると最新データが表示されます。
3. カードを押すと元記事・元投稿へ遷移します。

表示される主な情報:
- 今日の短文サマリー
- トピックタグ
- ソース混在のフィード（ニュース / レビュー / ランキング / PR / セールなど）

## 4. セットアップ（GitHub Pages版）

1. リポジトリ **Settings → Pages** → Source を **「GitHub Actions」** に変更
2. Firebaseプロジェクトを作成
3. Firebase Authentication で Googleログインを有効化
4. Firebase Authentication の Authorized domains に Pagesドメインを追加
5. Firestoreを作成し、`firestore.rules` を反映
6. サービスアカウント鍵(JSON)を作成
7. **Settings → Secrets and variables → Actions** で以下を登録:
   - **Secrets**
     - `XAI_API_KEY`（xAI APIキー）
     - `FIREBASE_SERVICE_ACCOUNT_JSON`（サービスアカウントJSON全文）
   - **Variables**
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
8. **Actions タブ → Deploy to GitHub Pages → Run workflow** で初回デプロイ
9. 以降は毎日 `08:00 JST`（全ソース）と `16:00 JST`（記事+X更新）に自動実行

#### Firebase設定の詳細手順（初回のみ）

1. Firebaseコンソールでプロジェクトを作成
2. **Authentication → Sign-in method → Google** を有効化
3. **Authentication → Settings → Authorized domains** に、Pagesの実ドメイン（例: `k-saito-stack.github.io`）を追加
4. **Firestore Database** を作成（リージョンは任意）
5. **Firestore Database → Rules** に `firestore.rules` の内容を貼り付けて公開
6. **Project settings → Service accounts → Generate new private key** で鍵JSONを取得
7. 取得したJSON全文を GitHub Secret `FIREBASE_SERVICE_ACCOUNT_JSON` に登録

> 注意:
> - サービスアカウントJSONは機密情報です。リポジトリにコミットしないでください。
> - Firestoreの参照許可は `@kodansha.co.jp` のみです（ルール側で強制）。
> - `FIREBASE_SNAPSHOT_DOC_PATH` を `snapshots/latest` 以外にする場合は、ルール対象パスも同時に変更してください。

## 5. 運用メモ

- Actions の `schedule` は数分〜数十分遅延することがあります。
- データは Firestore から読みます。`public/snapshot.json` は配信されません。
- 外部サイト都合で一部ソースが失敗しても、他ソースは継続します。

## 6. 開発者向け主要ファイル

- `src/storage.js`: テーマ管理とrun保存
- `src/sourceCatalog.js`: 収集ソース定義
- `src/sourceCollector.js`: 並列収集処理
- `src/signalDigest.js`: 統合整形
- `scripts/generateSnapshotForPages.js`: GitHub Pages用スナップショット生成
- `scripts/publishSnapshotToFirestore.js`: Firestoreへsnapshot公開
- `firestore.rules`: Firestoreアクセス制御（`@kodansha.co.jp` 限定）
- `.github/workflows/deploy-pages.yml`: 自動デプロイワークフロー
- `public/index.html`, `public/app.js`, `public/styles.css`: UI
