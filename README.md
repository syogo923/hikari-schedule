# 光スケジュール 完成版 v1.0

Netlify + Netlify Functions + Netlify Blobsで動作する、社内共有用の簡易スケジュールです。

## 機能

- 今日の予定表示
- 月間カレンダー
- 日付を選んで予定登録
- 予定の編集・削除
- 予定がある日の印
- 今後7日間の表示
- Windows / Mac / スマートフォン対応
- PWA対応
- 1分ごとの自動更新

## GitHubの正しい配置

GitHubリポジトリの一番上が、次の状態になるようにしてください。

```text
hikari-schedule/
├─ netlify/
│  └─ functions/
│     └─ schedules.mjs
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ style.css
│  ├─ sw.js
│  ├─ manifest.webmanifest
│  └─ icons/
├─ netlify.toml
├─ package.json
└─ README.md
```

`hikari-schedule-complete`というフォルダごと入れず、展開したフォルダの中身を全部選択してアップロードしてください。

## Netlify設定

GitHubリポジトリを選択してDeployします。通常は `netlify.toml` が自動認識されます。

手入力画面が出た場合：

- Base directory：空欄
- Build command：空欄
- Publish directory：`public`
- Functions directory：`netlify/functions`

## 注意

ログイン機能はありません。URLを知っている人は登録・編集・削除できます。公開サイトにはリンクせず、社内だけでURLを共有してください。
