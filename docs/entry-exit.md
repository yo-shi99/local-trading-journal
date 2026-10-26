# Entry / Exit分離とlegacy baseline（第3段階）

## 保存構造と互換性

- Entry情報は従来の `cryptoJournal`、`legs`、タグ、原文等を維持する。既存キーの削除・名称変更・自動移動をしない。
- 旧 `cryptoJournal.review` は「振り返り（従来欄・Entry時メモ）」として保持・表示する。新しいExitレビューへコピーしない。
- 新しい任意の `trade.exitUpdate` は `{ review, reason, memo }` の文字列3項目。売買日時・価格・数量・損益は保存せず、`events` を正本とする。
- 添付画像は既存の `trade.screenshots` 配列を維持する。任意の `category` は `Entry` / `Update` / `Exit` / `Other`。categoryなし画像も読み込み・編集・保存・バックアップ復元でき、分類は自動付与しない。
- 新規取引にEntry eventを自動作成しない。第4段階から既存の `withTradeEvent` / `appendTradeEvent` を利用できる。

## Exit専用保存

編集画面に独立したExit理由・メモ・レビュー・更新画像の入力欄を追加した。

`Exit / Updateのみ保存（Entryは変更しません）` は保存済み取引向け。`saveTradeExitUpdate(id, fields, images)` が同じIndexedDB readwriteトランザクション内で最新取引を読み、Exitフィールド3項目と新画像だけを更新する。Entryフォームの未保存変更、Entry分析・原文・振り返り、Entry画像のドラフト上の削除は反映しない。既存画像は追加前の順番・分類・Blobを保持し、eventsにも書き込まない。メモリはトランザクション成功後だけ更新する。

通常の `Save Trade` は、明示的なEntry編集と独立したExitドラフトを一緒に保存する。新規取引はこのボタンを使用する。Exitフィールドが空で画像追加もなく元々exitUpdateがない場合は、新フィールドを勝手に付けない。

更新画像の追加欄ではUpdate/Exitを選ぶ。削除・再分類など既存画像の編集は従来の画像欄・保存APIで行う。Exit専用保存は過去の画像を削除しない。

## 読取時baseline

確認済みの方針：**明示的なEntry eventがなければ、Add Entryのみの履歴にも旧Entryをbaselineとして加える**。

利用条件は次のすべてを満たすこと。

1. eventsが非空配列で、第1段階の形式検証に通る。
2. 明示的な `Entry` eventが1件もない。
3. 旧Entryの価格・数量が有限の正数で、基準日時が有効。

基準元は暗号資産なら `cryptoJournal.entryPrice / positionSize / entryAt`。従来のフラット形式なら `entryPrice / quantity / entryAt` を使用し、日付だけの取引は当日00:00を計算上の基準時刻とする。legs形式では最初のbuyまたはsellから、最初の反対側約定までのopening legsを数量加重して使用する。Long/Shortとも最初のopening側を使い、旧Exitを新しいeventsへコピーしない。

`getTradeState` が一時的なEntryを計算用配列にだけ追加する。保存済みeventsへの追加・並べ替え・更新をしない。結果の `baselineUsed: true` と `baseline` に利用元を明示し、詳細にも基準利用を表示する。

明示的なEntryがあれば、その値が旧Entryと異なっていても履歴側だけで計算する。Entry eventの不正を旧値で補完しない。基準より早いExitや数量超過はInvalidを維持する。Issueのindexは保存済みevents配列を指す。

## 詳細表示

既存サマリー・Entry分析の後に、eventsがある場合だけTrade Stateと売買履歴を表示する。履歴は日時順、同一時刻は配列順の縦型カード。原文・理由・メモ等はHTMLとして実行せずエスケープして表示する。

Trade Stateには平均建値、総Entry・決済済み・残数量、累計実現損益、Open/Closed/Invalid、最終Exit日時・価格、各回数を表示する。Invalid時は問題コードも表示し、自動修正しない。

続いて独立したExit/Update情報・Exitレビュー、画像を表示する。画像はEntry/未分類、Update、Exit、Otherに分けて表示し、旧画像の保存内容は変えない。従来のカレンダー損益・一覧の集計APIは置換せず、詳細のevents計算と区別する。

## DB・バックアップ・PWA

DBバージョン5、既存store、JSONバックアップv10を維持する。migrationや読込時書換えはない。既存の画像BlobとJSON用Base64変換はcategoryを含むメタデータを維持する。exitUpdateも同じ取引レコードとしてバックアップされ、復元前に全体を検証する。同一IDは従来どおり現在のデータを優先する。

PWAバージョンは1.9.0。新しいJSを静的キャッシュに追加し、IndexedDB・画像Blobはキャッシュしない。GitHub Pagesの相対パスを維持する。

## 第4段階向け

更新テキストの貼り付け・解析は未実装で、現行ChatGPTフォーマット・解析ロジックは変更していない。第4段階では、認識した売買事実はevents APIへ、全体のExitレビューは独立したExit保存APIへ渡せる。新規Entryの作成時には明示的なEntry eventを付与すると、baselineを自動的に使わなくなる。既存Entryを更新テキストから変更する処理は設けないこと。

## 検証

- `node tests/trade-baseline-unit.cjs`: baselineの14項目。
- `JOURNAL_TEST_URL=http://127.0.0.1:8088 node tests/entry-exit.cjs`: 旧データ、分離保存、全分類画像、イベント表示、同時保存、失敗・キャンセル、モバイル表示の15項目。
- 第1・第2段階のテスト、既存暗号資産・モバイル・画像・解析・DB安全性テストを継続。
- PWAテストでオフラインのExitレビュー・分類付き画像保存、Entry保持、オンライン復帰を確認する。
