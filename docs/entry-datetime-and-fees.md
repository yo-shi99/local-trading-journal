# Entry日時と決済手数料（v1.14.0）

## Entry datetimeの正本

旧Entry parser・日時検証は分単位のみ対応していた。秒付きの有効な貼り付け日時が認識されないと、New Tradeを開いた時のdefault値が残り、その値を保存していた。保存処理で時計から再生成する処理はなかった。

- Entry / legacy Entry / Updateともローカル日時の分または秒を受理し、タイムゾーンを推測・変換しない。
- 有効な貼り付けEntry日時は解析で明示的にフォームへ反映し、previewと保存で同じ値を使用する。default・解析時刻・保存時刻で上書きしない。
- 解析後にユーザーが日時入力を変更した場合はその操作を優先。同じ原文の再previewでも手動変更を維持する。新しい原文を解析した場合はその明示日時を反映する。
- 原文に日時がなければ手動入力、それもなければ初期値を使用する。旧原文を取引読み込み時に再解析して既存日時を書き換えることはない。
- datetime-localが秒00を分へ正規化しても、意図的な変更がなければ元の秒00表現を保持する。保存した日時は初期leg・dateにも従来どおり利用する。
- 実際にExitがEntryより前なら従来の時系列・数量チェックでInvalid／インポート保存拒否。チェックは緩和しない。

## データと定義

Partial TP / Partial SL / Final Exitのoptional `fee`（有限の0以上の数値）だけを追加保存する。

| 値 | 保存／導出 |
| --- | --- |
| Gross Realized P&L | 既存の`event.realizedPnl`。符号や金額を勝手に修正しない |
| Fee | `event.fee`。正のコスト、0は明示的な手数料ゼロ |
| Net Realized P&L | Gross - Fee。保存せず再計算 |
| Fee Rate | Fee / abs(Gross) × 100。保存せず再計算、率の表示は小数2桁 |

Gross=0・Gross未取得・fee未登録・非有限の率ではFee Rate=null（画面では—）。負のfee・非有限のfeeは保存拒否。還付・リベートは今回対象外。Grossとfeeは同じ決済通貨で入力し、両方に異なる通貨単位が明示された場合は拒否する。単位なし手入力も同じ決済通貨が前提で、FX換算はしない。

`fee`なし／nullは未登録であり、0と区別する。新規の未登録feeを自動で0として埋めない。手入力編集で空欄にするとfeeを除去する。原文にfee項目がない編集では既存feeを保持し、明示的な空欄は未登録へ戻せる。既存の派生値キーがあっても計算では信用しない。

## 正式Updateテキスト

```text
更新種別: Partial TP
決済日時: 2026-11-11 00:40:39
決済価格: 73154.9
決済数量: 0.023 BTC
実現損益: 5.6373 USDT
手数料: 0.757153 USDT
理由: 一部利確
メモ:
```

Partial SL / Final Exitも同じ手数料項目を任意で利用できる。別名はFee / Fees / Commission。実現損益はGross。旧手数料なし形式・既存別名・未知項目・rawText保持を継続する。NetやFee Rateの貼り付け値は正本にせず、未知項目として原文に残す。

Add Entry / Final Summaryの手数料行は未知項目／原文として保持するだけで、イベントまたはSummaryの金額には適用しない。

## 集計とResult

`getTradeState`の数量・生Gross計算を維持し、`getResolvedTradeState`が金融値を導出する。

- Full Historyの`grossRealizedPnl`は決済eventのGross合計、`totalFees`は登録済みfee合計。
- **全決済eventのGrossとfeeが揃う場合だけ**`feeCoverage=complete`・`netRealizedPnl`を確定し、`realizedPnl`（全画面の主成績）をNetへ切り替える。
- 一部未登録は`feeCoverage=partial`。Netはnull、主成績は取引全体の従来Grossを維持し、UIに一部未登録／Net未確定と表示する。推測で欠落feeを0にしない。登録済みfeeの小計は表示できるが完全な総手数料とは限らない。
- 全fee未登録は従来値をそのまま使用する。旧`realizedPnl`のGross/Netの意味は推測・migrationしない。古い記録へfeeを追加する場合は、入力Grossが控除前の値であることを確認する。
- ClosedのResultは主成績の正/負/0からWin/Loss/BE。Net確定時はNet、未登録・未確定時は従来Gross。Openは未確定、Invalidは集計除外。
- Net確定Full Historyは各決済eventのNetをそのeventの日・週に計上。Gross・Feesも同じevent日で別集計。Final Exit日に累計を再計上しない。
- 部分登録中は期間の主成績もGrossへ統一する。手数料登録状況の変化により主成績の計算基準が変わるため、必ず表示の登録状況を確認できるようにする。
- Mixed periodはNet確定取引のNetと旧取引の従来値を主成績へ合算する。すべてNet確定でなければ、期間全体のConfirmed Netは未確定とし、未知の手数料は合算・推測しない。

## Summary / Legacy

正本の優先順位はSummary → events → legacyを維持。SummaryはfinalSummary.realizedPnlをSummary決済日に一度だけ計上し、保持eventsのfeeを足し引きしない。Summaryのfee対応は今回追加しない。Legacyも保存済み損益をExit日に従来どおり計上し、feeを推測しない。両者のGross／Net／Feesは意味を推測せず未確定・対象外として表示する。これらが混在する期間も、全体のGross／Netを確定値として表示しない。

## 編集・安全性・PWA

既存eventの同じIDを更新し、件数は増やさない。fee/Grossの編集後はNet・率・Result・各期間・一覧・カレンダー・統計を再計算。Entry分析・Entry原文・Exit分析・Blob・categoryは変更しない。atomic write・rollback・revision競合チェックを維持する。

DB5 / backup v10を維持。optional number追加のみでmigration不要。バックアップはfee・rawText・秒付き日時を既存のJSON transportで保持する。旧バックアップも読み込める。PWA 1.14.0の静的キャッシュはIndexedDB／Blobを対象にせず、オフライン編集・再読み込みでも同じ計算を使う。

## 検証

全439項目成功（既存375 + 新規64、21スイート）。`tests/entry-time-fees-unit.cjs` 45項目、`tests/entry-time-fees.cjs` 19項目を追加。既存の秒を拒否するテストは意図した新仕様へ更新。モバイル回帰テストは保存・navigation完了を待機するよう修正し、仕様自体は変更していない。

Entry秒保持・明示的な手動訂正・Save時のdefault巻戻り防止・本当にExitが先のケース・既存誤保存日時の明示訂正、提示された実例、欠落/0/負数/null/overflow・通貨不一致、Gross正/Net負、手数料編集/消去/rollback、旧形式・Blob/category・バックアップ復元、320/412/915px、実Service Workerのオフラインfee編集・再読み込み・オンライン復帰を確認。Android standalone実機は未確認。

## 公開前の追加確認

一部fee登録 → 全件登録（最後のfee=0） → fee削除、という往復を同じ取引で実施し、Detail/List/Daily/Weekly/Calendar/StatisticsがGross/NetとResultを一貫して切り替えることを確認した。ID・event件数・元Gross・Entry情報は保持する。

選択期間内のeventだけfee未登録でも、同じ取引の期間外eventに登録済みfeeがある場合は、当該期間のGross/Fees/Net欄とNet未確定の理由を表示する。期間内でfeeが未登録のときは「未登録」とし、0として表示しない。fee=0の場合は正式な登録済み0を表示する。

秒／分／旧Entry／解析後の手動変更それぞれで、Parse → Preview → Save → 再読み込み → 編集フォーム表示まで日時が一致することを追加確認した。
