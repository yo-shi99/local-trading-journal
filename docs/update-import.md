# ChatGPT更新テキストの取り込み（第4段階）

既存取引の編集画面に、独立した「ChatGPT更新テキストを貼り付け」欄を追加した。新規取引には表示しない。新規Entry用の `js/analysis-import.js`、解析フォーマット、Entry項目は変更しない。

## 操作

1. 更新したい既存取引の編集を開き、対象の銘柄・方向・Entry日時・価格・現在残数量を確認する。
2. 更新用テキストを貼り付け、必要なら今回の画像を追加する。
3. 「解析して確認」を押す。貼付けや解析だけではDBに保存しない。
4. event内容、数量・損益・状態の変化、未認識項目、画像分類を確認する。
5. 「この更新を追加」で確定する。Entry欄や独立したExit編集欄の未保存変更は反映しない。

キャンセルはDBを変更せず、原文を入力欄に残してプレビューと今回の画像を取り消す。取引の切替・フォーム終了時は原文・画像・プレビューをリセットし、別取引への持越しを防ぐ。通常のSave TradeやExit専用保存ではUpdate Importのドラフトを保存しない。

## 種別・別名

`更新種別:` は次の正式値に正規化する。空白・大文字小文字の違いは許容するが、曖昧な複数候補を推測しない。

| 正式type | 対応別名 |
| --- | --- |
| Add Entry | AddEntry、追加エントリー |
| Partial TP | PartialTP、部分利確 |
| Partial SL | PartialSL、部分損切り |
| Final Exit | FinalExit、Exit、全決済、最終決済 |

| 項目 | 対応ラベル |
| --- | --- |
| datetime | 日時、約定日時、決済日時、Entry日時、Exit日時 |
| price | 価格、約定価格、エントリー価格、Entry価格、決済価格、Exit価格、TP価格、SL価格 |
| quantity | 数量、決済数量、Entry数量、ポジションサイズ、Qty、Size |
| realizedPnl | 実現損益、Realized P&L、Realized PnL、P&L、PnL |
| reason | 理由、Exit理由、Entry理由、利確理由、損切り理由 |
| memo | メモ、コメント、振り返り |

項目順は自由。全角コロン、一般的なMarkdownラベル、複数行メモに対応する。既知項目が重複する場合は値を選ばず保存を止める。
数値は桁区切り・符号・BTC/USDT等の単位付きに対応する。価格・数量は正数必須。PnLは省略・空欄・`null`を未記録として扱い、0・正数・負数はそのまま保持する。種別や結果から符号を補正しない。`ROE: -3.96%` は未知項目として保持し、金額のPnLへ変換しない。

日時は `YYYY-MM-DD HH:mm` または秒付き形式を受け付ける。区切りの `/`・`.`、空白の代わりの `T` も対応する。保存は `YYYY-MM-DDTHH:mm[:ss]`。秒を切り捨てず、タイムゾーンを推測・変換しない。旧Entryの日時解析・検証は従来の分単位のまま。

## 検証と重複防止

`previewUpdateImport(trade, text)` は `getTradeState()` で更新前後を計算する。

- 全種別でtype・日時・正の価格・正の数量が必須。
- 現在または反映後がInvalidなら保存しない。
- Partial TP/SLは現在残数量以下。
- Final Exitは現在残数量との一致が必須。自動補正や警告無視での強行保存は設けない。
- 従来の決済済み状態とevents基準に食い違いがある場合は、推測で履歴を作らず確認を求める。
- `type + datetime + price + quantity` が既存eventと一致すれば重複として拒否する。分単位と秒00は同時刻として比較する。
- プレビュー後に原文・画像・分類を変更すると再確認が必要。DB側の対象取引が変わった場合も再解析を要求する。

## 保存とEntry保護

`commitUpdateImport({ tradeId, rawText, expectedRevision, images })` は第1段階の `appendTradeEvent()` を使用する。
events APIへ任意の検証フック・Exitパッチ・追加画像を渡し、同じreadwriteトランザクション内で最新の取引を取得し、再検証して単一レコードを保存する。event・Exitレビュー・画像の一部だけを保存しない。メモリはコミット成功後だけ更新する。

変更するのはevents、新画像の追加、Final Exitで指定されたexitUpdate項目だけ。Entry日時・価格・根拠・分析・analysisText・既存画像は最新DBレコードから維持する。別取引の検索や自動選択は行わない。

各eventに任意の `rawText` として更新全文を保存し、詳細の「更新原文」から確認できる。未知項目は原文に残し、プレビューにもラベル・値を表示する。未知の数値を既存フィールドへ転用しない。

Final Exitでは、指定された理由・メモ・振り返りをexitUpdateへ反映し、`結果`は任意の `exitUpdate.result`（Win/Loss/BE）として独立保持する。Entryの結果や分析は変更しない。振り返りはeventのmemoにも保持し、全体レビューはexitUpdate.reviewで参照できる。指定されていない既存Exit項目は保持する。

画像は今回のドラフトだけを追加する。既定分類はAdd Entry/Partial TP/Partial SLがUpdate、Final ExitがExit。ユーザーはEntry/Update/Exit/Otherへ変更できる。既存Entry画像の削除・置換はしない。キャンセル後に完了した画像圧縮も別取引へ混入させない。

## 互換性・PWA

DBバージョン5、既存store、バックアップv10を維持する。強制migrationやDB削除は行わない。旧eventsや旧バックアップではrawText・秒・Exit結果がなくても利用できる。新しいrawText・event・exitUpdate・画像category/Blobはバックアップ復元に含まれる。
PWAは1.10.0。新JSを静的キャッシュへ追加し、IndexedDBと画像Blobはキャッシュ対象にしない。GitHub Pagesの配下URLを維持する。

## テストと次段階

`tests/update-import-unit.cjs` はパーサー・別名・数量・重複・実例等の77項目。`tests/update-import.cjs` はUI・保存・Entry保護・失敗・復元・モバイル等の18項目。既存テストを継続し、PWAでオフラインのUpdate Import（画像付き）・再読込・オンライン復帰を検証する。

実例のFinal Exitは秒付き日時 `2026-10-26T17:41:04`、価格80339.3、数量0.01、PnL -3.1737、理由SL到達、Lossとレビューを保存し、Closedになる。SLトリガー価格・ROEは原文に残る。
第5段階では新規Entryと更新テキストの正式テンプレートを同期できる。現段階では既存Entryフォーマットは変えていない。

第5段階の正式Entry／Update書式とExit分析の保存先は[ChatGPT正式フォーマット](chatgpt-format.md)を参照。第4段階の数量検証・重複防止・原子的保存は継続する。
