// Separate from New Entry analysis: no field guessing, writes, or network access.
function updateImportKey(value) { return value.normalize('NFKC').toLowerCase().replace(/[\s_\-/／&＆*`]/g, ''); }
function updateImportTypeKey(value) { return value.normalize('NFKC').toLowerCase().replace(/\s/g, ''); }
const UPDATE_IMPORT_TYPES = new Map();
for (const [type, names] of Object.entries({
  'Final Summary': ['Final Summary'],
  'Add Entry': ['Add Entry', 'AddEntry', '追加エントリー'],
  'Partial TP': ['Partial TP', 'PartialTP', '部分利確'],
  'Partial SL': ['Partial SL', 'PartialSL', '部分損切り'],
  'Final Exit': ['Final Exit', 'FinalExit', 'Exit', '全決済', '最終決済'],
})) for (const name of names) UPDATE_IMPORT_TYPES.set(updateImportTypeKey(name), type);
const UPDATE_IMPORT_KEYS = new Map();
for (const [key, names] of Object.entries({
  type: ['更新種別', 'Update Type'],
  datetime: ['日時', '約定日時', '決済日時', 'Entry日時', 'Exit日時'],
  price: ['価格', '約定価格', 'エントリー価格', 'Entry価格', '決済価格', 'Exit価格', 'TP価格', 'SL価格'],
  quantity: ['数量', '決済数量', 'Entry数量', 'ポジションサイズ', 'Qty', 'Size'],
  realizedPnl: ['実現損益', 'Realized P&L', 'Realized PnL', 'P&L', 'PnL'],
  reason: ['理由', 'Exit理由', 'Entry理由', '利確理由', '損切り理由'],
  memo: ['メモ', 'コメント'], review: ['振り返り'], result: ['結果'],
  exitPriceStructure: ['Exit時Price Structure'], exitFuturesCvd: ['Exit時Futures CVD'],
  exitSpotCvd: ['Exit時Spot CVD'], exitOi: ['Exit時OI'], exitFundingRate: ['Exit時Funding Rate', 'Exit時Funding'],
  exitVolume: ['Exit時Volume'], exitFuturesBidAskDelta: ['Exit時Futures Bid & Ask Delta'],
  exitFootprint: ['Exit時Footprint'], exitOrderBookHeatmap: ['Exit時Order Book / Heatmap', 'Exit時Heatmap'],
})) for (const name of names) UPDATE_IMPORT_KEYS.set(updateImportKey(name), key);

function updateImportNumber(raw) {
  const text = raw.normalize('NFKC').trim().replace(/−/g, '-');
  const match = text.match(/^(?:[$¥]\s*)?([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?:\s*([A-Za-z][A-Za-z0-9]{0,15}|枚|%))?$/i);
  if (!match) return undefined;
  const number = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(number) ? { number, unit: match[2] || '' } : undefined;
}
function updateImportDatetime(raw) {
  const match = raw.normalize('NFKC').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const [, y, m, d, h, minute, second] = match;
  const result = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${minute}${second === undefined ? '' : ':' + second}`;
  return validTradeEventDateTime(result) ? result : undefined;
}

function parseUpdateImportText(rawText) {
  const fields = {}, units = {}, errors = [], warnings = [], unknown = [], blocks = [];
  let current = null;
  for (const line of rawText.split(/\r?\n/)) {
    const clean = line.trim().replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '');
    if (/^```/.test(clean)) continue;
    const match = clean.match(/^([^:：]{1,80})[:：]\s*(.*)$/);
    if (match) {
      const label = match[1].replace(/[*`]/g, '').trim(), key = UPDATE_IMPORT_KEYS.get(updateImportKey(label));
      current = { key, label, value: match[2].replace(/^\*\*\s*/, '') };
      blocks.push(current);
    } else if (current) current.value += '\n' + line;
  }
  const typeBlocks = blocks.filter(block => block.key === 'type');
  const summaryInput = typeBlocks.length === 1 && UPDATE_IMPORT_TYPES.get(updateImportTypeKey(typeBlocks[0].value.trim())) === 'Final Summary';
  const seen = new Set();
  for (const block of blocks) {
    const { key, label } = block, value = block.value.trim();
    if (!key) { unknown.push({ label, value }); continue; }
    if (seen.has(key)) { errors.push(`${label}: 同じ項目が複数あります。1つにしてください。`); continue; }
    seen.add(key);
    let parsed = value;
    if (key === 'type') parsed = UPDATE_IMPORT_TYPES.get(updateImportTypeKey(value));
    else if (key === 'datetime') parsed = updateImportDatetime(value);
    else if (['price', 'quantity', 'realizedPnl'].includes(key)) {
      if (summaryInput && key === 'price' && value === '') parsed = null;
      else if (key === 'realizedPnl' && (value === '' || value.toLowerCase() === 'null')) parsed = null;
      else {
        const numeric = updateImportNumber(value);
        parsed = numeric && numeric.unit !== '%' ? numeric.number : undefined;
        if (numeric) units[key] = numeric.unit;
        if (key !== 'realizedPnl' && !(parsed > 0)) parsed = undefined;
      }
    } else if (key === 'result') parsed = ({ win: 'Win', loss: 'Loss', be: 'BE', '勝ち': 'Win', '負け': 'Loss', '建値': 'BE' })[updateImportKey(value)];
    if (key === 'type' && updateImportTypeKey(value) === 'newentry') errors.push('New Entryは新規取引画面へ貼り付けてください。既存取引へは適用できません。');
    if (parsed === undefined) errors.push(`${label}: 形式または値を確認してください。`);
    else fields[key] = parsed;
  }
  const required = summaryInput ? [['type', '更新種別'], ['datetime', 'datetime（日時）'], ['realizedPnl', '実現損益'], ['result', '結果']] : [['type', '更新種別'], ['datetime', 'datetime（日時）'], ['price', 'price（価格）'], ['quantity', 'quantity（数量）']];
  for (const [key, label] of required) {
    if (!Object.hasOwn(fields, key)) errors.push(`${label}が不足、または無効です。`);
  }
  if (summaryInput && !Number.isFinite(fields.realizedPnl)) errors.push('Final Summaryでは実現損益の確定値が必須です（0は有効）。');
  if (summaryInput && fields.quantity !== undefined) warnings.push('Final Summaryの数量は原文にだけ保持し、残数量や決済数量の履歴を推測しません。');
  const event = { type: fields.type, datetime: fields.datetime, price: fields.price, quantity: fields.quantity,
    realizedPnl: fields.realizedPnl ?? null, reason: fields.reason || '',
    memo: [fields.memo, fields.review].filter(value => value !== undefined && value !== '').join('\n'), rawText };
  const exitUpdate = {};
  if (['Final Exit', 'Final Summary'].includes(fields.type)) for (const key of ['review', 'reason', 'memo', 'result']) {
    if (Object.hasOwn(fields, key) && !(summaryInput && key === 'result')) exitUpdate[key] = fields[key];
  }
  const analysis = Object.fromEntries(EXIT_ANALYSIS_FIELDS.filter(([key]) => Object.hasOwn(fields, key)).map(([key]) => [key, fields[key]]));
  if (Object.keys(analysis).length) {
    if (['Final Exit', 'Final Summary'].includes(fields.type)) exitUpdate.analysis = analysis;
    else warnings.push('Exit分析は原文に保持します。分析の反映はFinal Exitのみです。');
  }
  if (event.realizedPnl === null) warnings.push('実現損益は未記録（null）で保存します。');
  if (fields.result && !['Final Exit', 'Final Summary'].includes(fields.type)) warnings.push('結果は原文に保持します。Exit情報への反映はFinal Exitのみです。');
  const summary = summaryInput ? { datetime: fields.datetime, price: fields.price ?? null, realizedPnl: fields.realizedPnl, result: fields.result, rawText } : null;
  return { event, summary, exitUpdate, fields, units, errors, warnings, unknown };
}

function updateImportRevision(trade) {
  return JSON.stringify({ id: trade.id, symbol: trade.symbol, type: trade.type, date: trade.date, side: trade.side,
    cryptoJournal: trade.cryptoJournal, legs: trade.legs, entryPrice: trade.entryPrice, quantity: trade.quantity,
    events: trade.events, exitUpdate: trade.exitUpdate, historyMode: trade.historyMode, finalSummary: trade.finalSummary,
    screenshots: trade.screenshots?.map(({ blob, dataUrl, ...metadata }) => metadata) });
}

function previewUpdateImport(trade, rawText) {
  const parsed = parseUpdateImportText(rawText), errors = [...parsed.errors];
  const before = getResolvedTradeState(trade);
  if (trade.historyMode === 'summary') errors.push('Summaryでクローズ済みです。更新の二重登録はできません。');
  if (parsed.summary) {
    try { validateTradeEvents(trade.events); } catch (error) { errors.push(error.message); }
    const storedEvents = Array.isArray(trade.events) ? trade.events : [];
    const baselineTime = storedEvents.some(e => e.type === 'Entry') ? null : getLegacyEntryBaseline(trade)?.datetime;
    const times = [baselineTime, ...storedEvents.map(e => e.datetime)].filter(Boolean);
    if (parsed.summary.datetime && times.some(time => tradeEventTimeKey(time) > tradeEventTimeKey(parsed.summary.datetime))) errors.push('決済日時は保存済みのEntry・売買イベント以降にしてください。');
    const candidate = { ...trade, historyMode: 'summary', finalSummary: parsed.summary };
    if (!errors.length) { try { validateTradeSummary(candidate); } catch (error) { errors.push(error.message); } }
    const after = errors.length ? null : getResolvedTradeState(candidate);
    const warnings = [...parsed.warnings, 'Summaryとしてクローズします。途中イベントは作らず、既存履歴を保持したまま集計はこの最終損益へ切り替わります。'];
    return { ...parsed, errors, warnings, before, after, revision: updateImportRevision(trade), tradeId: trade.id };
  }
  let after = null;
  if (!before.isValid) errors.push('現在の取引状態がInvalidです。既存履歴を確認してください。');
  if (!errors.length) {
    const e = parsed.event;
    const duplicate = (trade.events || []).some(old => old.type === e.type && tradeEventTimeKey(old.datetime) === tradeEventTimeKey(e.datetime) && old.price === e.price && old.quantity === e.quantity);
    if (duplicate) errors.push('同じtype・datetime・price・quantityのeventが登録済みです。重複追加はできません。');
    let id = '__update_import_preview__'; while (trade.events?.some(old => old.id === id)) id += '_';
    const candidate = withTradeEvent(trade, { ...e, id });
    after = getTradeState(candidate);
    if (!after.isValid) errors.push(...after.issues.map(issue => `反映後: ${issue.code}`));
    const epsilon = Math.max(before.epsilon || 0, after.epsilon || 0);
    if (e.type !== 'Add Entry' && e.quantity - before.remainingQuantity > epsilon) errors.push('数量が現在残数量を超えています。補正せず保存を停止します。');
    if (e.type === 'Final Exit' && Math.abs(e.quantity - before.remainingQuantity) > epsilon) errors.push('Final Exit数量が現在残数量と一致しません。補正せず保存を停止します。');
    const expectedRemaining = before.remainingQuantity + (e.type === 'Add Entry' ? e.quantity : -e.quantity);
    if (Math.abs(after.remainingQuantity - expectedRemaining) > epsilon) errors.push('従来の決済情報とevents基準が一致しません。履歴を確認してください。');
  }
  return { ...parsed, errors: [...new Set(errors)], before, after, revision: updateImportRevision(trade), tradeId: trade.id };
}

async function commitUpdateImport({ tradeId, rawText, expectedRevision, images = [] }) {
  if (typeof rawText !== 'string' || !rawText.trim() || typeof expectedRevision !== 'string') throw new Error('解析プレビューを確認してから保存してください。');
  const parsed = parseUpdateImportText(rawText);
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  if (parsed.summary) return commitFinalSummary({ tradeId, rawText, expectedRevision, images });
  return appendTradeEvent(tradeId, parsed.event, {
    images,
    exitUpdate: Object.keys(parsed.exitUpdate).length ? parsed.exitUpdate : undefined,
    beforeAppend: current => {
      const preview = previewUpdateImport(current, rawText);
      if (preview.errors.length) throw new Error(preview.errors.join('\n'));
      if (updateImportRevision(current) !== expectedRevision) throw new Error('プレビュー後に対象取引が変更されました。再解析して確認してください。');
    },
  });
}

async function commitFinalSummary({ tradeId, rawText, expectedRevision, images }) {
  const additions = screenshotsAsBlobs(images);
  validateScreenshots(additions);
  const db = await _openTjDb();
  const saved = await new Promise((resolve, reject) => {
    const tx = db.transaction('trades', 'readwrite');
    let updated;
    _tjWriteComplete(tx, () => resolve(updated), reject);
    const store = tx.objectStore('trades'), request = store.get(tradeId);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('対象取引が見つかりません。');
        const preview = previewUpdateImport(request.result, rawText);
        if (preview.errors.length) throw new Error(preview.errors.join('\n'));
        if (preview.revision !== expectedRevision) throw new Error('対象取引が変更されました。再解析してください。');
        updated = { ...request.result, historyMode: 'summary', finalSummary: preview.summary };
        if (Object.keys(preview.exitUpdate).length) {
          updated.exitUpdate = { review: '', reason: '', memo: '', ...updated.exitUpdate, ...preview.exitUpdate };
          if (preview.exitUpdate.analysis) updated.exitUpdate.analysis = { ...request.result.exitUpdate?.analysis, ...preview.exitUpdate.analysis };
          validateExitUpdate(updated.exitUpdate);
        }
        if (additions.length) updated.screenshots = [...(updated.screenshots || []), ...additions];
        validateScreenshots(updated.screenshots);
        validateTradeSummary(updated);
      } catch (error) { reject(error); return; }
      try { store.put(updated); } catch (error) { tx.abort(); reject(error); }
    };
  });
  _trades = load().map(trade => trade.id === saved.id ? saved : trade);
  return structuredClone(saved);
}
