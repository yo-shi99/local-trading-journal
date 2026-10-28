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
    .sort((a, b) => tradeEventTimeKey(a.event.datetime).localeCompare(tradeEventTimeKey(b.event.datetime)) || a.index - b.index);
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

// Read-only baseline. It is never added to the persisted events array.
function getLegacyEntryBaseline(trade) {
  let price, quantity, datetime, source;
  if (isCryptoTrade(trade)) {
    const c = trade.cryptoJournal;
    price = c.entryPrice; quantity = c.positionSize; datetime = c.entryAt; source = 'cryptoJournal';
  } else if (trade.entryPrice !== undefined && trade.quantity !== undefined) {
    price = Number(trade.entryPrice); quantity = Number(trade.quantity);
    datetime = trade.entryAt || (trade.date ? trade.date + 'T00:00' : null); source = 'legacy';
  } else {
    if (!Array.isArray(trade.legs) || trade.legs.some(leg => !leg || !validCryptoDateTime(leg.date))) return null;
    const legs = trade.legs
      .map((leg, index) => ({ leg, index })).sort((a, b) => a.leg.date.localeCompare(b.leg.date) || a.index - b.index);
    if (!legs.length) return null;
    const action = legs[0].leg.action;
    if (!['buy', 'sell'].includes(action)) return null;
    const opening = [];
    for (const { leg } of legs) {
      if (leg.action !== action) break;
      if (!(Number.isFinite(Number(leg.price)) && Number(leg.price) > 0 && Number.isFinite(Number(leg.quantity)) && Number(leg.quantity) > 0)) return null;
      opening.push(leg);
    }
    quantity = eventStateSum(opening.map(leg => Number(leg.quantity)));
    price = eventStateSum(opening.map(leg => Number(leg.price) * (Number(leg.quantity) / quantity)));
    datetime = legs[0].leg.date; source = 'openingLegs';
  }
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !validCryptoDateTime(datetime)) return null;
  return { price, quantity, datetime, source };
}

// Read-only position calculation; no values are copied back to legacy fields.
function getTradeState(trade) {
  if (trade.historyMode === 'summary') return resolveSummaryTradeState(trade);
  if (hasTradeEventHistory(trade)) {
    const state = calculateEventTradeState(trade.events);
    if (state.issues.some(issue => issue.code === 'INVALID_EVENTS') || trade.events.some(event => event.type === 'Entry')) return state;
    const baseline = getLegacyEntryBaseline(trade);
    if (!baseline) return state;
    let id = '__legacy_entry_baseline__';
    while (trade.events.some(event => event.id === id)) id += '_';
    const synthetic = { id, type: 'Entry', ...baseline, realizedPnl: null, reason: '', memo: '' };
    const derived = calculateEventTradeState([synthetic, ...trade.events]);
    // Issue indices refer to persisted history, excluding the virtual baseline.
    for (const issue of derived.issues) if (typeof issue.index === 'number') issue.index--;
    return { ...derived, baselineUsed: true, baseline };
  }
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

// Summary and event states never fall back to stale Entry/Exit fields, even when invalid.
function hasResolvedTradeState(trade) {
  return (trade.historyMode !== undefined && trade.historyMode !== 'full') || trade.finalSummary !== undefined || hasTradeEventHistory(trade);
}
function validateTradeSummary(trade) {
  if (trade.historyMode === undefined && trade.finalSummary === undefined) return;
  if (trade.historyMode === 'full' && trade.finalSummary === undefined) return;
  const s = trade.finalSummary;
  if (trade.historyMode !== 'summary' || !s || typeof s !== 'object' || Array.isArray(s) ||
      !validTradeEventDateTime(s.datetime) || !Number.isFinite(s.realizedPnl) ||
      !['Win', 'Loss', 'BE'].includes(s.result) ||
      !(s.price === null || (Number.isFinite(s.price) && s.price > 0)) || typeof s.rawText !== 'string') {
    throw new Error('Final Summaryの日時・実現損益・結果・原文を確認してください。');
  }
}
function resolveSummaryTradeState(trade) {
  const state = { source: 'summary', historyMode: 'summary', isValid: true, issues: [],
    status: 'Closed', totalEntryQuantity: null, averageEntryPrice: null, closedQuantity: null,
    remainingQuantity: 0, rawRemainingQuantity: 0, realizedPnl: null, result: '',
    lastExitDatetime: null, lastExitPrice: null, addEntryCount: null, partialTpCount: null,
    partialSlCount: null, realizedPnlEventCount: null, missingRealizedPnlCount: null, epsilon: 0 };
  try { validateTradeSummary(trade); }
  catch (error) { return { ...state, isValid: false, status: 'Invalid', remainingQuantity: null,
    issues: [{ code: 'INVALID_SUMMARY', message: error.message }] }; }
  const s = trade.finalSummary;
  return { ...state, realizedPnl: s.realizedPnl, result: s.result,
    lastExitDatetime: s.datetime, lastExitPrice: s.price };
}
function getResolvedTradeState(trade) {
  try { validateTradeSummary(trade); }
  catch (error) { return { source: 'invalid', isValid: false, status: 'Invalid', issues: [{ code: 'INVALID_SUMMARY', message: error.message }],
    totalEntryQuantity: null, averageEntryPrice: null, closedQuantity: null, remainingQuantity: null,
    realizedPnl: null, lastExitDatetime: null, lastExitPrice: null, result: '', epsilon: 0 }; }
  const s = getTradeState(trade);
  if (s.source === 'summary') return s;
  const result = s.source === 'events'
    ? s.isValid && s.status === 'Closed'
      ? trade.exitUpdate?.result || (s.realizedPnlEventCount ? s.realizedPnl > 0 ? 'Win' : s.realizedPnl < 0 ? 'Loss' : 'BE' : '') : ''
    : isCryptoTrade(trade) ? (cryptoRealizationDate(trade) ? trade.cryptoJournal.result : '')
      : s.realizedPnl > 0 ? 'Win' : s.realizedPnl < 0 ? 'Loss' : 'BE';
  return { ...s, historyMode: s.source === 'events' ? 'full' : 'legacy', result };
}
function getResolvedRealizations(trade) {
  const s = getResolvedTradeState(trade);
  if (!s.isValid) return {};
  if (s.source === 'summary') return { [s.lastExitDatetime.split('T')[0]]: s.realizedPnl };
  const dates = {};
  for (const event of trade.events || []) {
    if (['Partial TP', 'Partial SL', 'Final Exit'].includes(event.type) && event.realizedPnl !== null) {
      const date = event.datetime.split('T')[0];
      (dates[date] ||= []).push(event.realizedPnl);
    }
  }
  return Object.fromEntries(Object.entries(dates).map(([date, values]) => [date, eventStateSum(values)]));
}
function getTradeActivityDates(trade) {
  if (!hasResolvedTradeState(trade)) return isCryptoTrade(trade) ? cryptoTradeDates(trade) :
    [...new Set([trade.date, ...(trade.legs || []).map(leg => leg.date?.split('T')[0])].filter(Boolean))];
  const s = getResolvedTradeState(trade);
  return [...new Set([trade.date, ...(Array.isArray(trade.events) ? trade.events : []).map(event => event?.datetime?.split('T')[0]),
    s.lastExitDatetime?.split('T')[0]].filter(Boolean))];
}
