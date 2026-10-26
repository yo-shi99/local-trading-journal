// Derived state only: this module never writes to trades, IndexedDB or caches.
function hasTradeEventHistory(trade) {
  return trade.events !== undefined && !(Array.isArray(trade.events) && trade.events.length === 0);
}

function eventStateSum(values) {
  let sum = 0, correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}

function calculateEventTradeState(events) {
  const state = { source: 'events', isValid: true, issues: [],
    totalEntryQuantity: 0, averageEntryPrice: null, closedQuantity: 0,
    rawRemainingQuantity: 0, remainingQuantity: 0, realizedPnl: 0,
    status: 'Closed', lastExitDatetime: null, lastExitPrice: null,
    addEntryCount: 0, partialTpCount: 0, partialSlCount: 0,
    realizedPnlEventCount: 0, missingRealizedPnlCount: 0, epsilon: 0 };
  try {
    if (!Array.isArray(events)) throw new Error('売買イベント履歴は配列で指定してください。');
    validateTradeEvents(events);
  } catch (error) {
    return { ...state, isValid: false, status: 'Invalid', totalEntryQuantity: null,
      closedQuantity: null, rawRemainingQuantity: null, remainingQuantity: null,
      realizedPnl: null, issues: [{ code: 'INVALID_EVENTS', message: error.message }] };
  }
  // Explicit input-index tie break: same-time events retain their stored order.
  const ordered = events.map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.datetime.localeCompare(b.event.datetime) || a.index - b.index);
  const entries = [], exits = [], profits = [], quantities = [];
  for (const { event, index } of ordered) {
    const entry = event.type === 'Entry' || event.type === 'Add Entry';
    const before = eventStateSum(quantities);
    quantities.push(entry ? event.quantity : -event.quantity);
    const scale = eventStateSum([...entries, ...exits, event].map(e => e.quantity));
    const epsilon = Number.EPSILON * 32 * scale;
    if (entry) {
      entries.push(event);
      if (event.type === 'Add Entry') state.addEntryCount++;
    } else {
      exits.push(event);
      if (event.type === 'Partial TP') state.partialTpCount++;
      if (event.type === 'Partial SL') state.partialSlCount++;
      if (event.realizedPnl === null) state.missingRealizedPnlCount++;
      else { profits.push(event.realizedPnl); state.realizedPnlEventCount++; }
      state.lastExitDatetime = event.datetime;
      state.lastExitPrice = event.price;
      if (event.type === 'Final Exit' && Math.abs(before - event.quantity) > epsilon) {
        state.issues.push({ code: 'FINAL_EXIT_QUANTITY_MISMATCH', eventId: event.id, index,
          expectedQuantity: before, actualQuantity: event.quantity });
      }
    }
    const remaining = eventStateSum(quantities);
    if (remaining < -epsilon) state.issues.push({ code: 'EXIT_EXCEEDS_ENTRY',
      eventId: event.id, index, remainingQuantity: remaining });
  }
  state.totalEntryQuantity = eventStateSum(entries.map(e => e.quantity));
  state.closedQuantity = eventStateSum(exits.map(e => e.quantity));
  // All Entry/Add Entry fills contribute, including fills preceding partial exits.
  state.averageEntryPrice = state.totalEntryQuantity > 0
    ? eventStateSum(entries.map(e => e.price * (e.quantity / state.totalEntryQuantity))) : null;
  state.realizedPnl = eventStateSum(profits);
  state.rawRemainingQuantity = eventStateSum(quantities);
  state.epsilon = Number.EPSILON * 32 * eventStateSum([...entries, ...exits].map(e => e.quantity));
  const numeric = [state.totalEntryQuantity, state.closedQuantity, state.realizedPnl,
    state.rawRemainingQuantity, state.epsilon];
  if (state.averageEntryPrice !== null) numeric.push(state.averageEntryPrice);
  if (!numeric.every(Number.isFinite)) {
    state.issues.push({ code: 'NUMERIC_OVERFLOW' });
  }
  state.isValid = state.issues.length === 0;
  // A real deficit is preserved. Only floating-point residuals become zero.
  state.remainingQuantity = Number.isFinite(state.epsilon) && Math.abs(state.rawRemainingQuantity) <= state.epsilon
    ? 0 : state.rawRemainingQuantity;
  state.status = !state.isValid ? 'Invalid' : state.remainingQuantity > 0 ? 'Open' : 'Closed';
  return state;
}

// Read API for phase 3: historical display/aggregation APIs remain unchanged.
function getTradeState(trade) {
  if (hasTradeEventHistory(trade)) return calculateEventTradeState(trade.events);
  const crypto = isCryptoTrade(trade) ? trade.cryptoJournal : null;
  const summary = crypto ? null : getTradeSummary(trade);
  const totalEntryQuantity = getEntryQty(trade), remainingQuantity = getOpenQty(trade);
  const sells = (trade.legs || []).filter(leg => leg.action === 'sell');
  const legacyEntryPrice = Number.parseFloat(trade.entryPrice);
  const legacyExitPrice = Number.parseFloat(trade.exitPrice);
  return { source: 'legacy', isValid: true, issues: [],
    totalEntryQuantity, averageEntryPrice: crypto ? crypto.entryPrice : summary.avgEntry ??
      (Number.isFinite(legacyEntryPrice) ? legacyEntryPrice : null),
    closedQuantity: totalEntryQuantity - remainingQuantity, remainingQuantity,
    rawRemainingQuantity: remainingQuantity, realizedPnl: getPnl(trade),
    status: remainingQuantity > 0 ? 'Open' : 'Closed',
    lastExitDatetime: crypto ? crypto.exitAt || null : summary.exitTime ?? trade.exitAt ?? null,
    lastExitPrice: crypto ? null : sells.length ? Number(sells[sells.length - 1].price) :
      Number.isFinite(legacyExitPrice) ? legacyExitPrice : null,
    addEntryCount: null, partialTpCount: null, partialSlCount: null,
    realizedPnlEventCount: null, missingRealizedPnlCount: null, epsilon: 0 };
}
