let exitUpdateSaving = false;
let exitScreenshotsBusy = false;
let exitScreenshotDraft = [];
let exitUpdateGeneration = 0;

function validateExitUpdate(update) {
  if (update === undefined) return;
  if (!update || typeof update !== 'object' || Array.isArray(update) ||
      !['review', 'reason', 'memo'].every(key => typeof update[key] === 'string') ||
      (update.result !== undefined && !['Win', 'Loss', 'BE'].includes(update.result))) {
    throw new Error('Exit / Updateのレビュー・理由・メモの形式を確認してください。');
  }
}

// Patch only Exit/Update fields, reading the latest persisted Entry and history.
async function saveTradeExitUpdate(tradeId, fields, images = []) {
  if (typeof tradeId !== 'string' || !tradeId) throw new Error('トレードIDを指定してください。');
  validateExitUpdate(fields);
  if (!fields) throw new Error('Exit / Update情報を指定してください。');
  validateScreenshots(images);
  if (images.some(image => !['Update', 'Exit'].includes(image.category))) throw new Error('更新画像の分類はUpdateまたはExitにしてください。');
  const patch = { review: fields.review, reason: fields.reason, memo: fields.memo };
  const additions = screenshotsAsBlobs(images);
  const db = await _openTjDb();
  const updated = await new Promise((resolve, reject) => {
    const tx = db.transaction('trades', 'readwrite');
    let result;
    _tjWriteComplete(tx, () => resolve(result), reject);
    const store = tx.objectStore('trades'), request = store.get(tradeId);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('トレードが見つかりません。');
        result = { ...request.result, exitUpdate: { ...request.result.exitUpdate, ...patch } };
        if (additions.length) result.screenshots = [...(request.result.screenshots || []), ...additions];
        validateScreenshots(result.screenshots);
      } catch (error) { reject(error); return; }
      try { store.put(result); } catch (error) { tx.abort(); reject(error); }
    };
  });
  _trades = load().map(trade => trade.id === updated.id ? updated : trade);
  return structuredClone(updated);
}

function resetExitUpdateDraft(trade) {
  exitUpdateGeneration++;
  exitScreenshotDraft = [];
  exitScreenshotsBusy = false;
  for (const key of ['review', 'reason', 'memo']) document.getElementById('exit-update-' + key).value = trade?.exitUpdate?.[key] ?? '';
  document.getElementById('exit-update-input').value = '';
  document.getElementById('exit-update-status').textContent = '';
  document.getElementById('exit-update-draft').innerHTML = '';
  document.getElementById('save-exit-update').disabled = !trade;
}

function exitUpdateFieldsFromForm() {
  return Object.fromEntries(['review', 'reason', 'memo'].map(key => [key, document.getElementById('exit-update-' + key).value]));
}

// Normal Entry save may explicitly include this independent draft as well.
function applyExitUpdateDraft(trade) {
  const fields = exitUpdateFieldsFromForm();
  const updated = { ...trade };
  if (trade.exitUpdate !== undefined || Object.values(fields).some(value => value !== '') || exitScreenshotDraft.length) {
    updated.exitUpdate = { ...trade.exitUpdate, ...fields };
    validateExitUpdate(updated.exitUpdate);
  }
  if (exitScreenshotDraft.length) updated.screenshots = [...(trade.screenshots || []), ...exitScreenshotDraft];
  return updated;
}

async function saveExitUpdateFromForm() {
  if (updateImportSaving || updateImportImagesBusy) return;
  if (!editingId || exitUpdateSaving || exitScreenshotsBusy || screenshotsBusy || cryptoSaving || legacyTradeSaving) return;
  const id = editingId;
  exitUpdateSaving = true;
  document.getElementById('save-exit-update').disabled = true;
  try {
    await saveTradeExitUpdate(id, exitUpdateFieldsFromForm(), exitScreenshotDraft);
    hideForm(); clearForm(); refreshCurrentModal(); renderStats(); renderCalendar();
    if (state.view === 'trades') renderTrades();
  } catch (error) {
    console.error('[TJ] Exit update failed:', error);
    if (!_tjUnavailable) alert(error.message || 'Exit / Updateを保存できませんでした。');
  } finally {
    exitUpdateSaving = false;
    document.getElementById('save-exit-update').disabled = !editingId;
  }
}

function renderExitScreenshotDraft() {
  document.getElementById('exit-update-draft').innerHTML = exitScreenshotDraft.map(image =>
    `<figure class="screenshot-tile"><img class="exit-draft-image" src="${screenshotSource(image)}" alt="${escHtml(image.name)}">
      <figcaption>${escHtml(image.category)} · ${escHtml(image.name)}</figcaption>
      <button type="button" class="screenshot-remove" data-exit-shot-remove="${escHtml(image.id)}">追加を取り消す</button></figure>`).join('');
}

async function addExitScreenshotFiles(files) {
  if (!files.length || exitScreenshotsBusy || screenshotsBusy || exitUpdateSaving) return;
  const generation = exitUpdateGeneration;
  const category = document.getElementById('exit-update-category').value;
  exitScreenshotsBusy = true;
  const status = document.getElementById('exit-update-status');
  status.textContent = '更新画像を端末内で圧縮しています…';
  try {
    const images = [];
    for (const file of files) {
      if (generation !== exitUpdateGeneration) return;
      images.push({ ...await compressScreenshot(file), category });
    }
    if (generation !== exitUpdateGeneration) return;
    validateScreenshots(images);
    exitScreenshotDraft = [...exitScreenshotDraft, ...images];
    renderExitScreenshotDraft();
    status.textContent = '更新画像の圧縮が完了しました。保存するまで既存画像は変更しません。';
  } catch (error) {
    if (generation === exitUpdateGeneration) status.textContent = '画像を追加できませんでした。既存画像は変更していません。';
  } finally { if (generation === exitUpdateGeneration) exitScreenshotsBusy = false; }
}

document.getElementById('exit-update-input').addEventListener('change', event => {
  const files = [...event.target.files]; event.target.value = ''; addExitScreenshotFiles(files);
});
document.getElementById('exit-update-draft').addEventListener('click', event => {
  const button = event.target.closest('[data-exit-shot-remove]');
  if (button && !exitScreenshotsBusy && !exitUpdateSaving) {
    exitScreenshotDraft = exitScreenshotDraft.filter(image => image.id !== button.dataset.exitShotRemove);
    renderExitScreenshotDraft();
  }
});
