/* Persist compressed Blobs atomically with the trade. Base64 is a legacy/JSON transport format only. */
let screenshotDraft = [];
let screenshotsBusy = false;
let screenshotGeneration = 0;
const SCREENSHOT_CATEGORIES = ['Entry', 'Update', 'Exit', 'Other'];
function screenshotBytes(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}
function validateScreenshots(images) {
  if (images === undefined) return;
  if (!Array.isArray(images)) throw new Error('添付画像の形式が正しくありません。');
  const ids = new Set();
  for (const image of images) {
    if (!image || typeof image.id !== 'string' || !image.id || ids.has(image.id) ||
        typeof image.name !== 'string' || !['image/webp', 'image/jpeg'].includes(image.type) ||
        !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
        Math.max(image.width, image.height) > 1600 || !Number.isSafeInteger(image.size) || image.size < 1 ||
        (!(image.blob instanceof Blob) && typeof image.dataUrl !== 'string')) throw new Error('添付画像の情報が正しくありません。');
    if (image.category !== undefined && !SCREENSHOT_CATEGORIES.includes(image.category)) throw new Error('添付画像の分類が正しくありません。');
    if (image.blob instanceof Blob) {
      if (image.blob.type !== image.type || image.blob.size !== image.size || image.dataUrl !== undefined) throw new Error('添付Blobの形式・容量が正しくありません。');
      ids.add(image.id);
      continue;
    }
    const prefix = `data:${image.type};base64,`;
    const base64 = image.dataUrl.slice(prefix.length);
    const size = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (!image.dataUrl.startsWith(prefix) || base64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || size !== image.size) throw new Error('添付画像の容量または内容が正しくありません。');
    ids.add(image.id);
  }
}
// Decode legacy compressed data only. This never reads or persists a source photo.
function screenshotBlob(image) {
  if (image.blob instanceof Blob) return image.blob;
  validateScreenshots([image]);
  const binary = atob(image.dataUrl.split(',')[1]);
  const parts = [];
  for (let offset = 0; offset < binary.length; offset += 65536) {
    const chunk = binary.slice(offset, offset + 65536);
    parts.push(Uint8Array.from(chunk, char => char.charCodeAt(0)));
  }
  return new Blob(parts, { type: image.type });
}
function screenshotsAsBlobs(images) {
  if (images === undefined) return undefined;
  validateScreenshots(images);
  return images.map(image => {
    const { dataUrl, ...metadata } = image;
    return { ...metadata, blob: screenshotBlob(image) };
  });
}
// Keep the established v10 JSON wire format; never JSON.stringify a Blob as {}.
async function screenshotsForBackup(stores) {
  const trades = [];
  for (const trade of stores.trades || []) {
    if (trade.screenshots === undefined) { trades.push(trade); continue; }
    validateScreenshots(trade.screenshots);
    const screenshots = [];
    for (const image of trade.screenshots) {
      const { blob, ...metadata } = image;
      screenshots.push({ ...metadata, dataUrl: blob instanceof Blob ? await readScreenshotBlob(blob) : image.dataUrl });
    }
    trades.push({ ...trade, screenshots });
  }
  return { ...stores, trades };
}
function screenshotStoresAsBlobs(stores) {
  return { ...stores, trades: (stores.trades || []).map(trade => trade.screenshots === undefined ? trade :
    { ...trade, screenshots: screenshotsAsBlobs(trade.screenshots) }) };
}

const screenshotUrls = new Set();
let screenshotCleanupPending = false;
function cleanupScreenshotUrls() {
  screenshotCleanupPending = false;
  const needed = new Set(Array.from(document.querySelectorAll('img[src^="blob:"]'))
    .filter(image => image.getClientRects().length).map(image => image.src));
  for (const url of screenshotUrls) {
    if (!needed.has(url)) { URL.revokeObjectURL(url); screenshotUrls.delete(url); }
  }
}
function scheduleScreenshotCleanup() {
  if (screenshotCleanupPending) return;
  screenshotCleanupPending = true;
  queueMicrotask(cleanupScreenshotUrls);
}
function screenshotSource(image) {
  const url = URL.createObjectURL(screenshotBlob(image));
  screenshotUrls.add(url);
  scheduleScreenshotCleanup();
  return url;
}
function resetScreenshotDraft(trade) {
  screenshotGeneration++;
  screenshotDraft = [...(trade?.screenshots || [])];
  screenshotsBusy = false;
  const input = document.getElementById('screenshot-input');
  if (input) { input.value = ''; input.disabled = false; }
  const status = document.getElementById('screenshot-status');
  if (status) status.textContent = '';
  const save = document.querySelector('#trade-form button[onclick="saveTrade()"]');
  if (save && !cryptoSaving) save.disabled = false;
  renderScreenshotDraft();
}
function screenshotTiles(images, tradeId) {
  return images.map(image => `<figure class="screenshot-tile">
    <button type="button" class="screenshot-open" data-shot-id="${escHtml(image.id)}" ${tradeId ? `data-shot-trade="${escHtml(tradeId)}"` : ''} aria-label="${escHtml(image.name)}を拡大">
      <img src="${screenshotSource(image)}" alt="${escHtml(image.name)}" loading="lazy"></button>
    <figcaption>${escHtml(image.name)}${image.category ? ' · ' + escHtml(image.category) : ''}<br>${screenshotBytes(image.size)}</figcaption>
    ${tradeId ? '' : `<button type="button" class="screenshot-remove" data-shot-remove="${escHtml(image.id)}">この画像を削除</button>`}
  </figure>`).join('');
}
function renderScreenshotDraft() {
  const list = document.getElementById('screenshot-draft');
  if (!list) return;
  list.innerHTML = screenshotTiles(screenshotDraft);
  const total = screenshotDraft.reduce((sum, image) => sum + image.size, 0);
  document.getElementById('screenshot-total').textContent = `${screenshotDraft.length}枚・画像本体合計 ${screenshotBytes(total)}`;
}
function screenshotsHtml(trade) {
  const images = trade.screenshots || [];
  if (!images.length) return '';
  const total = images.reduce((sum, image) => sum + image.size, 0);
  const groups = [ ['Entry / 未分類', images.filter(image => image.category === undefined || image.category === 'Entry')],
    ['Update', images.filter(image => image.category === 'Update')], ['Exit', images.filter(image => image.category === 'Exit')],
    ['Other', images.filter(image => image.category === 'Other')] ];
  return `<section class="trade-screenshots" aria-label="添付画像"><strong>スクリーンショット ${images.length}枚・合計 ${screenshotBytes(total)}</strong>
    ${groups.filter(([, items]) => items.length).map(([label, items]) => `<h4>${label}</h4><div class="screenshot-grid">${screenshotTiles(items, trade.id)}</div>`).join('')}
    <p class="crypto-hint">タップで拡大。画像の追加・削除はトレードの編集画面で行えます。</p></section>`;
}
function readScreenshotBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('圧縮画像を読み込めませんでした。'));
    reader.readAsDataURL(blob);
  });
}
async function compressScreenshot(file) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください。');
  let bitmap, objectUrl, canvas;
  try {
    try { bitmap = await createImageBitmap(file); }
    catch {
      objectUrl = URL.createObjectURL(file);
      bitmap = new Image(); bitmap.src = objectUrl;
      await bitmap.decode();
    }
    const width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
    if (!width || !height) throw new Error('画像のサイズを取得できませんでした。');
    const scale = Math.min(1, 1600 / Math.max(width, height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像の圧縮に対応していません。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = type => new Promise((resolve, reject) => {
      try { canvas.toBlob(resolve, type, 0.8); } catch (error) { reject(error); }
    });
    let blob;
    try { blob = await encode('image/webp'); } catch { /* Try verified JPEG fallback. */ }
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
    if (!blob || !['image/webp', 'image/jpeg'].includes(blob.type) || !blob.size) throw new Error('画像を圧縮できませんでした。');
    return { id: uid(), name: file.name, type: blob.type, width: canvas.width, height: canvas.height,
      size: blob.size, blob };
  } finally {
    if (bitmap?.close) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}
async function addScreenshotFiles(files) {
  if (!files.length || screenshotsBusy) return;
  const generation = screenshotGeneration;
  screenshotsBusy = true;
  const input = document.getElementById('screenshot-input');
  const save = document.querySelector('#trade-form button[onclick="saveTrade()"]');
  const status = document.getElementById('screenshot-status');
  save.disabled = true; input.disabled = true;
  status.textContent = '画像を端末内で圧縮しています…';
  try {
    // Sequential decoding limits peak memory. Apply the selection only after every file succeeds.
    const compressed = [];
    for (let i = 0; i < files.length; i++) {
      if (generation !== screenshotGeneration) return;
      status.textContent = `画像を圧縮中… ${i + 1}/${files.length}`;
      compressed.push(await compressScreenshot(files[i]));
    }
    if (generation !== screenshotGeneration) return;
    validateScreenshots(compressed);
    screenshotDraft = [...screenshotDraft, ...compressed];
    renderScreenshotDraft(); status.textContent = '圧縮が完了しました。「Save Trade」でトレードと一緒に保存します。';
  } catch (error) {
    if (generation !== screenshotGeneration) return;
    console.error('[TJ] Screenshot compression failed:', error);
    status.textContent = '画像を追加できませんでした。今回選んだ画像は追加せず、既存の添付は保持しています。別の画像で再試行してください。';
  } finally {
    if (generation === screenshotGeneration) {
      screenshotsBusy = false; save.disabled = false; input.disabled = false; input.value = '';
    }
  }
}
function initScreenshotUI() {
  // Rendering and visibility changes retire URLs once their image is no longer displayed.
  const observer = new MutationObserver(scheduleScreenshotCleanup);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class', 'hidden', 'open'] });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return; // A page in the back/forward cache still needs its images.
    for (const url of screenshotUrls) URL.revokeObjectURL(url);
    screenshotUrls.clear();
  });
  const input = document.getElementById('screenshot-input');
  input.addEventListener('change', () => { const files = Array.from(input.files); input.value = ''; addScreenshotFiles(files); });
  document.addEventListener('click', event => {
    const remove = event.target.closest('[data-shot-remove]');
    if (remove) {
      if (screenshotsBusy) return;
      if (!confirm('この画像を添付から削除しますか？「Save Trade」で確定するまで保存済みの画像は残ります。')) return;
      screenshotDraft = screenshotDraft.filter(image => image.id !== remove.dataset.shotRemove);
      renderScreenshotDraft(); return;
    }
    const open = event.target.closest('[data-shot-id]');
    if (!open) return;
    const images = open.dataset.shotTrade ? load().find(t => t.id === open.dataset.shotTrade)?.screenshots : screenshotDraft;
    const image = images?.find(image => image.id === open.dataset.shotId);
    if (!image) return;
    const viewer = document.getElementById('screenshot-viewer');
    const preview = document.getElementById('screenshot-full');
    preview.src = screenshotSource(image); preview.alt = image.name;
    document.getElementById('screenshot-viewer-caption').textContent = `${image.name}・${image.width}×${image.height}・${screenshotBytes(image.size)}`;
    viewer.showModal();
  });
  const viewer = document.getElementById('screenshot-viewer');
  document.getElementById('screenshot-viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  viewer.addEventListener('close', () => { document.getElementById('screenshot-full').removeAttribute('src'); });
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
}
