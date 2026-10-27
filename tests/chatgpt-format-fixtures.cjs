const entry = `更新種別: New Entry

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
振り返り:`;
const exit = `更新種別: Final Exit

決済日時: 2026-10-27 12:00
Exit価格: 80339.3
決済数量: 0.01 BTC
実現損益: -3.1737 USDT
結果: Loss
Exit理由: SL到達

Exit時Price Structure: 上昇転換
Exit時Futures CVD: 買い増加
Exit時Spot CVD: 上昇
Exit時OI: 減少
Exit時Funding Rate: +0.02%
Exit時Volume: 出来高増加
Exit時Futures Bid & Ask Delta: Buy優勢
Exit時Footprint: 買い優勢
Exit時Order Book / Heatmap: 上側流動性到達

振り返り: SLで全決済`;
const expectedEntry = { priceStructure: '1H下降構造', keyLevelZone: '81302', futuresCvd: 'マイナス圏', spotCvd: '低下', volume: '増加', futuresBidAskDelta: 'Sell優勢', invalidation: '81302回復' };
const expectedExit = { exitPriceStructure: '上昇転換', exitFuturesCvd: '買い増加', exitSpotCvd: '上昇', exitOi: '減少', exitFundingRate: '+0.02%', exitVolume: '出来高増加', exitFuturesBidAskDelta: 'Buy優勢', exitFootprint: '買い優勢', exitOrderBookHeatmap: '上側流動性到達' };
module.exports = { entry, exit, expectedEntry, expectedExit };
