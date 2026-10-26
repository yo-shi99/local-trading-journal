function tradeStateAndEventsHtml(trade) {
  if (!hasTradeEventHistory(trade)) return '';
  const s = getTradeState(trade), value = v => v === null || v === undefined ? '—' : escHtml(String(v));
  const metrics = [ ['平均建値', s.averageEntryPrice], ['総Entry数量', s.totalEntryQuantity],
    ['決済済み数量', s.closedQuantity], ['残数量', s.remainingQuantity], ['累計実現損益', s.realizedPnl],
    ['最終Exit日時', s.lastExitDatetime], ['最終Exit価格', s.lastExitPrice], ['Add Entry回数', s.addEntryCount],
    ['Partial TP回数', s.partialTpCount], ['Partial SL回数', s.partialSlCount] ];
  const history = Array.isArray(trade.events) ? trade.events.map((event, index) => ({ event, index }))
    .sort((a, b) => String(a.event?.datetime).localeCompare(String(b.event?.datetime)) || a.index - b.index) : [];
  return `<section class="trade-state-panel" aria-label="Trade State"><h3>Trade State · ${value(s.status)}</h3>
    ${s.baselineUsed ? '<p class="crypto-hint">旧Entry情報を計算上の基準に使用しています。Entry eventの書込みは行っていません。</p>' : ''}
    ${s.issues.length ? `<ul class="trade-state-warnings" role="status">${s.issues.map(issue => `<li>${value(issue.code)}${issue.message ? ': ' + value(issue.message) : ''}</li>`).join('')}</ul>` : ''}
    <dl class="trade-state-grid">${metrics.map(([label, v]) => `<div><dt>${label}</dt><dd>${value(v)}</dd></div>`).join('')}</dl>
    <p class="crypto-hint">eventsからの読取計算です。従来の保存値・カレンダー集計は変更しません。</p></section>
    <section class="trade-events-panel" aria-label="売買履歴"><h3>売買履歴 / Trade Events</h3>
      <ol class="trade-event-list">${history.map(({ event: e }) => `<li class="trade-event-card"><strong>${value(e?.type)}</strong>
        <p>${value(e?.datetime)}</p><dl><dt>価格</dt><dd>${value(e?.price)}</dd><dt>数量</dt><dd>${value(e?.quantity)}</dd>
        <dt>実現損益</dt><dd>${value(e?.realizedPnl)}</dd><dt>理由</dt><dd>${value(e?.reason)}</dd><dt>メモ</dt><dd>${value(e?.memo)}</dd></dl></li>`).join('')}</ol></section>`;
}

function exitUpdateDetailsHtml(trade) {
  if (!trade.exitUpdate) return '';
  const update = trade.exitUpdate;
  const field = (label, text) => `<div><strong>${label}</strong><p>${escHtml(text || '')}</p></div>`;
  return `<section class="exit-update-panel" aria-label="Exit / Update情報"><h3>Exit / Update情報</h3>
    ${field('Exit理由', update.reason)}${field('Exit時メモ', update.memo)}${field('Exitレビュー', update.review)}</section>`;
}
