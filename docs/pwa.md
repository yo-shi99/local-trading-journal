# PWA / GitHub Pages

公開先は `main` の `/ (root)`。ビルドや外部ライブラリは不要です。

## Androidで使う

1. 公開後、Chromeで `https://yo-shi99.github.io/local-trading-journal/` をオンラインで開く。
2. 初回の静的ファイル取得が終わってから、Chromeメニューの「アプリをインストール」または「ホーム画面に追加」を選ぶ。
3. 追加したアイコンから起動する。manifestの `display: standalone` に対応したインストールではアドレスバーが表示されない。
4. 機内モードで再起動し、一覧・編集・画像表示を試す。

通常のブラウザタブから開いた場合はアドレスバーが表示されます。インストールメニューの表記・表示条件はChromeのバージョンや端末によって異なります。
初回アクセスはオンラインが必要です。Service Workerの登録・キャッシュ作成が完了する前のオフライン起動はできません。

## パスとデータ

- manifestの `id`・`start_url`・`scope` は `./`。manifestの置かれた `/local-trading-journal/` に解決される。
- Service Workerは `js/pwa.js` の位置からリポジトリルートを解決して登録する。HTTPSまたはlocalhostの安全なコンテキストでのみ登録する。`file://` では従来のジャーナル動作を維持する。
- Service Workerは明示したHTML・CSS・JavaScript・manifest・バージョン情報・アイコンだけを事前キャッシュする。
- IndexedDB、画像Blob、バックアップJSON、外部APIはキャッシュ対象外。取引・添付画像の保存方式、データベース名・スキーマは変更しない。
- GitHub Pagesは静的配信のみ。非表示のSignal Intelのローカルサーバー機能は対象外。
- インストールと通常タブは同一オリジンのIndexedDBを使用する。PC・localhost・別ブラウザのデータは自動同期しない。
- サイトデータ削除や端末のストレージ整理でローカルデータが消える場合がある。JSONバックアップを保管する。

## 更新方法

1. キャッシュ対象ファイルを変更したら `sw.js` の `CACHE_VERSION` を必ず変更する。
2. アプリのバージョンを上げる場合は `version.json`、`index.html`、`js/app.js` の表示・定数も合わせる。
3. 新しい静的ファイルを追加・削除した場合は `sw.js` の `APP_FILES` も更新する。
4. 公開後、オンラインでアプリを開くとChromeが更新を確認し、新版を準備する。端末やChromeの確認間隔により即時反映とは限らない。
5. 保存を済ませ、アプリのウィンドウと同じサイトのChromeタブをすべて閉じ、開き直す。新Service Workerが有効化され、このアプリの旧バージョンキャッシュだけが削除される。

編集中の画面を強制再読み込みせず、`skipWaiting()` も使わない。更新の全ファイル取得に失敗した場合は旧版を維持する。キャッシュ削除処理はIndexedDBや他アプリのキャッシュに触れない。

## 検証

`node tests/pwa.cjs`（PlaywrightとChromiumが利用できる環境）で、実際のService Workerをlocalhostの安全なオリジンとGitHub Pages想定パスで検証する。

- manifest認識、アイコン定義、start_url/scope、Service Worker登録・有効化
- オフライン再読み込み・取引一覧・編集・新規登録・解析貼り付け
- 画像の圧縮保存・再読み込み・サムネイル・拡大
- IndexedDB保持・オンライン復帰・JSONバックアップ／復元
- 更新待機・新版への切替・旧キャッシュ削除・他キャッシュ保持
- 更新失敗後の旧版オフライン起動・取引と画像の保持

ブラウザのモバイルエミュレーションでの検証であり、実際のGitHub Pagesへの公開、Androidのインストール操作・standalone起動は公開後に実機で確認する。
