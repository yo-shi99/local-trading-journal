let updateImportSaving = false;
let updateImportImagesBusy = false;
let updateImportTargetId = null;
let updateImportGeneration = 0;
let updateImportPending = null;
let updateImportImages = [];
let updateImportCategoryTouched = false;
let updateImportEntryAppliedText = null;

function renderUpdateImportTarget(trade) {
  if (!trade) { document.getElementById('update-import-target').textContent = '新規Trade · New Entry（更新種別なしの旧Entry形式も利用可）'; return; }
  const c = trade.cryptoJournal, baseline = getLegacyEntryBaseline(trade), s = getResolvedTradeState(trade);
  document.getElementById('update-import-target').textContent = `対象取引: ${trade.symbol} / ${c?.direction || trade.side || '—'}\nEntry ${c?.entryAt || baseline?.datetime || trade.date}\nEntry価格 ${c?.entryPrice ?? baseline?.price ?? '—'}\n現在残数量 ${s.remainingQuantity ?? '—'} ${trade.symbol} / ${s.status}`;
}
function invalidateUpdateImport(message = '') {
  updateImportPending = null;
  document.getElementById('update-import-confirm').disabled = true;
  document.getElementById('update-import-preview').textContent = '';
  document.getElementById('update-import-status').textContent = message;
}
function resetUpdateImport(trade) {
  updateImportGeneration++;
  updateImportTargetId = trade?.id || null;
  updateImportImagesBusy = false;
  updateImportImages = [];
  updateImportCategoryTouched = false;
  updateImportEntryAppliedText = null;
  document.getElementById('update-import').hidden = false;
  document.getElementById('update-import-text').value = '';
  document.getElementById('update-import-input').value = '';
  document.getElementById('update-import-images').innerHTML = '';
  document.getElementById('update-import-category').value = trade ? 'Update' : 'Entry';
  invalidateUpdateImport();
  renderUpdateImportTarget(trade);
}
function renderUpdateImportImages() {
  const category = document.getElementById('update-import-category').value;
  document.getElementById('update-import-images').innerHTML = updateImportImages.map(image =>
    `<figure class="screenshot-tile"><img class="exit-draft-image" src="${screenshotSource(image)}" alt="${escHtml(image.name)}">
      <figcaption>${escHtml(category)} · ${escHtml(image.name)}</figcaption><button type="button" class="screenshot-remove" data-update-import-remove="${escHtml(image.id)}">追加を取り消す</button></figure>`).join('');
}
function newEntryImportProof() {
  return JSON.stringify({ cryptoJournal: readCryptoJournalDraft(null), symbol: selectedCryptoChoice('crypto-asset'), otherSymbol: document.getElementById('crypto-symbol-other').value,
    screenshots: screenshotDraft.map(({ blob, dataUrl, ...metadata }) => metadata), tags: getCheckedTagIds(), mistakes: getCheckedMistakeIds(), rules: getCheckedRuleIds() });
}
function previewNewEntryImport(text) {
  const parsed = parseAnalysisText(text);
  if (parsed.classification.kind !== 'entry') throw new Error('新規TradeではNew Entryだけを受け付けます。更新は対象の既存Tradeを開いて貼り付けてください。');
  if (updateImportEntryAppliedText !== text) {
    cryptoFormActive = true;
    document.getElementById('crypto-fields').hidden = false;
    document.getElementById('legacy-trade-fields').hidden = true;
    document.getElementById('legacy-notes').hidden = true;
    document.getElementById('crypto-analysis-text').value = text;
    applyAnalysisText({ confirmOverwrite: false });
    updateImportEntryAppliedText = text;
  }
  const c = readCryptoJournalDraft(null);
  return { kind: 'new', text, proof: newEntryImportProof(), c, parsed };
}
function renderImportPreview(preview) {
  const fmt = value => value === null || value === undefined ? '未取得' : String(value);
  const lines = [];
  if (preview.kind === 'new') {
    const c = preview.c;
    lines.push('更新種別: New Entry', `銘柄: ${selectedCryptoChoice('crypto-asset') === 'その他' ? document.getElementById('crypto-symbol-other').value : selectedCryptoChoice('crypto-asset')}`,
      `方向: ${c.direction}`, `Entry日時: ${c.entryAt}`, `Entry価格: ${c.entryPrice}`, `数量: ${c.positionSize}`, `SL: ${fmt(c.stopLossPrice)}`, `TP: ${fmt(c.takeProfitPrice)}`,
      `戦略: ${c.strategy === 'その他' ? c.strategyOther : c.strategy}`, `Entry理由: ${c.entryReason}`, `Entry時メモ: ${c.review}`,
      ...ENTRY_ANALYSIS_FIELDS.map(([key,label]) => `${label}: ${c.entryAnalysis?.[key] || ''}`), ...CRYPTO_FLOW_FIELDS.map(([key,label]) => `${label}: ${c.orderFlow[key]}`));
    if (preview.parsed.unknown.length) lines.push('未認識項目（原文に保持）: '+preview.parsed.unknown.join('、'));
    if (preview.parsed.warnings.length) lines.push('注意: '+preview.parsed.warnings.join('、'));
  } else {
    const e = preview.summary ? { type: 'Final Summary', ...preview.summary } : preview.event;
    lines.push(`更新種別: ${fmt(e.type)}`, `日時: ${fmt(e.datetime)}`, `価格: ${fmt(e.price)} ${preview.units.price || ''}`,
      `数量: ${preview.summary ? '履歴未記録・推測しません' : fmt(e.quantity)}`, `実現損益: ${fmt(e.realizedPnl)}`, `結果: ${preview.summary?.result || preview.exitUpdate.result || '—'}`);
    if (!preview.summary) lines.push(`理由: ${e.reason}`, `メモ: ${e.memo}`);
    const labels = { review: 'Exitレビュー', reason: 'Exit理由', memo: 'Exit時メモ', result: '結果' };
    for (const [key,value] of Object.entries(preview.exitUpdate)) {
      if (key === 'analysis') lines.push(...EXIT_ANALYSIS_FIELDS.filter(([k]) => Object.hasOwn(value,k)).map(([k,label]) => `${label}: ${value[k]}`));
      else lines.push(`${labels[key]}: ${value}`);
    }
    if (preview.after) lines.push('\n反映後:', `残数量 ${fmt(preview.before.remainingQuantity)} → ${fmt(preview.after.remainingQuantity)}`,
      `累計実現損益 ${fmt(preview.before.realizedPnl)} → ${fmt(preview.after.realizedPnl)}`, `平均建値 ${fmt(preview.after.averageEntryPrice)}`, `総Entry数量 ${fmt(preview.after.totalEntryQuantity)}`, `状態 ${preview.after.status}`);
    if (preview.unknown.length) lines.push('\n未認識項目（原文に保持）:', ...preview.unknown.map(item => `${item.label}: ${item.value}`));
    if (preview.warnings.length) lines.push('\n注意:', ...preview.warnings);
  }
  lines.push(`追加画像: ${updateImportImages.length}枚 / ${document.getElementById('update-import-category').value}`);
  document.getElementById('update-import-preview').textContent = lines.join('\n');
}
async function analyseUpdateImport() {
  if (editingId !== updateImportTargetId || updateImportSaving || updateImportImagesBusy) return;
  const generation = updateImportGeneration, id = updateImportTargetId, text = document.getElementById('update-import-text').value;
  invalidateUpdateImport('解析しています…');
  try {
    if (!text.trim()) throw new Error('ChatGPT取引テキストを貼り付けてください。');
    let preview;
    if (!id) preview = previewNewEntryImport(text);
    else {
      const trade = await dbGet('trades', id);
      if (generation !== updateImportGeneration || text !== document.getElementById('update-import-text').value) return;
      if (!trade) throw new Error('対象取引が見つかりません。');
      preview = { ...previewUpdateImport(trade, text), kind: 'update', text };
      renderUpdateImportTarget(trade);
    }
    if (!updateImportCategoryTouched) document.getElementById('update-import-category').value = preview.kind === 'new' ? 'Entry' : preview.summary || preview.event.type === 'Final Exit' ? 'Exit' : 'Update';
    renderUpdateImportImages();
    renderImportPreview(preview);
    if (preview.errors?.length) document.getElementById('update-import-status').textContent = preview.errors.join('\n');
    else {
      updateImportPending = preview;
      document.getElementById('update-import-confirm').disabled = false;
      document.getElementById('update-import-status').textContent = '対象・内容を確認して「保存」で確定してください。まだ保存していません。';
    }
  } catch (error) { if (generation === updateImportGeneration) invalidateUpdateImport(error.message); }
}
async function confirmUpdateImport() {
  if (!updateImportPending || updateImportSaving || updateImportImagesBusy || exitScreenshotsBusy || screenshotsBusy || exitUpdateSaving || cryptoSaving || legacyTradeSaving) return;
  const pending = updateImportPending, generation = updateImportGeneration;
  if ((pending.kind === 'new' ? editingId !== null : pending.tradeId !== editingId || pending.tradeId !== updateImportTargetId) || pending.text !== document.getElementById('update-import-text').value) return invalidateUpdateImport('対象が変わりました。再解析してください。');
  updateImportSaving = true;
  document.getElementById('update-import-confirm').disabled = true;
  try {
    const category = document.getElementById('update-import-category').value;
    const images = updateImportImages.map(image => ({ ...image, category }));
    if (pending.kind === 'new') {
      if (pending.proof !== newEntryImportProof()) throw new Error('手動編集の内容が変わりました。再解析してプレビューを確認してください。');
      const saved = await saveCryptoJournalTrade({ unified: true, importImages: images });
      if (!saved && generation === updateImportGeneration) invalidateUpdateImport('保存できませんでした。入力は保持しています。内容を確認して再解析してください。');
    } else {
      await commitUpdateImport({ tradeId: pending.tradeId, rawText: pending.text, expectedRevision: pending.revision, images });
      if (generation === updateImportGeneration && editingId === pending.tradeId) {
        hideForm(); clearForm(); refreshCurrentModal(); renderStats(); renderCalendar();
        if (state.view === 'trades') renderTrades();
        completeTradeEditorNavigation();
      }
    }
  } catch (error) { if (generation === updateImportGeneration) invalidateUpdateImport(error.message || '保存できませんでした。原文は保持しています。'); }
  finally { updateImportSaving = false; }
}
function cancelUpdateImport() { cancelForm(); }

async function addUpdateImportImages(files) {
  if (!files.length || updateImportSaving || updateImportImagesBusy) return;
  const generation = updateImportGeneration;
  updateImportImagesBusy = true; invalidateUpdateImport('画像を端末内で圧縮しています…');
  try {
    const images = [];
    for (const file of files) { if (generation !== updateImportGeneration) return; images.push(await compressScreenshot(file)); }
    if (generation !== updateImportGeneration) return;
    validateScreenshots(images); updateImportImages = [...updateImportImages, ...images]; renderUpdateImportImages();
    invalidateUpdateImport('画像を準備しました。「解析して確認」を押してください。');
  } catch (error) { if (generation === updateImportGeneration) invalidateUpdateImport('画像を追加できませんでした。既存画像は変更していません。'); }
  finally { if (generation === updateImportGeneration) updateImportImagesBusy = false; }
}
document.getElementById('update-import-text').addEventListener('input', () => invalidateUpdateImport('変更した原文を再解析してください。'));
document.getElementById('update-import-category').addEventListener('change', () => { updateImportCategoryTouched = true; renderUpdateImportImages(); invalidateUpdateImport('画像分類を変更しました。再解析してください。'); });
document.getElementById('update-import-input').addEventListener('change', event => { const files = [...event.target.files]; event.target.value = ''; addUpdateImportImages(files); });
document.getElementById('update-import-images').addEventListener('click', event => {
  const button = event.target.closest('[data-update-import-remove]');
  if (button && !updateImportImagesBusy && !updateImportSaving) { updateImportImages = updateImportImages.filter(image => image.id !== button.dataset.updateImportRemove); renderUpdateImportImages(); invalidateUpdateImport('画像を変更しました。再解析してください。'); }
});
