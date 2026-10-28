function tradeStateAndEventsHtml(trade) {
  if (!hasResolvedTradeState(trade)) return '';
  const s = getResolvedTradeState(trade), value = v => v === null || v === undefined ? '—' : escHtml(String(v));
  const metrics = [ ['結果', s.result], ['平均建値', s.averageEntryPrice], ['総Entry数量', s.totalEntryQuantity],
    ['決済済み数量', s.closedQuantity], ['残数量', s.remainingQuantity], ['累計実現損益', s.realizedPnl],
    ['最終Exit日時', s.lastExitDatetime], ['最終Exit価格', s.lastExitPrice], ['Add Entry回数', s.addEntryCount],
    ['Partial TP回数', s.partialTpCount], ['Partial SL回数', s.partialSlCount] ];
  const history = Array.isArray(trade.events) ? trade.events.map((event, index) => ({ event, index }))
    .sort((a, b) => tradeEventTimeKey(String(a.event?.datetime)).localeCompare(tradeEventTimeKey(String(b.event?.datetime))) || a.index - b.index) : [];
  return `<section class="trade-state-panel" aria-label="Trade State"><h3>Trade State · ${value(s.status)}</h3><p>${s.source === 'summary' ? 'Summary · 途中イベント未記録（数量・平均建値の履歴は不明）' : 'Full History'}</p>
    ${s.baselineUsed ? '<p class="crypto-hint">旧Entry情報を計算上の基準に使用しています。Entry eventの書込みは行っていません。</p>' : ''}
    ${trade.finalSummary?.rawText ? `<details><summary>簡易クローズ原文</summary><pre class="analysis-original">${value(trade.finalSummary.rawText)}</pre></details>` : ''}
    ${s.issues.length ? `<ul class="trade-state-warnings" role="status">${s.issues.map(issue => `<li>${value(issue.code)}${issue.message ? ': ' + value(issue.message) : ''}</li>`).join('')}</ul>` : ''}
    <dl class="trade-state-grid">${metrics.map(([label, v]) => `<div><dt>${label}</dt><dd>${value(v)}</dd></div>`).join('')}</dl>
    <p class="crypto-hint">表示・カレンダー・統計は同じ決済結果を参照します。Entryの保存値は変更しません。</p></section>
    <section class="trade-events-panel" aria-label="売買履歴"><h3>売買履歴 / Trade Events</h3>
      <ol class="trade-event-list">${history.map(({ event: e }) => `<li class="trade-event-card"><strong>${value(e?.type)}</strong>
        <p>${value(e?.datetime)}</p><dl><dt>価格</dt><dd>${value(e?.price)}</dd><dt>数量</dt><dd>${value(e?.quantity)}</dd>
        <dt>実現損益</dt><dd>${value(e?.realizedPnl)}</dd><dt>理由</dt><dd>${value(e?.reason)}</dd><dt>メモ</dt><dd>${value(e?.memo)}</dd></dl>
        ${e?.rawText !== undefined ? `<details><summary>更新原文</summary><pre class="analysis-original">${value(e.rawText)}</pre></details>` : ''}</li>`).join('')}</ol></section>`;
}

function exitUpdateDetailsHtml(trade) {
  if (!trade.exitUpdate) return '';
  const resolved = getResolvedTradeState(trade);
  const update = trade.exitUpdate;
  const field = (label, text) => `<div><strong>${label}</strong><p>${escHtml(text || '')}</p></div>`;
  return `<section class="exit-update-panel" aria-label="Exit / Update情報"><h3>Exit / Update情報</h3>
    ${(trade.historyMode === 'summary' || trade.events?.some(event => event.type === 'Final Exit')) && update.analysis ? `<details class="crypto-details"><summary>Exit分析</summary>${EXIT_ANALYSIS_FIELDS.map(([key, label]) => update.analysis[key] ? field(label, update.analysis[key]) : '').join('')}</details>` : ''}
    ${resolved.result ? field('結果', resolved.result) : ''}
    ${field('Exit理由', update.reason)}${field('Exit時メモ', update.memo)}${field('Exitレビュー', update.review)}</section>`;
}

function resolvedTradeSummaryHtml(trade) {
  const s = getResolvedTradeState(trade), v = n => n === null || n === undefined ? '—' : escHtml(String(n));
  return `<div class="crypto-summary resolved-trade-summary"><strong>${v(s.status)} · ${s.source === 'summary' ? 'Summary（途中イベント未記録）' : 'Full History'}</strong>
    <span>${v(s.result)} / 実現損益 ${v(s.realizedPnl)}</span>
    <span>平均Entry ${v(s.averageEntryPrice)} / 総Entry数量 ${v(s.totalEntryQuantity)} / 残数量 ${v(s.remainingQuantity)}</span>
    <span>最終Exit ${v(s.lastExitDatetime)} / ${v(s.lastExitPrice)}</span></div>`;
}
