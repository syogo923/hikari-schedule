光スケジュール Web版 v1.0

【機能】
・月間カレンダー
・予定がある日に印を表示
・他の日付への予定追加
・予定の編集、削除
・1分ごとの自動更新
・Windows / Mac / スマートフォン対応
・PWA対応（アプリ風にインストール可能）
・ログインなし

【Netlifyへの公開方法】
このアプリはNetlify FunctionsとNetlify Blobsを使うため、GitHub連携またはNetlify CLIでの公開を推奨します。

方法A：GitHub連携
1. このフォルダの中身をGitHubの新規リポジトリへアップロードします。
2. Netlifyで「Add new project」→「Import an existing project」を選びます。
3. GitHubのリポジトリを選択してDeployします。
4. netlify.tomlが設定を自動認識します。

方法B：Netlify CLI
1. Node.jsをインストールします。
2. このフォルダで npm install
3. npm install -g netlify-cli
4. netlify login
5. netlify deploy --prod

【パソコン起動時に開く】
公開後のURLをWindowsのスタートアップに登録します。
Win + R → shell:startup → URLのショートカットを入れます。

【重要】
ログインなしのため、URLを知っている人は予定の追加・編集・削除ができます。
会社の公開ホームページにはURLを掲載せず、社内だけで共有してください。
