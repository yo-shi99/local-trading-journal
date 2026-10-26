# 売買イベント履歴（第1段階）

取引レコードの直下に、任意の `events` 配列を保存する。既存の `legs`、`cryptoJournal`、単一Entry/Exit、実現損益、画像Blobはそのまま保持する。
UI変更・平均建値・残数量・累計実現損益の計算・Exit更新テキストの解析は含まない。

## 保存形式

```json
{
  "events": [
    {
      "id": "event-id",
      "type": "Partial TP",
      "datetime": "2026-10-27T14:30",
      "price": 68000,
      "quantity": 0.005,
      "realizedPnl": 12.5,
      "reason": "目標到達",
      "memo": "半分を決済"
    }
  ]
}
```

- `type`: `Entry` / `Add Entry` / `Partial TP` / `Partial SL` / `Final Exit`。
- `datetime`: 既存フォームと同じローカル日時 `YYYY-MM-DDTHH:mm`。タイムゾーンの推測・変換をしない。
- `price` / `quantity`: 有限の正数。小数をそのまま保持する。数量は銘柄の数量で、契約枚数・レバレッジ等の換算はしない。
- `realizedPnl`: 有限数または未記録の `null`。0・正数・負数は別々に保持し、イベント種別から符号を決めない。将来の集計では各イベント単体の損益として扱い、累計値を入力しない。
- `reason` / `memo`: 文字列。追記APIで省略した場合は空文字。
- `id`: 非空の文字列で、同じ取引内で一意。追記APIで省略した場合は生成する。

## 開発用API

`js/trade-events.js` を通常ページとPWAの両方に読み込む。画面に新しい操作は追加していない。

```js
// 既存・新規保存済み取引に明示的に追記する（保存完了を待つ）。
const updated = await appendTradeEvent(tradeId, {
  type: 'Add Entry', datetime: '2026-10-27T14:00',
  price: 65000, quantity: 0.01, realizedPnl: null,
  reason: '追加条件成立', memo: ''
});

// 新規取引を初めて保存する前にも、純粋関数で履歴を付加できる。
const withEvents = withTradeEvent(newTrade, {
  type: 'Entry', datetime: '2026-10-27T13:00', price: 64000, quantity: 0.01
});

const history = getTradeEvents(updated); // コピー。履歴がなければ []。
validateTradeEvents(history); // 不正値は例外。undefined は既存取引として許可。
```

`withTradeEvent` は保存を行わず、元の取引・配列・イベントを変更しない。`appendTradeEvent` はIndexedDB内の最新取引を同一readwriteトランザクションで読み、1イベントを追加して保存する。対象取引がなければ作成しない。成功後だけメモリキャッシュを更新する。
追記時に日時順へ整列し、同時刻のイベントは入力順を維持する。読込時に並べ替え・書換え・自動移行は行わない。

## 互換性と今後

- IndexedDB名・DBバージョン5・既存storeを変更しない。イベント専用migrationは不要。
- `events` なしと空配列を区別して保持する。過去取引の読込や通常編集では、履歴を勝手に補完しない。
- 通常・暗号資産フォームで既存eventsを維持し、保存時に検証する。
- JSONバックアップv10の既存レコード出力にeventsがそのまま含まれる。復元は全データの検証後、従来の「同じIDは現在の内容優先」で統合する。旧配列形式・v9等のeventsなしバックアップも対応する。
- 不正なイベントを含むバックアップは書込前に拒否する。DBオープン失敗・タイムアウト時の挙動は既存の安全処理を維持し、DBを削除しない。
- PWAキャッシュバージョンは1.7.0。新JSを静的キャッシュ対象に追加し、IndexedDBと画像Blobはキャッシュに含めない。
- 第2段階では、親取引のLong/Shortとイベント種別・時刻・価格・数量・単体損益を使って計算できる。ただし今回は残数量超過・最終決済の数量一致などのポジション整合性判定を行わない。イベントなしの過去取引をどう集計するかも第2段階で明示する必要がある。

## テスト

`JOURNAL_TEST_URL=http://127.0.0.1:8088 node tests/trade-events.cjs`

旧データ無書換え・通常編集、新規Entryと全5種イベント、0/正/負/未記録損益、小数数量、再読み込み、JSONバックアップ→削除→復元、旧形式復元、画像Blob・解析原文、入力検証、同時追記、トランザクション失敗時のDB・メモリ保持を検証する。
`tests/pwa.cjs` でもオンライン／オフラインのイベント保存と復帰後の保持を確認する。既存のデータ安全性テストでDB失敗時の自動削除がないことを確認する。
