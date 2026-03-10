# 利用計測メモ

このアプリでは、継続判断に必要な最小限の利用記録を `usageEvents` コレクションに保存します。

## 記録する項目

- `app_view`: アプリを開いて内容の読み込みに成功した
- `engaged_30s`: 30秒以上そのページを見続けた
- `content_open`: 記事やランキング項目を開いた

各イベントには、次の情報を持たせています。

- `userEmail`: 使った人のメールアドレス
- `userUid`: Firebase のユーザーID
- `eventDate`: 日本時間の日付
- `sessionId`: そのときの閲覧単位
- `sourceName` / `sourceCategory` / `itemTitle`: どの情報を開いたか

## 見るとよい指標

- 直近28日の利用ユーザー数
- 直近7日の利用ユーザー数
- 2日以上使っている人の数
- `app_view` に対する `engaged_30s` の割合
- `content_open` が多いソース

## 集計コマンド

`FIREBASE_SERVICE_ACCOUNT_JSON` を設定したうえで、次を実行します。

```bash
npm run report:usage
```

期間を変える場合:

```bash
node scripts/reportUsageMetrics.js --days=14
```

## 反映時の注意

この変更を有効にするには、`firestore.rules` の更新内容を Firebase 側にも反映してください。
