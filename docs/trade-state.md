# eventsからの取引状態計算（第2段階）

> 現行1.12.0では[統一ワークフロー](unified-trade-workflow.md)が入力導線・表示集計・Summary・navigationの仕様を更新しています。以下は各段階の保存／計算基盤の記録です。

`js/trade-state.js` の純粋計算と読み取りAPI。計算結果を取引レコードへ保存せず、IndexedDB・画像Blob・ChatGPT解析原文・旧Entry/Exit項目に書き込まない。
第3段階で詳細表示と読取時baselineを追加した。現行仕様は [Entry / Exit分離](entry-exit.md) を参照。
画面・既存カレンダー集計・既存 `getPnl` 等の表示用APIは今回置換しない。第3段階の画面分離から利用するための計算層である。

## 呼び出し

```js
const state = getTradeState(trade); // events履歴があれば新計算、それ以外は従来値
const derived = calculateEventTradeState(trade.events); // events配列だけを純粋計算
```

`getTradeState` は `events` 未定義または空配列なら `source: 'legacy'` とし、既存の `getPnl`・`getOpenQty`・`getEntryQty`・`getTradeSummary` と暗号資産項目から返す。旧データにイベントを生成しない。旧形式のイベント回数は不明なので `null`。
非空配列は `source: 'events'`。`events: null` 等の不正形式は旧ロジックへ戻さず `Invalid` として返す。

## 結果フィールド

| フィールド | 意味 |
| --- | --- |
| `source` | `events` または `legacy` |
| `isValid`, `issues` | 整合性と検出した問題一覧 |
| `totalEntryQuantity` | Entry + Add Entry の数量合計 |
| `averageEntryPrice` | 全Entry側の Σ(価格×数量) / Σ数量。Entryなしはnull |
| `closedQuantity` | Partial TP + Partial SL + Final Exit の数量合計 |
| `rawRemainingQuantity` | 丸め前のEntry数量−Exit数量 |
| `remainingQuantity` | 誤差範囲の残差だけ0に正規化した残数量 |
| `realizedPnl` | Exit側に保存された有限の確定損益の合計 |
| `status` | `Open` / `Closed` / 不整合時の `Invalid` |
| `lastExitDatetime`, `lastExitPrice` | 最も新しいExitイベントの日時・価格。Exitなしはnull |
| `addEntryCount`, `partialTpCount`, `partialSlCount` | 各イベント種別の回数 |
| `realizedPnlEventCount` | 損益が入力済みのExit件数（0も含む） |
| `missingRealizedPnlCount` | 損益がnullのExit件数 |
| `epsilon` | 数量比較で使用する許容誤差 |

Entry側のrealizedPnlは合算しない。nullは合算対象外、0は有効値。全Exitがnullなら合計は0で、未記録件数から判別できる。
価格差やLong/Shortから実現損益を再計算しない。平均建値はユーザー指定どおり全Entry側の数量加重平均であり、部分決済後の追加Entryも含む。残ポジションだけの移動平均原価とは異なる。

## 時系列と不整合

入力配列のコピーを日時昇順で処理し、同一時刻は保存配列の順序を維持する。最新Exitが同一時刻に複数ある場合は、その中で後に保存されているイベントを採用する。

各時点の残数量も確認する。途中でExit超過があった場合は、後続Entryで最終残数量が正になっても不整合を保持する。

- `EXIT_EXCEEDS_ENTRY`: 許容誤差を超える数量超過。イベントID・元配列index・負の残数量を返す。
- `FINAL_EXIT_QUANTITY_MISMATCH`: Final Exit直前の残数量と指定quantityの不一致。期待数量・実際の数量を返す。入力quantityは変更しない。
- `INVALID_EVENTS`: 第1段階の形式検証エラー。信頼できない数値はnullとして返す。
- `NUMERIC_OVERFLOW`: 有限の入力でも合計等が表現可能範囲を超えた場合。

不整合があれば `isValid: false`・`status: 'Invalid'`。数値が計算可能なら監査用に保持する。正常なOpen/Closedや既存値へのフォールバックで不整合を隠さない。

## 浮動小数誤差

数量と損益の加算には補償和を使用する。数量のepsilonは `Number.EPSILON × 32 × Entry/Exit数量の絶対量合計`。固定の絶対誤差を使わないため、非常に小さい正のポジションを一律0にしない。
誤差範囲内の残数量だけ0扱いとし、正常データなら0はClosed、正数はOpen。実際のマイナス残数量は補正しない。丸め前の値も `rawRemainingQuantity` に残す。
損益の通貨単位・小数桁数を仮定せず、セント単位への丸めや損益ゼロ補正はしない。

## 互換性・運用

DBバージョン5、store構造、バックアップv10は変更しない。migrationなし。eventsと計算結果は再読み込み・バックアップ復元後も同じ値から再算出する。PWAは1.8.0に更新し、新JSを事前キャッシュする。

第3段階ではこの結果をEntry/Exit詳細に接続できる。ただし、既存の損益・日別集計・リスク・勝敗表示の全面的な置換、イベント履歴が途中から始まる旧取引の扱いは、次段階で明示的に設計する。現段階で旧項目とeventsを自動的に合成してはならない。

## 検証

- `node tests/trade-state-unit.cjs`: 数量・平均・損益・各不整合・誤差・順序・方向の26項目。
- `JOURNAL_TEST_URL=http://127.0.0.1:8088 node tests/trade-state.cjs`: 旧データ、新計算、画像/原文、保存失敗、再読み込み、バックアップ復元の4項目。
- `node tests/pwa.cjs`: オフライン再読み込み・追記・オンライン復帰後の状態も検証。
- 既存のevents・画像・解析貼り付け・モバイル・データ安全性テストも継続する。
