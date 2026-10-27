# ChatGPT正式貼り付け仕様（第5段階 / アプリ1.11.0）

スクリーンショット → ChatGPT解析 → 以下の定型テキスト → アプリへ貼り付け、を正式運用とする。
不明な分析値を推測で埋めず空欄にする。売買の日時・約定価格・数量は利用者が確認する。項目順は自由。

## 判定と操作

- `更新種別: New Entry`：新規取引の「ChatGPT解析結果を貼り付け」へ。解析でフォームに反映し、確認・補完してSave Tradeする。既存取引のUpdate Importには適用不可。
- `更新種別`のない旧Entry：従来のEntry解析として扱う。既存取引の通常編集も維持。
- Add Entry / Partial TP / Partial SL / Final Exit：対象の既存取引を開き、「ChatGPT更新テキストを貼り付け」→解析して確認→この更新を追加。
- 更新テキストをEntry欄へ貼ってもEntry項目には反映せず、通常保存も止める。明示的New Entryを既存Entry欄へ新たに貼っても反映・保存を止める。新形式で作成済みの取引は、保存済み原文を維持したまま通常の手動編集・再保存が可能。
- 種別不明・種別重複は推測しない。更新種別のないテキストをUpdate Importへ適用することも不可。
- 手入力は継続可能。Entry貼付けの従来動作（有効項目だけ反映、既入力との競合確認、無効値の警告）を維持。

## New Entry

```text
更新種別: New Entry

銘柄: BTC
方向: Short
エントリー日時: 2026-10-26 22:08
エントリー価格: 80210
SL:
TP:
ポジションサイズ: 0.01 BTC
戦略: Pullback Short

Price Structure: 1H下降構造
Key Level / Zone: 81302

Futures CVD: マイナス圏
Spot CVD: 低下
OI: 増加
Funding Rate: +0.0097
Volume: 増加
Futures Bid & Ask Delta: Sell優勢

Footprint: 売り優勢
Imbalance / Stacked Imbalance: 明確なStackなし
Order Book / Heatmap: 下側流動性あり
TPO / Market Profile:

エントリー根拠: 戻り売り
Invalidation条件: 81302回復
振り返り:
```

新規保存時は銘柄・方向・有効なEntry日時・正のEntry価格・正の数量が必須。貼付けで不足しても原文を残し、フォームで補完できる。SL/TP/戦略/分析/根拠/振り返りは任意。
Entry日時は分単位、ローカル時刻 `YYYY-MM-DD HH:mm`（保存はT区切り）。既存の日時検証を変更しない。秒が必要な更新日時とは異なる。

### Entry保存先・別名

`t`は取引、`c = t.cryptoJournal`。キーは大文字小文字・一般的な空白やMarkdown装飾を正規化して判定する。

| 正式ラベル | 主な別名 | 保存先 |
| --- | --- | --- |
| 銘柄 | 通貨 / Symbol / Ticker / Asset / Coin | `t.symbol` |
| 方向 | 売買方向 / Long/Short / Direction / Side | `c.direction` (Long/Short) |
| エントリー日時 | Entry datetime / Entry date / Entry time / entryAt | `c.entryAt` |
| エントリー価格 | Entry price / Entry | `c.entryPrice` |
| SL | 損切り / 損切り価格 / Stop loss | `c.stopLossPrice` |
| TP | 利確 / 利確価格 / Take profit | `c.takeProfitPrice` |
| ポジションサイズ | 数量 / Size / Quantity / Qty | `c.positionSize` |
| 戦略 | 戦略タグ / Strategy | `c.strategy`、任意戦略は`その他`と`c.strategyOther` |
| エントリー根拠 | 根拠 / Entry reason / Rationale / Reason | `c.entryReason` |
| 振り返り | 反省 / Review / Reflection | `c.review`（従来のEntry時メモ） |
| Price Structure | 同名 | `c.entryAnalysis.priceStructure` |
| Key Level / Zone | Key Level / Zone | `c.entryAnalysis.keyLevelZone` |
| Futures CVD | 同名 | `c.entryAnalysis.futuresCvd` |
| Spot CVD | 同名 | `c.entryAnalysis.spotCvd` |
| Volume | 出来高 | `c.entryAnalysis.volume` |
| Futures Bid & Ask Delta | 同名 | `c.entryAnalysis.futuresBidAskDelta` |
| Invalidation条件 | Invalidation | `c.entryAnalysis.invalidation` |
| CVD（旧形式） | Cumulative volume delta | `c.orderFlow.cvd` |
| OI | Open interest / 建玉 | `c.orderFlow.oi` |
| Funding Rate | Funding / FR / ファンディング / 資金調達率 | `c.orderFlow.fundingRate` |
| Footprint | フットプリント | `c.orderFlow.footprint` |
| Imbalance / Stacked Imbalance | Imbalance / Stacked Imbalance / インバランス | `c.orderFlow.imbalance` |
| Order Book / Heatmap | Heatmap / Order Book / 板 / ヒートマップ | `c.orderFlow.orderBook`（orderBookHeatmap相当） |
| TPO / Market Profile | TPO / Market Profile / マーケットプロファイル | `c.orderFlow.marketProfile`（tpoMarketProfile相当） |

既存項目は名称変更・二重保存せず既存キーを正本とする。追加7項目は任意の`entryAnalysis`に文字列で独立保存。分析の数値らしい文字列（Fundingの%など）もそのまま保持する。
旧CVDからFutures/Spotへコピーしない。Futures/Spotを旧CVDへ統合しない。旧Entryの決済日時・実現損益・結果ラベルも従来どおり解析可能。

## Add Entry

```text
更新種別: Add Entry

日時: 2026-10-27 10:15
価格: 79000
数量: 0.005 BTC
理由:
メモ:
```

## Partial TP

```text
更新種別: Partial TP

決済日時: 2026-10-27 11:10
決済価格: 78800
決済数量: 0.005 BTC
実現損益: 7.05 USDT
理由: 第一利確
メモ:
```

## Partial SL

```text
更新種別: Partial SL

決済日時: 2026-10-27 11:30
決済価格: 80100
決済数量: 0.005 BTC
実現損益: -2.10 USDT
理由: リスク縮小
メモ:
```

## Final Exit

```text
更新種別: Final Exit

決済日時: 2026-10-27 12:00
Exit価格: 80339.3
決済数量: 0.01 BTC
実現損益: -3.1737 USDT
結果: Loss
Exit理由: SL到達

Exit時Price Structure:
Exit時Futures CVD:
Exit時Spot CVD:
Exit時OI:
Exit時Funding Rate:
Exit時Volume:
Exit時Futures Bid & Ask Delta:
Exit時Footprint:
Exit時Order Book / Heatmap:

振り返り:
```

上記4つは書式の例で、同一取引へ順に適用する数量例ではない。Final Exit数量は対象取引の実際の残数量を使う。

### Update共通仕様

| 項目 | 別名 | 必須／任意・保存先 |
| --- | --- | --- |
| 更新種別 | Update Type | 必須。`events[].type` |
| 日時 | 約定日時 / 決済日時 / Entry日時 / Exit日時 | 必須。`events[].datetime` |
| 価格 | 約定価格 / エントリー価格 / Entry価格 / 決済価格 / Exit価格 / TP価格 / SL価格 | 正数必須。`events[].price` |
| 数量 | 決済数量 / Entry数量 / ポジションサイズ / Qty / Size | 正数必須。`events[].quantity` |
| 実現損益 | Realized P&L / Realized PnL / P&L / PnL | 任意。`events[].realizedPnl`。未記録はnull、0・正数・負数を変更しない |
| 理由 | Exit理由 / Entry理由 / 利確理由 / 損切り理由 | 任意。`events[].reason` |
| メモ | コメント | 任意。`events[].memo` |
| 振り返り | 同名 | 任意。event.memoへ含める。Final Exitでは`t.exitUpdate.review`にも保存 |
| 結果 | 同名 | 任意。Final Exitのみ`t.exitUpdate.result` (Win/Loss/BE) |

種別別名：AddEntry/追加エントリー、PartialTP/部分利確、PartialSL/部分損切り、FinalExit/Exit/全決済/最終決済。NewEntryもNew Entryと同じ新規判定。曖昧な部分一致はしない。
更新日時は`YYYY-MM-DD HH:mm[:ss]`、保存はT区切り、秒保持、タイムゾーン推測なし。数値は符号・桁区切り・BTC/USDT等の単位付きに対応。ROE等の%を価格・数量・PnLへ変換しない。

### Exit分析（すべて任意）

Final Exitのみ、以下を`t.exitUpdate.analysis`へ文字列で保存する。Entry分析は変更しない。省略した既存Exit分析キーは保持し、明示的空欄はそのキーの空文字として反映する。Add Entry/Partial TP/Partial SLにExit分析があっても、警告して原文だけに保持する。

| ラベル | 保存キー |
| --- | --- |
| Exit時Price Structure | exitPriceStructure |
| Exit時Futures CVD | exitFuturesCvd |
| Exit時Spot CVD | exitSpotCvd |
| Exit時OI | exitOi |
| Exit時Funding Rate（別名Exit時Funding） | exitFundingRate |
| Exit時Volume | exitVolume |
| Exit時Futures Bid & Ask Delta | exitFuturesBidAskDelta |
| Exit時Footprint | exitFootprint |
| Exit時Order Book / Heatmap（別名Exit時Heatmap） | exitOrderBookHeatmap |

Final Exitの理由・メモ・振り返り・結果は既存の`exitUpdate.reason/memo/review/result`。売買事実はeventsが正本。分析は独立した手入力欄で修正可能。詳細画面ではFinal Exit eventがあるときExit分析を折りたたみ表示する。

## 安全性・未認識項目・原文・画像

- Entry全文は`cryptoJournal.analysisText`、更新全文は`events[].rawText`。未知項目は勝手に変換せず原文に保持し、解析結果に表示する。
- 更新は対象の既存取引だけ。確認前に保存しない。必須不足・不正quantity・重複・Invalid状態・プレビュー後の対象変更は保存禁止。
- Partial TP/SLは残数量以下、Final Exitは残数量と一致（計算APIのepsilonで判定）。数量を補正しない。既存のlegacy baselineを継続使用する。
- event・raw・Exit分析/レビュー・今回画像は同じreadwriteトランザクションの単一trade保存。失敗時は全体ロールバック。Entry情報・Entry原文・既存画像を変更しない。
- Entry追加画像の初期categoryはEntry。更新はUpdate、Final ExitはExit。更新画像のcategoryは利用者が変更可能。categoryなし旧画像はそのまま維持。
- DB5、store構成、バックアップv10を維持。新任意項目・原文・events・Exit情報・画像category/BlobはJSON復元まで保持。旧バックアップも継続対応。読み取りmigration・既存レコードの自動更新・DB自動削除なし。
- PWA静的キャッシュは1.11.0へ更新。IDBデータ/BlobはSWキャッシュ対象外。更新反映は既存タブ/アプリを閉じて再起動。GitHub Pages配下URLを継続。

## テスト

既存216項目に、新仕様の単体テスト`tests/chatgpt-format-unit.cjs`、ブラウザテスト`tests/chatgpt-format.cjs`を追加。仕様例は`tests/chatgpt-format-fixtures.cjs`。既存の旧画像テストは明示的にcategoryなしfixtureを作成する。PWAテストはオフラインNew Entryの新分析項目保持も確認する。

検証結果：既存216項目＋新規単体35項目＋新規ブラウザ12項目＝263項目成功。新規ブラウザには不正分析バックアップの拒否、3画面幅、Entry保護、原子的ロールバックを含む。PWAの既存7シナリオは新形式Entry／Final Exit分析のオフライン保存・再読込・オンライン復帰まで拡張した。実行環境はChromium（モバイルエミュレーション含む）であり、Android実機の最終確認は別途行う。
