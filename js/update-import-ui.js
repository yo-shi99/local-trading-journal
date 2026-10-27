let updateImportSaving = false;
let updateImportImagesBusy = false;
let updateImportTargetId = null;
let updateImportGeneration = 0;
let updateImportPending = null;
let updateImportImages = [];
let updateImportCategoryTouched = false;

function renderUpdateImportTarget(trade) {
  const c = trade.cryptoJournal, baseline = getLegacyEntryBaseline(trade), s = getTradeState(trade);
  const direction = c?.direction || trade.side || trade.legs?.[0]?.action || '—';
  document.getElementById('update-import-target').textContent = `対象取引: ${trade.symbol} / ${direction}\nEntry ${c?.entryAt || baseline?.datetime || trade.date}\nEntry価格 ${c?.entryPrice ?? baseline?.price ?? '—'}\n現在残数量 ${s.remainingQuantity ?? '—'} ${trade.symbol} / ${s.status}`;
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
  document.getElementById('update-import').hidden = !trade;
  document.getElementById('update-import-text').value = '';
  document.getElementById('update-import-input').value = '';
  document.getElementById('update-import-images').innerHTML = '';
  document.getElementById('update-import-category').value = 'Update';
  invalidateUpdateImport();
  if (trade) renderUpdateImportTarget(trade);
}
function renderUpdateImportImages() {
  const category = document.getElementById('update-import-category').value;
  document.getElementById('update-import-images').innerHTML = updateImportImages.map(image =>
    `<figure class="screenshot-tile"><img class="exit-draft-image" src="${screenshotSource(image)}" alt="${escHtml(image.name)}">
      <figcaption>${escHtml(category)} · ${escHtml(image.name)}</figcaption><button type="button" class="screenshot-remove" data-update-import-remove="${escHtml(image.id)}">追加を取り消す</button></figure>`).join('');
}
async function analyseUpdateImport() {
  if (!updateImportTargetId || editingId !== updateImportTargetId || updateImportSaving || updateImportImagesBusy) return;
  const generation = updateImportGeneration, id = updateImportTargetId;
  const text = document.getElementById('update-import-text').value;
  invalidateUpdateImport('解析しています…');
  try {
    const trade = await dbGet('trades', id);
    if (generation !== updateImportGeneration || text !== document.getElementById('update-import-text').value) return;
    if (!trade) throw new Error('対象取引が見つかりません。');
    const preview = previewUpdateImport(trade, text);
    renderUpdateImportTarget(trade);
    if (!updateImportCategoryTouched && preview.event.type) {
      document.getElementById('update-import-category').value = preview.event.type === 'Final Exit' ? 'Exit' : 'Update';
      renderUpdateImportImages();
    }
    const e = preview.event, fmt = value => value === null || value === undefined ? '未取得' : String(value);
    const lines = [`更新種別: ${fmt(e.type)}`, `日時: ${fmt(e.datetime)}`, `価格: ${fmt(e.price)} ${preview.units.price || ''}`,
      `数量: ${fmt(e.quantity)} ${preview.units.quantity || ''}`, `実現損益: ${fmt(e.realizedPnl)} ${preview.units.realizedPnl || ''}`,
      `理由: ${e.reason}`, `メモ: ${e.memo}`];
    if (Object.keys(preview.exitUpdate).length) {
      const labels = { review: 'Exitレビュー', reason: 'Exit理由', memo: 'Exit時メモ', result: '結果' };
      lines.push('Exit情報への反映:', ...Object.entries(preview.exitUpdate).map(([key, value]) => key === 'analysis' ? EXIT_ANALYSIS_FIELDS.filter(([k]) => Object.hasOwn(value, k)).map(([k, label]) => `${label}: ${value[k]}`).join('\n') : `${labels[key]}: ${value}`));
    }
    if (preview.after) lines.push('\n反映後:', `残数量 ${fmt(preview.before.remainingQuantity)} → ${fmt(preview.after.remainingQuantity)}`,
      `累計実現損益 ${fmt(preview.before.realizedPnl)} → ${fmt(preview.after.realizedPnl)}`, `平均建値 ${fmt(preview.after.averageEntryPrice)}`,
      `総Entry数量 ${fmt(preview.after.totalEntryQuantity)}`, `状態 ${preview.after.status}`);
    lines.push(`追加画像: ${updateImportImages.length}枚 / ${document.getElementById('update-import-category').value}`);
    if (preview.unknown.length) lines.push('\n未認識項目（原文に保持）:', ...preview.unknown.map(item => `${item.label}: ${item.value}`));
    if (preview.warnings.length) lines.push('\n注意:', ...preview.warnings);
    document.getElementById('update-import-preview').textContent = lines.join('\n');
    if (preview.errors.length) document.getElementById('update-import-status').textContent = preview.errors.join('\n');
    else {
      updateImportPending = { ...preview, text };
      document.getElementById('update-import-confirm').disabled = false;
      document.getElementById('update-import-status').textContent = '対象と内容を確認して「この更新を追加」で確定してください。まだ保存していません。';
    }
  } catch (error) { if (generation === updateImportGeneration) invalidateUpdateImport(error.message); }
}
async function confirmUpdateImport() {
  if (!updateImportPending || updateImportSaving || updateImportImagesBusy || exitScreenshotsBusy || screenshotsBusy || exitUpdateSaving || cryptoSaving || legacyTradeSaving) return;
  const pending = updateImportPending, generation = updateImportGeneration;
  if (pending.tradeId !== editingId || pending.tradeId !== updateImportTargetId || pending.text !== document.getElementById('update-import-text').value) return invalidateUpdateImport('対象が変わりました。再解析してください。');
  updateImportSaving = true;
  document.getElementById('update-import-confirm').disabled = true;
  try {
    const category = document.getElementById('update-import-category').value;
    await commitUpdateImport({ tradeId: pending.tradeId, rawText: pending.text, expectedRevision: pending.revision,
      images: updateImportImages.map(image => ({ ...image, category })) });
    if (generation === updateImportGeneration && editingId === pending.tradeId) {
      hideForm(); clearForm(); refreshCurrentModal(); renderStats(); renderCalendar();
      if (state.view === 'trades') renderTrades();
    }
  } catch (error) {
    if (generation === updateImportGeneration) invalidateUpdateImport(error.message || '保存できませんでした。原文は保持しています。');
  } finally { updateImportSaving = false; }
}
function cancelUpdateImport() {
  if (updateImportSaving) return;
  updateImportGeneration++;
  updateImportImagesBusy = false;
  updateImportImages = [];
  renderUpdateImportImages();
  invalidateUpdateImport('キャンセルしました。原文は入力欄に残しています。DBは変更していません。');
}
async function addUpdateImportImages(files) {
  if (!files.length || updateImportSaving || updateImportImagesBusy || !updateImportTargetId) return;
  const generation = updateImportGeneration;
  updateImportImagesBusy = true;
  invalidateUpdateImport('更新画像を端末内で圧縮しています…');
  try {
    const images = [];
    for (const file of files) {
      if (generation !== updateImportGeneration) return;
      images.push(await compressScreenshot(file));
    }
    if (generation !== updateImportGeneration) return;
    validateScreenshots(images);
    updateImportImages = [...updateImportImages, ...images];
    renderUpdateImportImages();
    invalidateUpdateImport('画像を準備しました。「解析して確認」を押してください。');
  } catch (error) { if (generation === updateImportGeneration) invalidateUpdateImport('画像を追加できませんでした。既存画像は変更していません。'); }
  finally { if (generation === updateImportGeneration) updateImportImagesBusy = false; }
}
document.getElementById('update-import-text').addEventListener('input', () => invalidateUpdateImport('変更した原文を再解析してください。'));
document.getElementById('update-import-category').addEventListener('change', () => {
  updateImportCategoryTouched = true; renderUpdateImportImages(); invalidateUpdateImport('画像分類を変更しました。再解析してください。');
});
document.getElementById('update-import-input').addEventListener('change', event => {
  const files = [...event.target.files]; event.target.value = ''; addUpdateImportImages(files);
});
document.getElementById('update-import-images').addEventListener('click', event => {
  const button = event.target.closest('[data-update-import-remove]');
  if (button && !updateImportImagesBusy && !updateImportSaving) {
    updateImportImages = updateImportImages.filter(image => image.id !== button.dataset.updateImportRemove);
    renderUpdateImportImages(); invalidateUpdateImport('画像を変更しました。再解析してください。');
  }
});
