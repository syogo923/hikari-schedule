# 光ポータル Ver1.1

光スケジュール Ver1.0を基に、社内用ポータルへ拡張した版です。

## 追加機能
- ホーム／予定表／納期管理の画面切替
- 納期案件の登録・編集・削除
- 本日納期、期限超過、7日以内、完了済みの集計
- 完了／未完了のワンタッチ切替
- 優先度、得意先、メモの登録
- 従来の社長予定表とPWA機能を維持

## GitHub / Netlify
展開後の中身をGitHubリポジトリ直下へアップロードしてください。Netlify設定は `netlify.toml` が自動認識します。

- Publish directory: `public`
- Functions directory: `netlify/functions`

既存の予定データは従来の `hikari-schedule / events-v1` を使用するため、そのまま維持されます。納期データは別領域に保存されます。
