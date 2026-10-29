// Entry cohorts and realized performance are intentionally separate.
function periodTradeCard(t){
  const s=getResolvedTradeState(t),v=x=>escHtml(String(x??'—'));
  const dates=Object.keys(getRealizationsByDate(t)).sort();
  return `<article class="trade-item period-trade" data-trade-id="${v(t.id)}"><button class="period-trade-link" data-open-trade="${v(t.id)}"><strong>${v(t.symbol)} / ${v(t.cryptoJournal?.direction||t.side)}</strong>
    <span>Entry ${v(getTradeEntryDatetime(t))} @ ${v(t.cryptoJournal?.entryPrice??t.entryPrice)}</span>
    <span>Exit ${v(s.lastExitDatetime)} @ ${v(s.lastExitPrice)}</span>
    <span>${v(s.status)} · ${tradeModeLabel(t)} · ${v(s.result)}</span>
    <span class="ti-pnl">Realized P&amp;L ${s.isValid?(s.realizedPnl<0?'-':'')+'$'+(isCryptoTrade(t)||hasResolvedTradeState(t)?journalAmount(s.realizedPnl,[t]):Math.abs(s.realizedPnl).toFixed(2)):'—'}</span>
    <small>P&amp;L booked on ${dates.length?dates.map(v).join(', '):'未確定'}</small></button></article>`;
}
function refreshPeriodModal(start,end,weekly=false){
  const trades=applyGlobalFilter(load()),p=getPeriodTradeStats(trades,start,end);
  const money=n=>(n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:8});
  const cards=[['Realized P&L',money(p.realizedPnl)],['Closed Trades',p.closedTrades],['Wins',p.wins],['Losses',p.losses],['BE',p.be],['Avg Win',p.avgWin===null?'—':p.avgWin],['Avg Loss',p.avgLoss===null?'—':p.avgLoss],['Profit Factor',p.pf]];
  document.getElementById('day-summary').innerHTML=`<h3 class="period-heading">${weekly?'Weekly':'Daily'} Summary</h3>`+cards.map(([label,value])=>`<div class="ds-card"><div class="ds-label">${escHtml(label)}</div><div class="ds-value">${escHtml(String(value))}</div></div>`).join('');
  document.getElementById('trade-list').innerHTML=`<section aria-label="Closed Trades"><h3>Closed Trades ${p.closedTrades}</h3>${p.closed.map(periodTradeCard).join('')}</section><section aria-label="Entries"><h3>Entries ${p.entries.length}</h3>${p.entries.map(periodTradeCard).join('')||'<p>この期間のEntryはありません。</p>'}</section>`;
  document.getElementById('trade-list').onclick=e=>{const link=e.target.closest('[data-open-trade]');if(link)openTradeDetail(link.dataset.openTrade);};
}
