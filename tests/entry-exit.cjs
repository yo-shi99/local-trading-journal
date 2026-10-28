// Isolated browser contexts and synthetic fixtures only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8088';
const event = (type, quantity, i = 0, price = 80000, realizedPnl = 0) => ({ id: 'event-' + i, type, quantity, price, realizedPnl,
  datetime: `2026-10-27T${11 + i}:00`, reason: '根拠 <img src=x onerror=alert(1)>', memo: 'メモ\n保持' });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let passed = 0;
  async function test(name, fn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    try { await page.goto(base); await page.waitForSelector('.day-cell'); await fn(page); assert.deepEqual(errors, []); passed++; console.log('PASS', name); }
    finally { await context.close(); }
  }
  async function image(page, name = 'test.png') {
    const buffer = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 160;
      c.getContext('2d').fillRect(0, 0, 320, 160); return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    return { name, mimeType: 'image/png', buffer };
  }
  async function create(page, includeImage = false) {
    await page.locator('.header-add-btn').click(); await page.waitForSelector('#crypto-entry-price', { state: 'visible' });
    await page.locator('#update-import-text').fill('銘柄: BTC\n方向: Short\nEntry: 80000\nSize: 0.01\nCVD: Entry時解析\nエントリー根拠: 元のEntry根拠\n振り返り: 元の振り返り');
    await page.locator('#update-import-analyse').click(); await page.locator('#crypto-entry-at').fill('2026-10-27T10:00');
    if (includeImage) { await page.setInputFiles('#screenshot-input', await image(page)); await page.waitForFunction(() => !screenshotsBusy && screenshotDraft.length === 1); }
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(() => closeModal());
    return page.evaluate(() => load()[0].id);
  }
  async function edit(page, id) {
    await page.evaluate(id => editFromTable(id), id);
    await page.waitForFunction(() => editingId !== null && document.getElementById('trade-form').style.display === 'block');
    assert.equal(await page.locator('#exit-update-editor').isVisible(), true);
  }
  async function snapshot(page) { return page.evaluate(async () => screenshotsForBackup(await dbSnapshot())); }
  async function show(page) { await page.evaluate(() => openDay(load()[0].date)); }
  async function attachEvents(page, events) {
    await page.evaluate(async events => { const t = structuredClone(load()[0]); t.events = events; await dbPut('trades', t); await _initStorageCore(); }, events);
  }
  async function saveExit(page) {
    await page.locator('#save-exit-update').click();
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'none');
  }
  try {
    await test('legacy display/edit/save/reload/backup/restore adds no events or Exit metadata', async page => {
      const id = await create(page, true); const before = (await snapshot(page)).trades[0];
      await show(page); assert.equal(await page.locator('.trade-events-panel').count(), 0); assert.equal(await page.locator('.trade-state-panel').count(), 0);
      assert.ok((await page.locator('.crypto-trade-details').innerText()).includes('元の振り返り'));
      await edit(page, id); await page.locator('#crypto-review').fill('従来欄を編集');
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'none');
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      const t = (await snapshot(page)).trades[0];
      assert.equal(Object.hasOwn(t, 'events'), false); assert.equal(Object.hasOwn(t, 'exitUpdate'), false);
      assert.equal(t.cryptoJournal.review, '従来欄を編集'); assert.deepEqual(t.screenshots, before.screenshots);
      const dl = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = await fs.readFile(await (await dl).path());
      await page.evaluate(id => deleteTrade(id), id); await page.waitForFunction(() => load().length === 0);
      const loaded = page.waitForEvent('load'); await page.setInputFiles('#restore-input', { name: 'old.json', mimeType: 'application/json', buffer: backup });
      await loaded; await page.waitForFunction(() => load().length === 1); assert.deepEqual((await snapshot(page)).trades[0], t);
    });

    await test('baseline Partial TP detail shows Open, fields, all event facts, escaped text; read makes no DB change', async page => {
      await create(page); await attachEvents(page, [event('Partial TP', .005, 0, 81000, 10)]);
      const before = await snapshot(page); await show(page);
      assert.ok((await page.locator('.trade-state-panel').innerText()).includes('Open'));
      assert.ok((await page.locator('.trade-state-panel').innerText()).includes('0.005'));
      assert.ok((await page.locator('.trade-state-panel').innerText()).includes('旧Entry情報'));
      const text = await page.locator('.trade-event-card').innerText();
      for (const value of ['Partial TP', '2026-10-27T11:00', '81000', '0.005', '10', '根拠', 'メモ']) assert.ok(text.includes(value));
      assert.equal(await page.locator('.trade-event-card img').count(), 0); assert.deepEqual(await snapshot(page), before);
    });

    await test('baseline Partial SL + Final Exit closes and renders chronological history', async page => {
      await create(page); await page.evaluate(async () => { const t = structuredClone(load()[0]); t.cryptoJournal.positionSize = .02; await dbPut('trades', t); await _initStorageCore(); });
      await attachEvents(page, [event('Final Exit', .015, 1, 79000, 3), event('Partial SL', .005, 0, 81000, -4)]);
      await show(page); assert.ok((await page.locator('.trade-state-panel').innerText()).includes('Closed'));
      assert.ok((await page.locator('.trade-event-card').first().innerText()).includes('Partial SL'));
      assert.equal(await page.evaluate(() => getTradeState(load()[0]).remainingQuantity), 0);
    });

    await test('explicit Entry never doubles baseline; Add Entry alone includes baseline', async page => {
      await create(page); await attachEvents(page, [event('Entry', .02), event('Partial TP', .005, 1)]);
      assert.equal(await page.evaluate(() => getTradeState(load()[0]).totalEntryQuantity), .02);
      await attachEvents(page, [event('Add Entry', .01, 0, 79000)]); await show(page);
      const s = await page.evaluate(() => getTradeState(load()[0])); assert.equal(s.totalEntryQuantity, .02); assert.equal(s.averageEntryPrice, 79500);
      assert.ok((await page.locator('.trade-state-panel').innerText()).includes('79500'));
    });

    await test('Invalid over-exit is visibly warned and never repaired', async page => {
      await create(page); const events = [event('Final Exit', .02)]; await attachEvents(page, events);
      const before = await snapshot(page); await show(page);
      assert.ok((await page.locator('.trade-state-panel').innerText()).includes('Invalid'));
      assert.ok((await page.locator('.trade-state-warnings').innerText()).includes('EXIT_EXCEEDS_ENTRY'));
      assert.equal(await page.evaluate(() => getTradeState(load()[0]).remainingQuantity), -.01);
      assert.deepEqual(await snapshot(page), before);
    });

    await test('Exit-only UI save ignores unsaved Entry edits and preserves original analysis/events/images, including category metadata', async page => {
      const id = await create(page, true);
      await page.evaluate(async () => { const t = structuredClone(load()[0]); delete t.screenshots[0].category; t.screenshots.push({ ...t.screenshots[0], id: 'entry-classified', category: 'Entry' }); await dbPut('trades', t); await _initStorageCore(); });
      await attachEvents(page, [event('Partial TP', .005)]);
      const before = (await snapshot(page)).trades[0];
      await edit(page, id);
      await page.locator('#crypto-reason').fill('保存してはいけないEntry変更');
      await page.locator('#crypto-review').fill('保存してはいけない旧振り返り変更');
      await page.locator('#update-import-text').fill('上書きしてはいけない原文');
      await page.evaluate(() => { screenshotDraft = []; renderScreenshotDraft(); });
      await page.locator('#exit-update-editor').evaluate(el => el.open = true); await page.locator('#exit-update-review').fill('Exitレビュー\n独立保存');
      await page.locator('#exit-update-reason').fill('利確条件'); await page.locator('#exit-update-memo').fill('更新メモ');
      await page.locator('#exit-update-editor').evaluate(el => el.open = true); await page.setInputFiles('#exit-update-input', await image(page, 'exit.png'));
      await page.waitForFunction(() => !exitScreenshotsBusy && exitScreenshotDraft.length === 1);
      await saveExit(page); await page.reload(); await page.waitForFunction(() => load().length === 1);
      const after = (await snapshot(page)).trades[0];
      const { exitUpdate, screenshots, ...rest } = after; const { screenshots: oldImages, ...oldRest } = before;
      assert.deepEqual(rest, oldRest); assert.deepEqual(screenshots.slice(0, 2), oldImages);
      assert.deepEqual(exitUpdate, { review: 'Exitレビュー\n独立保存', reason: '利確条件', memo: '更新メモ' });
      assert.equal(screenshots[2].category, 'Exit'); assert.equal(screenshots[0].category, undefined); assert.equal(screenshots[1].category, 'Entry');
      assert.equal(await page.evaluate(() => load()[0].screenshots.every(i => i.blob instanceof Blob)), true);
      await show(page); assert.ok((await page.locator('.exit-update-panel').innerText()).includes('Exitレビュー'));
      assert.ok((await page.locator('.crypto-trade-details').innerText()).includes('元のEntry根拠'));
      await page.evaluate(() => closeModal());
      const dl = page.waitForEvent('download'); await page.evaluate(() => backupData()); const backup = await fs.readFile(await (await dl).path());
      assert.equal(JSON.parse(backup).version, 10); assert.equal(JSON.parse(backup).databaseVersion, 5);
      await page.evaluate(id => deleteTrade(id), id); await page.waitForFunction(() => load().length === 0);
      const loaded = page.waitForEvent('load'); await page.setInputFiles('#restore-input', { name: 'new.json', mimeType: 'application/json', buffer: backup });
      await loaded; await page.waitForFunction(() => load().length === 1); assert.deepEqual((await snapshot(page)).trades[0], after);
      await edit(page, id); assert.equal(await page.locator('#crypto-review').inputValue(), '元の振り返り');
      assert.equal(await page.locator('#exit-update-review').inputValue(), exitUpdate.review);
    });

    await test('new trade can independently save Entry memo and Exit review with normal Save Trade', async page => {
      await page.locator('.header-add-btn').click(); await page.waitForSelector('#crypto-entry-price', { state: 'visible' });
      await page.locator('#crypto-entry-price').fill('80000'); await page.locator('#crypto-size').fill('0.01');
      await page.locator('#crypto-review').fill('Entry時メモ'); await page.locator('#exit-update-editor').evaluate(el => el.open = true); await page.locator('#exit-update-review').fill('Exitレビュー');
      await page.locator('#exit-update-category').selectOption('Update');
      await page.locator('#exit-update-editor').evaluate(el => el.open = true); await page.setInputFiles('#exit-update-input', await image(page, 'update.png'));
      await page.waitForFunction(() => !exitScreenshotsBusy && exitScreenshotDraft.length === 1);
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click(); await page.waitForFunction(() => load().length === 1);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await page.evaluate(() => [load()[0].cryptoJournal.review, load()[0].exitUpdate.review, Object.hasOwn(load()[0], 'events')]), ['Entry時メモ', 'Exitレビュー', false]);
      assert.equal(await page.evaluate(() => load()[0].screenshots[0].category), 'Update');
    });

    await test('all four optional image categories and category-less image remain viewable and keep Blob bytes', async page => {
      const id = await create(page, true);
      await page.evaluate(async () => {
        const t = structuredClone(load()[0]);
        for (const category of ['Entry', 'Update', 'Exit', 'Other']) t.screenshots.push({ ...t.screenshots[0], id: category, category });
        await dbPut('trades', t); await _initStorageCore();
      });
      const before = (await snapshot(page)).trades[0]; await show(page);
      assert.equal(await page.locator('.trade-screenshots .screenshot-open').count(), 5);
      for (const category of ['Entry', 'Update', 'Exit', 'Other']) assert.ok((await page.locator('.trade-screenshots').innerText()).includes(category));
      await page.locator('.trade-screenshots .screenshot-open').last().click();
      await page.waitForFunction(() => document.getElementById('screenshot-full').naturalWidth === 320);
      await page.locator('#screenshot-viewer-close').click();
      await edit(page, id); await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'none');
      assert.deepEqual((await snapshot(page)).trades[0].screenshots, before.screenshots);
      assert.equal(await page.evaluate(() => load()[0].screenshots.every(image => image.blob instanceof Blob)), true);
    });

    await test('Exit patch reads latest DB Entry and concurrent append retains both update and event', async page => {
      const id = await create(page, true);
      await page.evaluate(async ({ id, e }) => {
        const t = await dbGet('trades', id); t.cryptoJournal.entryReason = '別操作で保存した新しいEntry'; await dbPut('trades', t);
        await Promise.all([saveTradeExitUpdate(id, { review: 'review', reason: 'reason', memo: 'memo' }), appendTradeEvent(id, e)]);
      }, { id, e: event('Partial TP', .005) });
      const t = await page.evaluate(id => dbGet('trades', id), id);
      assert.equal(t.cryptoJournal.entryReason, '別操作で保存した新しいEntry'); assert.equal(t.events.length, 1); assert.equal(t.exitUpdate.review, 'review');
      assert.equal(await page.evaluate(id => dbGet('trades', id).then(t => t.screenshots[0].blob instanceof Blob), id), true);
    });

    await test('Exit save transaction abort preserves Entry, history, images, previous update and cache', async page => {
      const id = await create(page, true); await attachEvents(page, [event('Partial TP', .005)]);
      await page.evaluate(id => saveTradeExitUpdate(id, { review: 'keep', reason: 'keep', memo: 'keep' }), id);
      const before = await snapshot(page);
      assert.equal(await page.evaluate(async id => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) { const r = original.apply(this, args); this.transaction.abort(); return r; };
        try { await saveTradeExitUpdate(id, { review: 'bad', reason: 'bad', memo: 'bad' }); return false; }
        catch { return true; } finally { IDBObjectStore.prototype.put = original; }
      }, id), true);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades), before.trades);
      await page.reload(); await page.waitForFunction(() => load().length === 1); assert.deepEqual(await snapshot(page), before);
    });

    await test('bad Exit metadata and unsupported screenshot category are rejected before restore writes', async page => {
      await create(page, true); const before = await snapshot(page);
      for (const mode of ['metadata', 'category']) {
        const stores = structuredClone(before);
        if (mode === 'metadata') stores.trades[0].exitUpdate = { review: 1, reason: '', memo: '' };
        else stores.trades[0].screenshots[0].category = 'NotACategory';
        const backup = { format: 'local-trading-journal', version: 10, databaseVersion: 5, exportedAt: new Date().toISOString(), stores };
        await page.setInputFiles('#restore-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
        await page.waitForFunction(() => document.getElementById('restore-input').value === ''); assert.deepEqual(await snapshot(page), before);
      }
    });

    await test('cancelled late Exit image compression cannot attach to a new Entry form', async page => {
      const id = await create(page); await edit(page, id);
      await page.evaluate(() => { const original = compressScreenshot; window.releaseExitImage = null;
        compressScreenshot = file => new Promise(resolve => { window.releaseExitImage = async () => resolve(await original(file)); }); });
      await page.locator('#exit-update-editor').evaluate(el => el.open = true); await page.setInputFiles('#exit-update-input', await image(page));
      await page.waitForFunction(() => exitScreenshotsBusy && !!window.releaseExitImage);
      await page.evaluate(() => cancelForm()); await page.evaluate(() => openAddGlobal());
      await page.waitForSelector('#crypto-entry-price', { state: 'visible' });
      await page.evaluate(() => window.releaseExitImage());
      await page.waitForFunction(() => exitScreenshotsBusy === false);
      assert.equal(await page.evaluate(() => exitScreenshotDraft.length), 0);
      assert.equal(await page.locator('#exit-update-review').inputValue(), '');
    });
    for (const width of [320, 412, 915]) await test(`state/events/Exit edit fit ${width}px`, async page => {
      const id = await create(page); await attachEvents(page, [event('Partial TP', .005)]);
      await page.setViewportSize({ width, height: 844 }); await show(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await edit(page, id);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok((await page.locator('#save-exit-update').boundingBox()).height >= 44);
    });
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
