/* Additive crypto journal records. Legacy trades and IndexedDB schema are unchanged. */
const CRYPTO_STRATEGIES = ['Breakout', 'SFP', 'Absorption', 'Pullback', 'その他'];
const CRYPTO_FLOW_FIELDS = [
  ['cvd', 'CVD'], ['oi', 'OI'], ['fundingRate', 'Funding Rate'], ['footprint', 'Footprint'],
  ['imbalance', 'Imbalance / Stacked Imbalance'], ['orderBook', 'Order Book / Heatmap'],
  ['marketProfile', 'TPO / Market Profile'],
];
// Optional additions: legacy orderFlow keys remain the single source for existing fields.
const ENTRY_ANALYSIS_FIELDS = [
  ['priceStructure', 'Price Structure'], ['keyLevelZone', 'Key Level / Zone'],
  ['futuresCvd', 'Futures CVD'], ['spotCvd', 'Spot CVD'], ['volume', 'Volume'],
  ['futuresBidAskDelta', 'Futures Bid & Ask Delta'], ['invalidation', 'Invalidation条件'],
];
const EXIT_ANALYSIS_FIELDS = [
  ['exitPriceStructure', 'Exit時Price Structure'], ['exitFuturesCvd', 'Exit時Futures CVD'],
  ['exitSpotCvd', 'Exit時Spot CVD'], ['exitOi', 'Exit時OI'], ['exitFundingRate', 'Exit時Funding Rate'],
  ['exitVolume', 'Exit時Volume'], ['exitFuturesBidAskDelta', 'Exit時Futures Bid & Ask Delta'],
  ['exitFootprint', 'Exit時Footprint'], ['exitOrderBookHeatmap', 'Exit時Order Book / Heatmap'],
];
function validateOptionalAnalysis(analysis, fields) {
  if (analysis === undefined) return;
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis) ||
      fields.some(([key]) => analysis[key] !== undefined && typeof analysis[key] !== 'string')) {
    throw new Error('分析項目は文字列で入力してください。');
  }
}
let cryptoFormActive = false;
let cryptoSaving = false;
let cryptoResultManual = false;
function isCryptoTrade(t) { return t?.cryptoJournal?.version === 1; }
// A zero amount does not imply the trader's qualitative BE classification.
function cryptoOutcome(pnl) { return pnl === null || pnl === 0 ? '' : pnl > 0 ? 'Win' : 'Loss'; }
function cryptoRealizationDate(t) {
  if (hasResolvedTradeState(t)) { const s = getResolvedTradeState(t); return s.isValid && s.status === 'Closed' ? s.lastExitDatetime?.split('T')[0] || null : null; }
  const c = t.cryptoJournal;
  return c?.exitAt && Number.isFinite(c.realizedPnl) ? c.exitAt.split('T')[0] : null;
}
function journalAmount(value, trades) {
  return trades.some(t => isCryptoTrade(t) || hasResolvedTradeState(t)) ? Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : Math.round(Math.abs(value)).toLocaleString('en-US');
}
function tradeOutcome(t) { return getResolvedTradeState(t).result; }

function cryptoTradeDates(t) {
  if (hasResolvedTradeState(t)) return getTradeActivityDates(t);
  return [t.date, t.cryptoJournal?.exitAt?.split('T')[0]].filter(Boolean);
}
function validCryptoDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const d = new Date(value), pad = n => String(n).padStart(2, '0');
  return Number.isFinite(d.getTime()) && `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` === value;
}
function cryptoNumber(id) {
  const field = document.getElementById(id);
  if (field.validity.badInput) throw new Error('数値を正しく入力してください。');
  const raw = field.value.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error('数値を正しく入力してください。');
  return n;
}
function cryptoChoices(name, values, title) {
  return `<fieldset class="crypto-choices"><legend>${title}</legend>${values.map(value =>
    `<label><input type="radio" name="${name}" value="${value}"><span>${value}</span></label>`).join('')}</fieldset>`;
}
function cryptoInput(id, label, type = 'number', extra = '') {
  return `<label class="crypto-field" for="${id}">${label}<input id="${id}" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${extra}></label>`;
}
function cryptoText(id, label) {
  return `<label class="crypto-field" for="${id}">${label}<textarea id="${id}" rows="3"></textarea></label>`;
}
function initCryptoFields() {
  const root = document.getElementById('crypto-fields');
  if (root.childElementCount) return;
  root.innerHTML = `
    <h3>Entry情報</h3><p class="crypto-hint">従来のEntry・分析内容を保持します。Exit理由・レビュー・更新画像は下の独立欄へ入力してください。</p>
    ${analysisImportMarkup()}
    ${cryptoChoices('crypto-asset', ['BTC', 'ETH', 'SOL', 'その他'], '銘柄')}
    ${cryptoInput('crypto-symbol-other', 'その他の銘柄', 'text')}
    ${cryptoChoices('crypto-direction', ['Long', 'Short'], '取引方向')}
    ${cryptoInput('crypto-entry-at', 'エントリー日時', 'datetime-local')}
    ${cryptoInput('crypto-exit-at', '決済日時（Exit datetime・未決済は空欄）', 'datetime-local')}
    ${cryptoInput('crypto-entry-price', 'エントリー価格', 'number', 'min="0"')}
    ${cryptoInput('crypto-sl', '損切り価格（SL・任意）', 'number', 'min="0"')}
    ${cryptoInput('crypto-tp', '利確価格（TP・任意）', 'number', 'min="0"')}
    ${cryptoInput('crypto-size', 'ポジションサイズ（銘柄の数量）', 'number', 'min="0"')}
    <p class="crypto-hint">価格と損益は同じ決済通貨で入力してください（例：USDT）。レバレッジ・契約枚数の換算は行いません。</p>
    ${cryptoInput('crypto-pnl', '実現損益（手数料等を含む確定額・未決済は空欄）')}
    ${cryptoChoices('crypto-result', ['Win', 'Loss', 'BE'], '保存ラベル（参考・Closedの結果は損益から自動判定）')}
    <button type="button" id="crypto-result-auto">損益から結果を再判定</button>
    <p class="crypto-hint">保存ラベルは参考値です。Closedの表示・集計は最終実現損益からWin / Loss / BEを自動判定します。Openでは結果を確定しません。</p>
    ${cryptoChoices('crypto-strategy', CRYPTO_STRATEGIES, '戦略タグ（任意）')}
    ${cryptoInput('crypto-strategy-other', 'その他の戦略', 'text')}
    ${cryptoText('crypto-reason', 'エントリー根拠')}
    ${cryptoText('crypto-review', '振り返り（従来欄・Entry時メモ）')}
    <details class="crypto-details"><summary>Entry分析（任意）</summary>
      <p class="crypto-hint">数値・文章のどちらでも記録できます。</p>
      ${ENTRY_ANALYSIS_FIELDS.map(([key, label]) => cryptoText('crypto-analysis-' + key, label)).join('')}
      ${CRYPTO_FLOW_FIELDS.map(([key, label]) => cryptoText('crypto-flow-' + key, label)).join('')}
    </details>
    <details class="crypto-details" id="crypto-legacy-options"><summary>従来の入力形式</summary>
      <button type="button" id="crypto-legacy-toggle">従来形式で入力する</button>
    </details>`;
  initAnalysisImport(root);
  root.querySelectorAll('input[name="crypto-asset"], input[name="crypto-strategy"]').forEach(input => input.addEventListener('change', updateCryptoChoices));
  const suggestResult = () => {
    const raw = document.getElementById('crypto-pnl').value;
    selectCryptoChoice('crypto-result', raw === '' ? '' : cryptoOutcome(Number(raw)));
  };
  document.getElementById('crypto-pnl').addEventListener('input', () => {
    if (!cryptoResultManual) suggestResult();
  });
  root.querySelectorAll('input[name="crypto-result"]').forEach(input => input.addEventListener('change', () => {
    cryptoResultManual = true;
  }));
  document.getElementById('crypto-result-auto').addEventListener('click', () => {
    cryptoResultManual = false;
    suggestResult();
  });
  document.getElementById('crypto-legacy-toggle').addEventListener('click', () => {
    cryptoFormActive = false;
    root.hidden = true;
    document.getElementById('legacy-trade-fields').hidden = false;
    document.getElementById('legacy-notes').hidden = false;
  });
}
function selectedCryptoChoice(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value || ''; }
function selectCryptoChoice(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(input => { input.checked = input.value === value; });
}
function updateCryptoChoices() {
  document.getElementById('crypto-symbol-other').parentElement.hidden = selectedCryptoChoice('crypto-asset') !== 'その他';
  document.getElementById('crypto-strategy-other').parentElement.hidden = selectedCryptoChoice('crypto-strategy') !== 'その他';
}
function setupCryptoForm(t) {
  initCryptoFields();
  cryptoFormActive = t ? isCryptoTrade(t) : document.body.classList.contains('journal-simple');
  document.getElementById('crypto-fields').hidden = !cryptoFormActive;
  document.getElementById('legacy-trade-fields').hidden = cryptoFormActive;
  document.getElementById('legacy-notes').hidden = cryptoFormActive;
  if (!cryptoFormActive) return;
  const c = t?.cryptoJournal || {};
  resetAnalysisImport(c.analysisText || '');
  // Existing explicit choices are preserved, including records predating resultMode.
  cryptoResultManual = t ? c.resultMode !== 'auto' : false;
  selectCryptoChoice('crypto-asset', t ? (['BTC', 'ETH', 'SOL'].includes(t.symbol) ? t.symbol : 'その他') : 'BTC');
  selectCryptoChoice('crypto-direction', c.direction || 'Long');
  selectCryptoChoice('crypto-result', c.result || '');
  selectCryptoChoice('crypto-strategy', c.strategy || '');
  const values = { 'crypto-symbol-other': t?.symbol || '', 'crypto-entry-at': c.entryAt || nowDatetime(), 'crypto-exit-at': c.exitAt || '',
    'crypto-entry-price': c.entryPrice, 'crypto-sl': c.stopLossPrice, 'crypto-tp': c.takeProfitPrice,
    'crypto-size': c.positionSize, 'crypto-pnl': c.realizedPnl, 'crypto-strategy-other': c.strategyOther,
    'crypto-reason': c.entryReason, 'crypto-review': c.review };
  for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value ?? '';
  for (const [key] of CRYPTO_FLOW_FIELDS) document.getElementById('crypto-flow-' + key).value = c.orderFlow?.[key] ?? '';
  for (const [key] of ENTRY_ANALYSIS_FIELDS) document.getElementById('crypto-analysis-' + key).value = c.entryAnalysis?.[key] ?? '';
  document.querySelectorAll('#crypto-fields details').forEach(details => { details.open = false; });
  document.getElementById('crypto-legacy-options').hidden = Boolean(t);
  updateCryptoChoices();
}
function validateCryptoJournal(c) {
  validateOptionalAnalysis(c?.entryAnalysis, ENTRY_ANALYSIS_FIELDS);
  if (!c || c.version !== 1 || !['Long', 'Short'].includes(c.direction) ||
      !validCryptoDateTime(c.entryAt) ||
      (c.exitAt != null && c.exitAt !== '' && (!validCryptoDateTime(c.exitAt) || c.exitAt < c.entryAt)) ||
      (c.analysisText !== undefined && typeof c.analysisText !== 'string') ||
      !Number.isFinite(c.entryPrice) || c.entryPrice <= 0 || !Number.isFinite(c.positionSize) || c.positionSize <= 0 ||
      ![c.stopLossPrice, c.takeProfitPrice].every(n => n === null || (Number.isFinite(n) && n > 0)) ||
      !(c.realizedPnl === null || Number.isFinite(c.realizedPnl)) || !['', 'Win', 'Loss', 'BE'].includes(c.result) ||
      (c.resultMode !== undefined && !['manual', 'auto'].includes(c.resultMode)) ||
      !['', ...CRYPTO_STRATEGIES].includes(c.strategy) ||
      !['strategyOther', 'entryReason', 'review'].every(key => typeof c[key] === 'string') ||
      !c.orderFlow || !CRYPTO_FLOW_FIELDS.every(([key]) => typeof c.orderFlow[key] === 'string')) {
    throw new Error('暗号資産の入力内容を確認してください。日時・価格・数量は必須です。決済日時はエントリー日時以降にしてください。');
  }
  if (c.strategy === 'その他' && !c.strategyOther.trim()) throw new Error('その他の戦略を入力してください。');
}
async function saveCryptoJournalTrade(options = {}) {
  if ((updateImportSaving && !options.unified) || updateImportImagesBusy) return;
  if (exitUpdateSaving || exitScreenshotsBusy) return;
  if (cryptoSaving || screenshotsBusy) return;
  const generation = analysisFormGeneration;
  cryptoSaving = true;
  const button = document.querySelector('#trade-form button[onclick="saveTrade()"]');
  button.disabled = true;
  try {
    const old = editingId ? load().find(t => t.id === editingId) : null;
    const entryRawText = document.getElementById('crypto-analysis-text').value;
    if (!editingId && document.getElementById('update-import-text').value.trim() && document.getElementById('update-import-text').value !== entryRawText) throw new Error('統一フォームで解析して確認してから保存してください。');
    const textKind = classifyChatgptText(document.getElementById('crypto-analysis-text').value);
    if (textKind.kind === 'update' || textKind.kind === 'invalid' || (textKind.explicit && editingId && entryRawText !== old?.cryptoJournal?.analysisText)) {
      throw new Error(textKind.kind === 'update' ? '更新テキストは既存取引のUpdate Import欄へ貼り付けてください。' : 'New Entryは新規取引画面で登録してください。更新種別も確認してください。');
    }
    const asset = selectedCryptoChoice('crypto-asset');
    const symbol = asset === 'その他' ? document.getElementById('crypto-symbol-other').value.trim().toUpperCase() : asset;
    if (!symbol) throw new Error('銘柄を入力してください。');
    const c = readCryptoJournalDraft(old);
    const trade = { ...(old || {}), id: old?.id || uid(), symbol, type: old?.type || 'stock', date: c.entryAt.split('T')[0],
      screenshots: screenshotsAsBlobs([...screenshotDraft, ...(options.importImages || [])]),
      side: c.direction.toLowerCase(), cryptoJournal: c, notes: old?.notes || '',
      tags: getCheckedTagIds(), mistakes: getCheckedMistakeIds(), rules: getCheckedRuleIds(),
      legs: [{ ...(old?.legs?.[0] || {}), id: old?.legs?.[0]?.id || uid(), action: c.direction === 'Long' ? 'buy' : 'sell',
        date: c.entryAt, price: c.entryPrice, quantity: c.positionSize, commission: 0, fees: 0 }] };
    Object.assign(trade, applyExitUpdateDraft(trade));
    validateScreenshots(trade.screenshots);
    validateTradeEvents(trade.events);
    validateTradeSummary(trade);
    if(old) await replaceTradeDraftAtomic(trade, tradeEntryDraftRevision);
    else await dbPut('trades', trade);
    _trades = old ? load().map(t => t.id === trade.id ? trade : t) : [...load(), trade];
    if (generation !== analysisFormGeneration) { renderStats(); renderCalendar(); if (state.view === 'trades') renderTrades(); return trade; }
    hideForm(); clearForm();
    if (!activeWeekStart) activeDate = trade.date;
    refreshCurrentModal(); renderStats(); renderCalendar();
    if (state.view === 'trades') renderTrades();
    completeTradeEditorNavigation(trade.id, !old);
    return trade;
  } catch (error) {
    console.error('[TJ] Crypto save failed:', error);
    if (!_tjUnavailable) alert(error.message || '保存できませんでした。');
  } finally {
    cryptoSaving = false;
    button.disabled = false;
  }
}
function cryptoTradeSummary(t) {
  if (!isCryptoTrade(t)) return '';
  const c = t.cryptoJournal;
  if (hasResolvedTradeState(t)) return resolvedTradeSummaryHtml(t);
  return `<div class="crypto-summary"><strong>${escHtml(c.direction)} · ${escHtml(getResolvedTradeState(t).status)} · Legacy · ${escHtml(tradeOutcome(t) || '結果未確定')}</strong>
    ${c.strategy ? `<span class="trade-tag-badge">${escHtml(c.strategy === 'その他' ? c.strategyOther : c.strategy)}</span>` : ''}
    <span>Entry ${escHtml(c.entryAt.replace('T', ' '))} / ${c.entryPrice}</span>
    <span>Exit ${c.exitAt ? escHtml(c.exitAt.replace('T', ' ')) : '未決済／決済日時未登録'}</span>
    <span>SL ${c.stopLossPrice ?? '—'} / TP ${c.takeProfitPrice ?? '—'} / Size ${c.positionSize}</span></div>`;
}
function cryptoTradeDetails(t) {
  if (!isCryptoTrade(t)) return '';
  const c = t.cryptoJournal;
  const entry = Array.isArray(t.events) ? t.events.filter(e=>e.type==='Entry').slice().sort((a,b)=>tradeEventTimeKey(a.datetime).localeCompare(tradeEventTimeKey(b.datetime)))[0] : null;
  const text = (label, value) => value ? `<div><strong>${label}</strong><p>${escHtml(value)}</p></div>` : '';
  const entryInfo = hasResolvedTradeState(t) ? `<div class="crypto-summary"><strong>初期Entry · ${escHtml(c.direction)}</strong><span>Entry ${escHtml((entry?.datetime||c.entryAt).replace('T', ' '))} / ${entry?.price??c.entryPrice}</span><span>初期SL ${c.stopLossPrice ?? '—'} / 初期TP ${c.takeProfitPrice ?? '—'} / 初期数量 ${entry?.quantity??c.positionSize}</span><span>戦略 ${escHtml(c.strategy === 'その他' ? c.strategyOther : c.strategy)}</span></div>` : cryptoTradeSummary(t);
  return `<section class="crypto-trade-details"><h3>Entry情報・Entry時分析</h3>${entryInfo}
    ${hasResolvedTradeState(t) ? '' : `<p>実現損益: ${c.realizedPnl ?? '未入力'}（手入力・${cryptoRealizationDate(t) ? '決済日集計' : '決済日時または金額未登録のため集計対象外'}）</p>`}
    ${c.analysisText ? `<details class="crypto-details"><summary>ChatGPT解析テキスト（原文）</summary><pre class="analysis-original">${escHtml(c.analysisText)}</pre></details>` : ''}
    ${text('エントリー根拠', c.entryReason)}${text('振り返り（従来欄・Entry時メモ）', c.review)}
    <details class="crypto-details"><summary>Entry分析 / オーダーフロー・デリバティブ情報</summary>
      ${ENTRY_ANALYSIS_FIELDS.map(([key, label]) => text(label, c.entryAnalysis?.[key])).join('')}
      ${CRYPTO_FLOW_FIELDS.map(([key, label]) => text(label, c.orderFlow?.[key])).join('')}
    </details></section>`;
}

function readCryptoJournalDraft(old) {
  const c = { ...(old?.cryptoJournal || {}), version: 1, direction: selectedCryptoChoice('crypto-direction'),
    entryAt: document.getElementById('crypto-entry-at').value, exitAt: document.getElementById('crypto-exit-at').value,
    resultMode: cryptoResultManual ? 'manual' : 'auto', entryPrice: cryptoNumber('crypto-entry-price'),
    stopLossPrice: cryptoNumber('crypto-sl'), takeProfitPrice: cryptoNumber('crypto-tp'), positionSize: cryptoNumber('crypto-size'),
    realizedPnl: cryptoNumber('crypto-pnl'), result: selectedCryptoChoice('crypto-result'), strategy: selectedCryptoChoice('crypto-strategy'),
    strategyOther: document.getElementById('crypto-strategy-other').value.trim(),
    analysisText: document.getElementById('crypto-analysis-text').value,
    entryReason: document.getElementById('crypto-reason').value, review: document.getElementById('crypto-review').value,
    orderFlow: { ...(old?.cryptoJournal?.orderFlow || {}), ...Object.fromEntries(CRYPTO_FLOW_FIELDS.map(([key]) =>
    [key, document.getElementById('crypto-flow-' + key).value])) } };
  const entryAnalysis = Object.fromEntries(ENTRY_ANALYSIS_FIELDS.map(([key]) => [key, document.getElementById('crypto-analysis-' + key).value]));
  if (old?.cryptoJournal?.entryAnalysis !== undefined || Object.values(entryAnalysis).some(Boolean)) c.entryAnalysis = { ...old?.cryptoJournal?.entryAnalysis, ...entryAnalysis };
  validateCryptoJournal(c);
  return c;
}
