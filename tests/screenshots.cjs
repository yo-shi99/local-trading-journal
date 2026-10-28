// JOURNAL_TEST_URL=http://127.0.0.1:8085 node tests/screenshots.cjs
// Synthetic images and isolated browser contexts only; no personal photos or records.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8085';
  let passed = 0;
  async function test(name, fn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage(), errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    const accept = async d => { dialogs.push(d.message()); await d.accept(); };
    page.on('dialog', accept);
    try { await page.goto(base); await page.waitForSelector('.day-cell'); await fn(page, accept); assert.deepEqual(errors, []); console.log('PASS', name); passed++; }
    finally { await context.close(); }
  }
  async function image(page, name = 'chart.png', width = 2400, height = 1200) {
    const base64 = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#ef3344'); gradient.addColorStop(1, '#1177ee'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff'; ctx.font = '80px sans-serif'; ctx.fillText('BTC / TEST', 80, 120);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { width, height });
    return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
  }
  async function begin(page) {
    await page.locator('.header-add-btn').click();
    await page.locator('#crypto-entry-price').fill('65000'); await page.locator('#crypto-size').fill('0.01');
  }
  async function attach(page, files) {
    await page.setInputFiles('#screenshot-input', files);
    await page.waitForFunction(() => !screenshotsBusy);
    assert.ok((await page.locator('#screenshot-status').innerText()).includes('圧縮が完了'));
  }
  async function save(page) {
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(() => closeModal());
  }
  async function edit(page) {
    await page.evaluate(() => editFromTable(load()[0].id));
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
  }
  try {
    await test('one image: compression, dimensions/bytes, save/reload, thumbnail and enlargement', async page => {
      const original = await image(page); await begin(page); await attach(page, [original]);
      const draft = await page.evaluate(async () => (await screenshotsForBackup({ trades: [{ screenshots: screenshotDraft }] })).trades[0].screenshots);
      assert.equal(await page.evaluate(() => screenshotDraft[0].blob instanceof Blob && screenshotDraft[0].dataUrl === undefined), true);
      assert.equal(draft.length, 1); assert.equal(draft[0].type, 'image/webp');
      assert.equal(draft[0].width, 1600); assert.equal(draft[0].height, 800);
      assert.equal(Buffer.from(draft[0].dataUrl.split(',')[1], 'base64').length, draft[0].size);
      assert.ok(draft[0].size < original.buffer.length);
      assert.ok((await page.locator('#screenshot-total').innerText()).includes('1枚'));
      assert.equal(await page.evaluate(() => load().length), 0);
      await save(page); await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(async () => { const t = await dbGet('trades', load()[0].id); return t.screenshots[0].blob instanceof Blob && t.screenshots[0].dataUrl === undefined; }), true);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0].screenshots), draft);
      await page.evaluate(() => openDay(load()[0].date));
      await page.locator('.trade-screenshots .screenshot-open').click();
      assert.equal(await page.locator('#screenshot-viewer').isVisible(), true);
      assert.equal(await page.locator('#screenshot-full').evaluate(img => img.complete && img.naturalWidth === 1600), true);
      await page.locator('#screenshot-viewer-close').click();
      assert.equal(await page.locator('#screenshot-viewer').isVisible(), false);
    });
    await test('three images, add/delete/cancel/edit, capacities, JSON backup and restore', async (page, accept) => {
      const files = [await image(page, 'a.png'), await image(page, 'b.png', 1200, 2400), await image(page, 'c.png', 400, 300)];
      await begin(page); await attach(page, files);
      assert.equal(await page.evaluate(() => screenshotDraft.length), 3);
      await page.setViewportSize({ width: 320, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await save(page); await page.reload(); await page.waitForFunction(() => load().length === 1);
      const original = await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]);
      assert.equal(original.screenshots.length, 3);
      await edit(page);
      page.off('dialog', accept); page.once('dialog', d => d.dismiss());
      await page.locator('.screenshot-remove').first().click();
      assert.equal(await page.evaluate(() => screenshotDraft.length), 3);
      page.on('dialog', accept);
      await page.locator('.screenshot-remove').first().click();
      assert.equal(await page.evaluate(() => screenshotDraft.length), 2);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [await dbGet('trades', load()[0].id)] })).trades[0]), original);
      await page.locator('#trade-form button[onclick="cancelForm()"]').click(); await page.evaluate(() => closeModal());
      await edit(page); assert.equal(await page.evaluate(() => screenshotDraft.length), 3);
      await page.locator('.screenshot-remove').first().click();
      await attach(page, [await image(page, 'added.png')]);
      assert.equal(await page.evaluate(() => screenshotDraft.length), 3);
      await save(page); await page.reload(); await page.waitForFunction(() => load().length === 1);
      const updated = await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]);
      assert.equal(updated.screenshots[2].name, 'added.png');
      assert.ok(!updated.screenshots.some(i => i.id === original.screenshots[0].id));
      const downloaded = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = await fs.readFile(await (await downloaded).path());
      assert.deepEqual(JSON.parse(backup).stores.trades[0].screenshots, updated.screenshots);
      await page.evaluate(() => deleteTrade(load()[0].id)); await page.waitForFunction(() => load().length === 0);
      const reloaded = page.waitForEvent('load');
      await page.setInputFiles('#restore-input', { name: 'images.json', mimeType: 'application/json', buffer: backup });
      await reloaded; await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => load()[0].screenshots.every(image => image.blob instanceof Blob && image.dataUrl === undefined)), true);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]), updated);
      await edit(page);
      while (await page.locator('.screenshot-remove').count()) await page.locator('.screenshot-remove').first().click();
      await save(page);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0].screenshots), []);
    });
    await test('zero images; old records without images remain editable', async page => {
      await begin(page); await save(page); assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0].screenshots), []);
      await page.evaluate(async () => { const t = structuredClone(load()[0]); delete t.screenshots; await dbPut('trades', t); });
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      await edit(page); assert.equal(await page.evaluate(() => screenshotDraft.length), 0);
      await save(page); assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0].screenshots), []);
    });
    await test('JPEG fallback when WebP encoder is unsupported', async page => {
      await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) { return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality); };
      });
      await begin(page); await attach(page, [await image(page)]);
      assert.equal(await page.evaluate(() => screenshotDraft[0].type), 'image/jpeg');
      await save(page); assert.equal(await page.evaluate(() => load()[0].screenshots[0].type), 'image/jpeg');
    });
    await test('corrupt images and encoder failure preserve saved records and current draft', async page => {
      await begin(page); const file = await image(page); await attach(page, [file]); await save(page);
      const original = await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]); await edit(page);
      await page.setInputFiles('#screenshot-input', [file, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }]);
      await page.waitForFunction(() => !screenshotsBusy);
      assert.ok((await page.locator('#screenshot-status').innerText()).includes('追加できません'));
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [{ screenshots: screenshotDraft }] })).trades[0].screenshots), original.screenshots);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [await dbGet('trades', load()[0].id)] })).trades[0]), original);
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); }; });
      await page.setInputFiles('#screenshot-input', [file]); await page.waitForFunction(() => !screenshotsBusy);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [{ screenshots: screenshotDraft }] })).trades[0].screenshots), original.screenshots);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [await dbGet('trades', load()[0].id)] })).trades[0]), original);
    });
    await test('quota/storage abort keeps original trade/images; invalid backup rejected', async page => {
      await begin(page); await attach(page, [await image(page)]); await save(page);
      const original = await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]); await edit(page);
      await attach(page, [await image(page, 'extra.png')]);
      await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(record) { const req = original.call(this, record); if (this.name === 'trades') this.transaction.abort(); return req; };
      });
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => _tjUnavailable);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]), original);
      const rejected = await page.evaluate(() => {
        const record = structuredClone(load()[0]); record.screenshots[0].size++;
        try { parseJournalBackup({ version: 9, trades: [record] }); return false; } catch { return true; }
      });
      assert.equal(rejected, true);
    });
    await test('legacy form saves images atomically too', async page => {
      await begin(page); await page.locator('#crypto-legacy-options summary').click(); await page.locator('#crypto-legacy-toggle').click();
      await page.locator('#f-sym').fill('OLD'); await page.locator('.leg-add-btn.buy').click();
      await page.locator('.leg-row input[type=number]').nth(0).fill('100'); await page.locator('.leg-row input[type=number]').nth(1).fill('1');
      await attach(page, [await image(page)]); await save(page); await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => load()[0].screenshots.length), 1);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal), undefined);
    });
    await test('late compression cannot attach to another form after cancelling', async page => {
      await begin(page); const file = await image(page); await attach(page, [file]); await save(page);
      const original = await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]); await edit(page);
      await page.evaluate(() => {
        const result = structuredClone(screenshotDraft[0]); result.id = 'delayed-image';
        compressScreenshot = () => new Promise(resolve => { window.finishScreenshot = () => resolve(result); });
      });
      await page.setInputFiles('#screenshot-input', [file]);
      await page.waitForFunction(() => screenshotsBusy && typeof window.finishScreenshot === 'function');
      assert.equal(await page.getByRole('button', { name: 'Save Trade', exact: true }).isDisabled(), true);
      await page.locator('#trade-form button[onclick="cancelForm()"]').click();
      await page.evaluate(() => closeModal()); await begin(page);
      await page.evaluate(() => finishScreenshot());
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [{ screenshots: screenshotDraft }] })).trades[0].screenshots), []);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: [await dbGet('trades', load()[0].id)] })).trades[0]), original);
      assert.equal(await page.locator('#screenshot-input').isDisabled(), false);
    });
    await test('legacy Base64 attachments display and restore as Blobs without changing bytes', async page => {
      await begin(page); await attach(page, [await image(page)]); await save(page);
      const legacy = await page.evaluate(async () => {
        const t = (await screenshotsForBackup({ trades: load() })).trades[0];
        await dbPut('trades', t); return t;
      });
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => typeof load()[0].screenshots[0].dataUrl), 'string');
      await page.evaluate(() => openDay(load()[0].date));
      const img = page.locator('.trade-screenshots .screenshot-open img');
      assert.ok((await img.getAttribute('src')).startsWith('blob:'));
      await page.waitForFunction(() => document.querySelector('.trade-screenshots img').naturalWidth === 1600);
      await page.evaluate(() => closeModal());
      const dl = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = await fs.readFile(await (await dl).path());
      assert.equal(JSON.parse(backup).version, 10);
      assert.deepEqual(JSON.parse(backup).stores.trades[0], legacy);
      await page.evaluate(() => deleteTrade(load()[0].id)); await page.waitForFunction(() => load().length === 0);
      const loaded = page.waitForEvent('load');
      await page.setInputFiles('#restore-input', { name: 'legacy-images.json', mimeType: 'application/json', buffer: backup });
      await loaded; await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => load()[0].screenshots[0].blob instanceof Blob && load()[0].screenshots[0].dataUrl === undefined), true);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades[0]), legacy);
      // Also verify converting a legacy record when editing, without waiting for backup/restore.
      await page.evaluate(async legacy => { await dbPut('trades', legacy); }, legacy);
      await page.reload(); await page.waitForFunction(() => load().length === 1); await edit(page);
      await save(page);
      assert.equal(await page.evaluate(() => load()[0].screenshots[0].blob instanceof Blob && load()[0].screenshots[0].dataUrl === undefined), true);
    });
    await test('Object URLs are released on preview close, redraw, deletion and modal close', async page => {
      await page.evaluate(() => {
        window.urlAudit = { created: [], revoked: [] };
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); urlAudit.created.push(url); return url; };
        URL.revokeObjectURL = url => { urlAudit.revoked.push(url); return revoke(url); };
      });
      await begin(page); await attach(page, [await image(page)]);
      const draftUrl = await page.locator('#screenshot-draft img').getAttribute('src');
      assert.ok(draftUrl.startsWith('blob:'));
      await save(page);
      await page.waitForFunction(url => urlAudit.revoked.includes(url), draftUrl);
      await page.evaluate(() => openDay(load()[0].date));
      const detailUrl = await page.locator('.trade-screenshots img').getAttribute('src');
      await page.locator('.trade-screenshots .screenshot-open').click();
      const previewUrl = await page.locator('#screenshot-full').getAttribute('src');
      await page.locator('#screenshot-viewer-close').click();
      await page.waitForFunction(url => urlAudit.revoked.includes(url), previewUrl);
      assert.equal(await page.evaluate(url => urlAudit.revoked.includes(url), detailUrl), false);
      await edit(page);
      const editUrl = await page.locator('#screenshot-draft img').getAttribute('src');
      await page.locator('.screenshot-remove').click();
      await page.waitForFunction(url => urlAudit.revoked.includes(url), editUrl);
      await page.evaluate(() => closeModal());
      // Close returns from the editor to its detail; close the detail to retire its URLs.
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => screenshotUrls.size === 0);
      assert.equal(await page.evaluate(() => urlAudit.created.every(url => urlAudit.revoked.includes(url))), true);
    });
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
