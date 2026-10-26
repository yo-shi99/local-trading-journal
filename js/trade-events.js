const TRADE_EVENT_TYPES = ['Entry', 'Add Entry', 'Partial TP', 'Partial SL', 'Final Exit'];

// Optional metadata: never synthesize events from legacy Entry/Exit fields.
function validateTradeEvents(events) {
  if (events === undefined) return;
  if (!Array.isArray(events)) throw new Error('売買イベント履歴は配列で指定してください。');
  const ids = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        typeof event.id !== 'string' || !event.id.trim() || ids.has(event.id) ||
        !TRADE_EVENT_TYPES.includes(event.type) || !validCryptoDateTime(event.datetime) ||
        !Number.isFinite(event.price) || event.price <= 0 ||
        !Number.isFinite(event.quantity) || event.quantity <= 0 ||
        !(event.realizedPnl === null || Number.isFinite(event.realizedPnl)) ||
        typeof event.reason !== 'string' || typeof event.memo !== 'string') {
      throw new Error('売買イベントの種別・日時・価格・数量・損益・メモを確認してください。');
    }
    ids.add(event.id);
  }
}

function getTradeEvents(trade) {
  return structuredClone(trade.events === undefined ? [] : trade.events);
}

// Also usable when constructing a new trade before its first save.
function withTradeEvent(trade, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('売買イベントを指定してください。');
  const event = { ...input, id: input.id ?? uid(), realizedPnl: input.realizedPnl ?? null,
    reason: input.reason ?? '', memo: input.memo ?? '' };
  validateTradeEvents(trade.events);
  const events = [...getTradeEvents(trade), structuredClone(event)];
  validateTradeEvents(events);
  events.sort((a, b) => a.datetime.localeCompare(b.datetime));
  return { ...trade, events };
}

// Read/append/write inside one transaction so simultaneous appends cannot lose events.
async function appendTradeEvent(tradeId, input) {
  if (typeof tradeId !== 'string' || !tradeId.trim()) throw new Error('対象のトレードIDを指定してください。');
  const event = withTradeEvent({ id: tradeId }, input).events[0];
  const db = await _openTjDb();
  const trade = await new Promise((resolve, reject) => {
    const tx = db.transaction('trades', 'readwrite');
    let updated;
    _tjWriteComplete(tx, () => resolve(updated), reject);
    const store = tx.objectStore('trades');
    const request = store.get(tradeId);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('対象のトレードが見つかりません。');
        updated = withTradeEvent(request.result, event);
      } catch (error) {
        reject(error);
        return;
      }
      try { store.put(updated); }
      catch (error) {
        tx.abort();
        reject(error);
      }
    };
  });
  _trades = load().map(record => record.id === trade.id ? trade : record);
  return structuredClone(trade);
}
