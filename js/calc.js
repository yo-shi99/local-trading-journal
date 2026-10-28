// FIFO match buy legs against sell legs.
// Returns { 'YYYY-MM-DD': realizedPnl, ... } keyed by each sell leg's date.
function getRealizationsByDate(t) {
  if (hasResolvedTradeState(t)) return getResolvedRealizations(t);
  if (isCryptoTrade(t)) { const date = cryptoRealizationDate(t); return date ? { [date]: t.cryptoJournal.realizedPnl } : {}; }
  if (!t.legs || !t.legs.length) {
    // Legacy format — attribute to trade date
    return { [t.date]: _getPnlLegacy(t) };
  }

  const mult = t.type === 'option' ? 100 : 1;

  // Build FIFO queue from buy legs (in order)
  const buyQueue = t.legs
    .filter(l => l.action === 'buy')
    .map(l => ({
      price:     parseFloat(l.price)      || 0,
      comm:      parseFloat(l.commission) || 0,
      fees:      parseFloat(l.fees)       || 0,
      totalQty:  parseFloat(l.quantity)   || 0,
      remaining: parseFloat(l.quantity)   || 0,
    }));

  const result = {};

  for (const leg of t.legs) {
    if (leg.action !== 'sell') continue;

    const sellDate  = leg.date ? leg.date.split('T')[0] : t.date;
    const sellPrice = parseFloat(leg.price)      || 0;
    const sellComm  = parseFloat(leg.commission) || 0;
    const sellFees  = parseFloat(leg.fees)       || 0;
    const sellQty   = parseFloat(leg.quantity)   || 0;
    let   sellLeft  = sellQty;

    let revenue  = 0;
    let buyCost  = 0;
    let buyComm  = 0;
    let buyFees  = 0;
    let matched  = 0;

    for (const buy of buyQueue) {
      if (buy.remaining <= 0 || sellLeft <= 0) continue;
      const qty   = Math.min(buy.remaining, sellLeft);
      const ratio = buy.totalQty > 0 ? qty / buy.totalQty : 0;

      revenue  += sellPrice * qty * mult;
      buyCost  += buy.price * qty * mult;
      buyComm  += buy.comm * ratio;
      buyFees  += buy.fees * ratio;
      matched  += qty;

      buy.remaining -= qty;
      sellLeft      -= qty;
    }

    if (matched > 0) {
      const sellRatio = sellQty > 0 ? matched / sellQty : 1;
      const pnl = revenue - buyCost
                  - sellComm * sellRatio - sellFees * sellRatio
                  - buyComm - buyFees;
      result[sellDate] = (result[sellDate] || 0) + Math.round(pnl * 100) / 100;
    }
  }

  return result;
}

function getOpenQty(t) {
  if (hasResolvedTradeState(t)) return getResolvedTradeState(t).remainingQuantity;
  if (isCryptoTrade(t)) return t.cryptoJournal.exitAt ? 0 : t.cryptoJournal.positionSize;
  if (!t.legs || !t.legs.length) return 0;
  const buyQueue = t.legs
    .filter(l => l.action === 'buy')
    .map(l => ({ remaining: parseFloat(l.quantity) || 0 }));
  for (const leg of t.legs) {
    if (leg.action !== 'sell') continue;
    let left = parseFloat(leg.quantity) || 0;
    for (const buy of buyQueue) {
      if (buy.remaining <= 0 || left <= 0) continue;
      const qty = Math.min(buy.remaining, left);
      buy.remaining -= qty;
      left          -= qty;
    }
  }
  return buyQueue.reduce((s, b) => s + b.remaining, 0);
}

function getPnl(t) {
  if (hasResolvedTradeState(t)) { const s = getResolvedTradeState(t); return s.isValid ? s.realizedPnl : 0; }
  if (isCryptoTrade(t)) return cryptoRealizationDate(t) ? t.cryptoJournal.realizedPnl : 0;
  if (t.legs && t.legs.length) {
    const total = Object.values(getRealizationsByDate(t)).reduce((s, p) => s + p, 0);
    return Math.round(total * 100) / 100;
  }
  return _getPnlLegacy(t);
}

function _getPnlLegacy(t) {
  const qty   = parseFloat(t.quantity)   || 0;
  const entry = parseFloat(t.entryPrice) || 0;
  const exit  = parseFloat(t.exitPrice)  || 0;
  const comm  = parseFloat(t.commission) || 0;
  const fees  = parseFloat(t.fees)       || 0;
  const mult  = t.type === 'option' ? 100 : 1;
  const dir   = t.side === 'long' ? 1 : -1;
  return Math.round((dir * (exit - entry) * qty * mult - comm - fees) * 100) / 100;
}

function computeStats(trades) {
  const invalid = trades.filter(t => hasResolvedTradeState(t) && !getResolvedTradeState(t).isValid).length;
  trades = trades.filter(t => !hasResolvedTradeState(t) || getResolvedTradeState(t).isValid);
  let totalPnl = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0;
  const byDate = {};
  let positivePnlCount = 0, negativePnlCount = 0;
  for (const t of trades) {
    const p = getPnl(t);
    totalPnl += p;
    if (tradeOutcome(t) === 'Win') wins++;
    if (tradeOutcome(t) === 'Loss') losses++;
    const settled = !hasResolvedTradeState(t) || getResolvedTradeState(t).status === 'Closed';
    if (settled && p > 0) { positivePnlCount++; grossWin += p; }
    if (settled && p < 0) { negativePnlCount++; grossLoss += Math.abs(p); }
    // Use sell dates for best/worst day calculation
    const realizations = getRealizationsByDate(t);
    for (const [date, dp] of Object.entries(realizations)) {
      byDate[date] = (byDate[date] || 0) + dp;
    }
  }
  const days     = Object.values(byDate);
  const bestDay  = days.length ? Math.max(...days) : null;
  const worstDay = days.length ? Math.min(...days) : null;
  const classified = trades.filter(t => hasResolvedTradeState(t) ? ['Win', 'Loss', 'BE'].includes(tradeOutcome(t)) : !isCryptoTrade(t) || ['Win', 'Loss', 'BE'].includes(tradeOutcome(t))).length;
  const winRate = classified ? ((wins / classified) * 100).toFixed(1) : '0.0';
  const avgWin   = positivePnlCount ? (trades.some(t => isCryptoTrade(t) || hasResolvedTradeState(t)) ? grossWin / positivePnlCount : Math.round(grossWin / positivePnlCount)).toLocaleString('en-US', { maximumFractionDigits: 8 })   : null;
  const avgLoss  = negativePnlCount ? (trades.some(t => isCryptoTrade(t) || hasResolvedTradeState(t)) ? grossLoss / negativePnlCount : Math.round(grossLoss / negativePnlCount)).toLocaleString('en-US', { maximumFractionDigits: 8 }) : null;
  const pf       = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2)
                 : grossWin  > 0 ? '∞' : '—';
  return { totalPnl, wins, losses, grossWin, grossLoss, winRate, avgWin, avgLoss, pf, bestDay, worstDay, total: trades.length, invalid, classifiedCount: classified, positivePnlCount, negativePnlCount, avgWinValue: positivePnlCount ? grossWin / positivePnlCount : null, avgLossValue: negativePnlCount ? grossLoss / negativePnlCount : null };
}

// Dollar risk for a trade. Uses the stop-loss rows when they are defined,
// otherwise the whole entry cost is treated as the amount at risk.
function getTradeRisk(t) {
  if (hasResolvedTradeState(t)) { const s = getResolvedTradeState(t), sl = t.cryptoJournal?.stopLossPrice; return s.isValid && s.source === 'events' && Number.isFinite(sl) && s.averageEntryPrice !== null ? Math.abs(s.averageEntryPrice - sl) * s.totalEntryQuantity : null; }
  if (isCryptoTrade(t)) { const c = t.cryptoJournal; return c.stopLossPrice === null ? null : Math.abs(c.entryPrice - c.stopLossPrice) * c.positionSize; }
  const mult = t.type === 'option' ? 100 : 1;

  if (!t.legs || !t.legs.length) {
    const risk = Math.abs((parseFloat(t.entryPrice) || 0) * (parseFloat(t.quantity) || 0) * mult);
    return risk > 0 ? risk : null;
  }

  const buyLegs     = t.legs.filter(l => l.action === 'buy');
  const totalBuyQty = buyLegs.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
  if (!totalBuyQty) return null;

  const avgEntry = buyLegs.reduce((s, l) => s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0), 0) / totalBuyQty;

  const sls = (t.stopLoss || []).filter(sl =>
    sl.price !== '' && sl.price !== null && !isNaN(parseFloat(sl.price)) && parseFloat(sl.qty) > 0);
  if (sls.length) {
    const stopRisk = Math.abs(sls.reduce((s, sl) =>
      s + ((parseFloat(sl.price) || 0) - avgEntry) * (parseFloat(sl.qty) || 0) * mult, 0));
    if (stopRisk > 0) return stopRisk;
  }

  const cost = Math.abs(avgEntry * totalBuyQty * mult);
  return cost > 0 ? cost : null;
}

function getEntryQty(t) {
  if (hasResolvedTradeState(t)) return getResolvedTradeState(t).totalEntryQuantity;
  if (isCryptoTrade(t)) return t.cryptoJournal.positionSize;
  if (!t.legs || !t.legs.length) return parseFloat(t.quantity) || 0;
  return t.legs.filter(l => l.action === 'buy').reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
}

// Risk attributed to each date P&L was realized on, prorated by the quantity
// closed that day so partial closes carry only their share of the risk.
// Mirrors the FIFO order of getRealizationsByDate.
function getRiskByDate(t) {
  if (hasResolvedTradeState(t)) {
    const s = getResolvedTradeState(t), risk = getTradeRisk(t);
    if (!s.isValid || s.source !== 'events' || !risk || !s.totalEntryQuantity) return {};
    const result = {};
    for (const e of t.events || []) if (['Partial TP', 'Partial SL', 'Final Exit'].includes(e.type)) {
      const date = e.datetime.split('T')[0]; result[date] = (result[date] || 0) + risk * e.quantity / s.totalEntryQuantity;
    }
    return result;
  }
  if (isCryptoTrade(t)) { const date = cryptoRealizationDate(t); return date ? { [date]: getTradeRisk(t) || 0 } : {}; }
  const risk     = getTradeRisk(t);
  const entryQty = getEntryQty(t);
  if (!risk || !entryQty) return {};
  const perUnit = risk / entryQty;

  if (!t.legs || !t.legs.length) return { [t.date]: risk };

  const buyQueue = t.legs
    .filter(l => l.action === 'buy')
    .map(l => ({ remaining: parseFloat(l.quantity) || 0 }));

  const result = {};
  for (const leg of t.legs) {
    if (leg.action !== 'sell') continue;
    const sellDate = leg.date ? leg.date.split('T')[0] : t.date;
    let left    = parseFloat(leg.quantity) || 0;
    let matched = 0;
    for (const buy of buyQueue) {
      if (buy.remaining <= 0 || left <= 0) continue;
      const qty = Math.min(buy.remaining, left);
      buy.remaining -= qty;
      left          -= qty;
      matched       += qty;
    }
    if (matched > 0) result[sellDate] = (result[sellDate] || 0) + matched * perUnit;
  }
  return result;
}

// P&L as a percentage of the risk behind the closed portion of the trade.
// null while nothing is closed yet.
function getPnlPct(t) {
  const closedRisk = Object.values(getRiskByDate(t)).reduce((s, r) => s + r, 0);
  if (!closedRisk) return null;
  return (getPnl(t) / closedRisk) * 100;
}
