# Trend Atelier マニュアル

このドキュメントは、`Trend Atelier` の仕組みと運用方法をまとめた実践マニュアルです。

## 1. 何をするアプリか

`Trend Atelier` は、X（旧Twitter）の特定テーマのトレンドを毎日自動で収集し、ダッシュボードに可視化するアプリです。

主な特徴:
- 任意テーマを複数登録できる（例: `現代新書`, `デザイン AI`, `生成AI 法務`）
- 毎朝 `7:00 JST` に自動収集
- 手動で「今すぐ収集」も可能
- クラスタ（話題の塊）と、いいね順の素材一覧を表示

## 2. 仕組み（アーキテクチャ）

```text
Browser Dashboard (public/*)
   ↓ REST API
Node Server (server.js)
   ├─ Theme/Run管理 (src/storage.js)
   ├─ スケジューラ 7:00 JST (src/scheduler.js)
   └─ Trend収集 (src/trendService.js)
           ↓
      xAI Responses API + x_search (src/xaiClient.js)
           ↓
      収集結果(JSON)
           ↓
      ローカル保存 (data/themes.json, data/trends.json)
```

### 2.1 検索ロジック（2段階）

1. Stage 1A: Latestで広く集める（新着の輪郭把握）
2. Stage 1B: Topで強い投稿を補完（バズの重心把握）
3. 1A+1Bからクラスター抽出（3〜5）
4. Stage 2: クラスター代表語で再検索
5. 各クラスター上位投稿と、全体materials上位10を整形

この設計で、単発バズだけでなく「話題のまとまり」を追えるようにしています。

## 3. データモデル

### Theme（追跡設定）
- `id`: テーマID
- `name`: 表示名
- `query`: 検索クエリ
- `periodDays`: 何日分を対象にするか（1〜30）
- `enabled`: 毎朝自動収集するか

### Run（1回の収集結果）
- `themeId`: 対象テーマ
- `queryWithSince`: 送信クエリ（例: `現代新書 since:2026-02-18`）
- `payload.clusters[]`: クラスター一覧
- `payload.materials[]`: いいね順の素材上位10
- `parseStatus`: JSON解析が成功したか

## 4. セットアップ

### 4.1 前提
- Node.js `20+`（推奨: 24系）
- xAI APIキー

### 4.2 起動手順

```bash
cp .env.example .env
```

`.env` を編集:

```env
XAI_API_KEY=YOUR_XAI_API_KEY
XAI_MODEL=grok-4-1-fast
PORT=3000
RUN_ON_START=0
```

起動:

```bash
npm run start
```

アクセス:
- `http://localhost:3000`

### 4.3 デモデータで画面確認（仮表示）

実データがまだ無い場合は、以下でダッシュボード確認用のサンプルRunを投入できます。

```bash
npm run demo:seed
```

補足:
- `data/trends.json` に最新3日分のデモ履歴を追加します
- 画面をリロードすると `Trend Clusters` / `Top Materials` / `履歴` が埋まります

## 5. 使い方（ダッシュボード）

### 5.1 画面構成（1画面）
- `Overview`: `Trend Clusters` / `Top Materials` を表示（内容だけを表示）
- `設定` パネル: `Current Snapshot` / `Theme Studio` / `Run History` を表示

### 5.2 テーマを追加
1. 右上の `設定` を開く
2. `Theme Studio` の `Add New Theme` で `テーマ（名前=クエリ）` を入力
2. `期間(日)` を入力
3. `追加` を押す

### 5.3 テーマを編集
1. 右上の `設定` を開く
2. `Theme List` から対象テーマを選択
2. `Selected Theme` で `テーマ（名前=クエリ）` と `期間(日)` を更新
3. `保存`

### 5.4 自動収集のON/OFF
- `毎朝7:00 JSTの自動収集を有効` のチェックで切替
- ONのテーマのみスケジューラ対象

### 5.5 今すぐ収集
- 単一テーマ: ヘッダーの `このテーマを収集`
- 全テーマ: ヘッダーの `有効テーマを収集`

### 5.6 結果の見方
- `Overview`:
`Trend Clusters`: 話題クラスタごとの代表語と投稿
`Top Materials`: 全体の注目投稿（いいね順）。X Widgetsで実ポストを埋め込み表示
- `設定` パネル:
`Current Snapshot`: 選択テーマの状態
`Run History`: 過去の実行記録（時刻・クエリ・パース状態）

## 6. 自動実行の仕様

- 毎分tickし、JSTの `07:00` に実行
- 同一テーマは同日重複実行を回避
- 1テーマ失敗しても他テーマは継続

補足:
- サーバーが停止中は収集されません
- 常時運用する場合は、PM2/systemd/コンテナなどで常駐化してください

## 7. APIマニュアル

### 7.1 ヘルス
```http
GET /api/health
```

### 7.2 現在状態（テーマ + 各テーマ最新Run）
```http
GET /api/snapshot
```

### 7.3 テーマ一覧
```http
GET /api/themes
```

### 7.4 テーマ追加
```http
POST /api/themes
Content-Type: application/json

{
  "name": "現代新書",
  "query": "現代新書",
  "periodDays": 2
}
```

### 7.5 テーマ更新
```http
PATCH /api/themes/:id
Content-Type: application/json

{
  "name": "現代新書ウォッチ",
  "query": "現代新書",
  "periodDays": 3,
  "enabled": true
}
```

### 7.6 テーマ削除
```http
DELETE /api/themes/:id
```

### 7.7 収集実行
全有効テーマ:
```http
POST /api/run
Content-Type: application/json

{}
```

単一テーマ:
```http
POST /api/run
Content-Type: application/json

{
  "themeId": "theme_xxx"
}
```

### 7.8 履歴取得
```http
GET /api/runs?themeId=theme_xxx&limit=10
```

## 8. 保存データ

- `data/themes.json`: テーマ設定
- `data/trends.json`: 収集履歴（最新1000件保持）

バックアップ推奨:
- 最低でも `data/` を日次バックアップ
- 将来はDB移行（PostgreSQL等）を推奨

## 9. 運用ガイド

### 9.1 日次運用
- 朝: ダッシュボードでクラスタ差分を確認
- 必要時: テーマや期間日数を調整
- 週次: 使っていないテーマを整理

### 9.2 クエリ設計のコツ
- 短く具体的に（例: `現代新書`）
- 余計な語を足しすぎない
- ノイズが多い場合は `periodDays` を短くする

### 9.3 コスト管理
- テーマ数と実行頻度でAPIコストが増える
- まずは重要テーマのみONで開始し、精度を見て増やす

## 10. セキュリティ

- APIキーは `.env` で管理し、リポジトリに含めない
- `.env` は共有しない
- 本番公開する場合は認証・認可を追加

## 11. トラブルシューティング

### Q1. `xAI key: 未設定` と表示される
- `.env` に `XAI_API_KEY` があるか確認
- サーバー再起動後に反映される

### Q2. 収集ボタンで失敗する
- APIキーの有効性と利用枠を確認
- しばらく待って再実行

### Q3. 自動収集されない
- サーバーが7:00 JST時点で起動しているか確認
- テーマの `enabled` がONか確認

### Q4. 結果が空になる
- テーマクエリが広すぎる/狭すぎる可能性
- `query` と `periodDays` を調整して再実行

### Q5. Top Materialsの埋め込みが出ない
- ネットワークで `platform.twitter.com` がブロックされていないか確認
- 埋め込み失敗時でもURLリンクから投稿を開けます

## 12. 開発者向け補足

主要ファイル:
- `server.js`: APIと静的配信
- `src/xaiClient.js`: xAI通信とレスポンス正規化
- `src/trendService.js`: テーマ単位の実行ユースケース
- `src/scheduler.js`: 毎朝実行ロジック
- `src/storage.js`: JSONストアI/O
- `public/*`: UI

テスト:
```bash
npm test
```

---

このマニュアルで不足があれば、次に「運用者向け（非エンジニア版）」と「開発者向け（拡張設計版）」の2冊構成にも分割できます。
