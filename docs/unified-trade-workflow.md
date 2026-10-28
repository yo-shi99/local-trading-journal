# 統一ChatGPT Import・決済状態・Summary・編集navigation（1.12.0）

## 原因と方針

これまで`getTradeState()`はeventsを計算したが、カード、`getPnl()`、`getOpenQty()`、カレンダー、統計は旧フィールドを参照していた。そのためevents上のClosed/-7.6262と、旧Entry情報だけから算出したOpen/0が並存した。
編集フォームもhistory stateを作らなかったため、Android Backはアプリの直前navigationへ戻っていた。

現行は読み取り時の`getResolvedTradeState(trade)`を共通の正本とする。旧フィールドへの値のコピーや読み取りmigrationは行わない。

## データモデルと優先順位

1. **Summary**: `historyMode: 'summary'` + `finalSummary`が最終状態の正本。
2. **Full History**: 有効なeventsが存在するときは`getTradeState()`の計算結果が正本。明示的Entryがなければ従来のlegacy baselineを継続使用する。
3. **Legacy**: eventsなし（空配列含む）でSummaryもなければ従来フィールドへfallback。

不正events/不正SummaryはInvalidとして表示し、旧フィールドへ黙ってfallbackしない。Invalidの金額はカードでは「—」、損益・成績集計からは除外し、統計に件数を表示する。修正・削除は自動実行しない。

### Final Summary

```text
更新種別: Final Summary

決済日時: 2026-10-29 12:00:00
Exit価格: 82000
実現損益: 25.5 USDT
結果: Win
Exit理由: 目標到達
メモ: 途中の追加・部分利確履歴は省略
振り返り: 計画通り
```

必須は日時、有限の実現損益（0可）、結果（Win/Loss/BE）。Exit価格は省略/空欄可、指定時は正数。数量は不要で、指定されても原文に保持するだけ。既知項目の別名、秒付き日時、単位付き金額、未知項目保持は既存Updateパーサーと共通。

保存例:

```js
{
  // 既存Entry情報・分析・screenshots・eventsはそのまま
  historyMode: 'summary',
  finalSummary: {
    datetime: '2026-10-29T12:00:00',
    price: 82000, // 省略時null
    realizedPnl: 25.5,
    result: 'Win',
    rawText: '更新テキスト全文'
  },
  exitUpdate: { reason: '目標到達', memo: '途中履歴は省略', review: '計画通り' }
}
```

結果/日時/価格/最終損益をeventsや旧フィールドへ重複保存しない。理由・メモ・レビュー・任意のExit分析は従来のexitUpdateへ部分パッチとして保存する。既存Exit分析の省略キーは保持する。

SummaryはClosed、残数量0。総Entry数量、平均建値、実際の決済数量、Add/Partial回数は不明としてnullを返し、「途中イベント未記録」と表示する。既存eventsは削除せず閲覧可能だが、その部分損益はSummaryの最終損益へ加算しない。架空の売買eventは一切作らない。

日時は保存済みのEntry・イベント以降でなければ拒否する。明示的Entry eventがあれば、旧Entry日時を基準へ重複利用しない。Summary保存後の再インポート・event追記は二重記録を防ぐため拒否する。Entryの通常手動編集は引き続き可能だがSummaryの正本は変わらない。

## 表示・集計

- `getPnl/getOpenQty/getEntryQty/getRealizationsByDate/getRiskByDate`から共通selectorを利用する。
- Full Historyの各Exit eventの実現損益は、そのeventの日付へ計上。nullは未記録、0は有効。PnLの符号は変更しない。
- Summaryの最終実現損益は、Summaryの決済日へ1回だけ計上する。
- カード・Trade State・詳細サマリー・日次/週次/月次・カレンダー・統計・レポートは同じ結果を参照する。
- Net P&LにはOpenの確定済み部分損益も含める。events/SummaryのWin/Loss判定はClosed時のみ。Avg Win/Loss・Profit Factorも新方式ではClosed取引の金額が対象。既存の結果ラベルと金額の独立性を保持する。
- Total Tradesは従来どおり登録された有効取引の件数（Open含む）。Invalidは別件数表示。
- Full Historyの結果はFinal Exitの明示的な結果があればそれを使用し、なければ確定損益の符号から判定。Summaryは必須入力された結果。Legacyは従来判定。
- Summaryの数量履歴・リスクは推測しないため、数量に依存する割合やRは不明表示とする。

## 統一フォーム

新規・既存の両画面で、見えるChatGPT貼り付け欄は「ChatGPT取引テキスト」の1つ。

1. テキストを貼り、必要なら今回の画像を追加。
2. 「解析して確認」。貼り付けだけでは反映/保存しない。
3. フォーム・プレビュー・対象・状態の変化・未知項目を確認。
4. 「保存」。新規はNew Entry、既存は4種類の売買更新またはFinal Summaryを保存。

新規では更新種別なしの旧Entryも利用できる。既存TradeへNew Entry/旧Entryをインポートしない。新規画面で売買更新/Summaryを保存しない。
New Entryは解析後にフォームへ反映するがDBは未変更。手動修正後の再解析では同じ原文を再適用せず、現在のフォームを再プレビューする。プレビュー後に内容が変わると保存前に再確認が必要。
既存Tradeの更新は、Entryフォームの未保存編集を含めず最新DBレコードへ追記する。元のEntry原文は内部互換用の非表示フィールドで保持し、詳細画面で閲覧する。

旧Exit個別フォームは「手動編集：Exit理由・レビュー・分析」の折りたたみへ移動した。通常は保存済みExit情報を表示し、必要なときだけ手入力する。
画像の初期categoryはNew Entry=Entry、Add/Partial=Update、Final Exit/Summary=Exit。利用者は変更可能。既存画像を置換しない。

## 原子的保存・バックアップ

売買更新は既存`appendTradeEvent` APIを継続使用。Summaryは同じreadwriteトランザクション内で最新Tradeを取得・プレビュー再検証し、Summary/Exitパッチ/画像を1レコードとして保存する。メモリキャッシュ更新はコミット成功後のみ。
プレビュー後の変更、重複、数量不整合、必須欠落は保存を止める。保存失敗・abortでは従来データとキャッシュを維持する。
DB5・既存store・バックアップv10を維持。Summaryの任意追加フィールドも画像Blob/category・原文とともにJSONで往復する。旧配列/v9/v10を引き続き受け付ける。DB削除や強制migrationなし。

## Android/browser Back

`js/form-navigation.js`は編集開始時に1つの同一URL history stateを追加し、戻り先の一覧/詳細コンテキストをメモリに保持する。
Backのpopstate、Close、Cancel（統一フォームのキャンセル含む）は共通処理でドラフト・画像・プレビューを破棄し、元の一覧または詳細へ戻る。確認ダイアログなし。保存成功後も編集用stateを消費する。
同一編集内の切替でhistoryを積み増さず、前進/再読込でも破棄したフォームを復元しない。無限pushや通常のアプリ終了の抑止は行わない。閉じる直前の遅延フォーム表示・画像圧縮も別画面へ持ち越さない。

## 検証

既存テストの貼り付け先と操作を統一フォームへ更新し、保存後の一覧/詳細への復帰に対応させた。テストの解析・保存・復元・Blob・安全性の検証は維持する。
追加: `tests/resolved-workflow-unit.cjs`、`tests/resolved-workflow.cjs`。
PWAの既存シナリオもオフラインSummary保存とオンライン復帰・復元まで拡張。Android実機のBack/standalone表示は実機で最終確認する。

検証結果：既存263項目（統一UIの操作に更新）＋追加34単体/27ブラウザ＝324項目成功。共通状態・Summary・全Cancel/Back/Close・遅延保存・Legacy小数表示・320/412/915px・バックアップ/Blob・実SWオフラインを確認。Android実機は未確認。

最終確認では、既存eventsの実現損益−5とSummary最終損益+2の共存時に、全表示/集計が+2（−3ではない）になるケース、および編集終了後の次のBackが通常navigationへ進むケースを追加。レポート再集約も金額総額・金額分類件数を引き継ぎ、途中で小数2桁へ丸めたり、Win/Loss/BEラベルから金額を再構成したりしない。
