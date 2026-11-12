function renderStats() {
  const s = computeStats(applyGlobalFilter(load()));
  const f = (n) => {
    if (n === null) return '—';
    const abs = journalAmount(n, load());
    return (n < 0 ? '-$' : '$') + abs;
  };
  const pnlCls = s.totalPnl > 0 ? 'pos' : s.totalPnl < 0 ? 'neg' : 'neu';
  const cards = [
    ['Realized P&L',       `<span title="Net確定時はNet、未登録・未確定時は従来値" class="${pnlCls}">${f(s.totalPnl)}</span>`],
    ['Win Rate',      `<span class="neu">${s.winRate}%</span>`],
    ['Total Trades',  `<span class="neu">${s.total}</span>`],
    ['Wins',          `<span class="pos">${s.wins}</span>`],
    ['Losses',        `<span class="neg">${s.losses}</span>`],
    ['Avg Win',       `<span class="pos">${s.avgWin ? '$'+s.avgWin : '—'}</span>`],
    ['Avg Loss',      `<span class="neg">${s.avgLoss ? '-$'+s.avgLoss : '—'}</span>`],
    ['Profit Factor', `<span class="neu">${s.pf}</span>`],
  ];
  const financials=getPeriodFinancials(applyGlobalFilter(load()),'0000-01-01','9999-12-31');
  if(financials.totalFees!==null)cards.push(['Gross P&L',f(financials.grossRealizedPnl)],['Fees',f(financials.totalFees)],['Confirmed Net P&L',financials.netRealizedPnl===null?'未確定':f(financials.netRealizedPnl)]);
  if (s.invalid) cards.push(['Invalid（集計対象外）', `<span>${s.invalid}</span>`]);
  document.getElementById('stats-bar').innerHTML = cards.map(([lbl, val]) =>
    `<div class="stat-card"><div class="stat-label">${lbl}</div><div class="stat-value">${val}</div></div>`
  ).join('');
}
