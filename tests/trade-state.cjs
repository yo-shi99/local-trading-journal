// JOURNAL_TEST_URL=http://127.0.0.1:8088 node tests/trade-state.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8088';
const legacy = { id: 'legacy-state', symbol: 'TEST', date: '2026-10-27', type: 'stock',
  notes: 'old', tags: [], mistakes: [], rules: [],
  legs: [{ id: 'a', action: 'buy', date: '2026-10-27T10:00', price: 10, quantity: 2, commission: 0, fees: 0 }] };
const events = [
  ['Entry', .02, 80000, null], ['Add Entry', .01, 77000, null],
  ['Partial TP', .005, 82000, 10], ['Partial SL', .005, 79000, -4], ['Final Exit', .02, 81000, 3],
].map(([type, quantity, price, realizedPnl], index) => ({ id: 'event-' + index, type, quantity, price, realizedPnl,
  datetime: `2026-10-27T${10 + index}:00`, reason: '根拠', memo: 'メモ' }));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let passed = 0;
  async function test(name, fn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    try { await page.goto(base); await page.waitForSelector('.day-cell'); await fn(page); assert.deepEqual(errors, []); passed++; console.log('PASS', name); }
    finally { await context.close(); }
  }
  async function seed(page, trade) { await page.evaluate(async t => { await dbPut('trades', t); await _initStorageCore(); }, trade); }
  async function state(page) { return page.evaluate(() => getTradeState(load()[0])); }
  async function snapshot(page) { return page.evaluate(async () => screenshotsForBackup(await dbSnapshot())); }
  async function roundTrip(page) {
    const download = page.waitForEvent('download'); await page.evaluate(() => backupData());
    const backup = await fs.readFile(await (await download).path());
    assert.equal(JSON.parse(backup).version, 10); assert.equal(JSON.parse(backup).databaseVersion, 5);
    await page.evaluate(() => deleteTrade(load()[0].id)); await page.waitForFunction(() => load().length === 0);
    const loaded = page.waitForEvent('load');
    await page.setInputFiles('#restore-input', { name: 'state-backup.json', mimeType: 'application/json', buffer: backup });
    await loaded; await page.waitForFunction(() => load().length === 1);
  }
  try {
    await test('no history / empty history use legacy state; UI edit and backup/restore stay compatible', async page => {
      await seed(page, legacy);
      const s = await state(page);
      assert.equal(s.source, 'legacy'); assert.equal(s.averageEntryPrice, 10); assert.equal(s.remainingQuantity, 2);
      assert.equal(s.realizedPnl, await page.evaluate(() => getPnl(load()[0])));
      assert.equal(s.status, 'Open');
      await page.evaluate(()=>{if(hasTradeEditorNavigation())cancelForm();}); await page.waitForFunction(()=>!tradeEditorHistoryClosing&&!detailHistoryClosing); await page.evaluate(() => (openTradeDetail(load()[0].id), editTradeEntry('fields')));
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      await page.locator('#f-notes').fill('edited'); await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'none'); await page.evaluate(() => closeModal());
      await roundTrip(page); assert.deepEqual(await state(page), s);
      assert.equal(await page.evaluate(() => Object.hasOwn(load()[0], 'events')), false);
      assert.equal(await page.evaluate(() => getTradeState({ ...load()[0], events: [] }).source), 'legacy');
      const oldFormat = await page.evaluate(() => getTradeState({ id: 'old-format', type: 'stock',
        side: 'long', date: '2026-10-27', quantity: 2, entryPrice: '10', exitPrice: '12' }));
      assert.equal(oldFormat.source, 'legacy'); assert.equal(oldFormat.averageEntryPrice, 10);
      assert.equal(oldFormat.lastExitPrice, 12); assert.equal(oldFormat.realizedPnl, 4);
    });

    await test('events calculate without writes; reload and backup/restore preserve exact events and state', async page => {
      await seed(page, { ...legacy, events });
      const before = await snapshot(page);
      const s = await state(page);
      assert.equal(s.source, 'events'); assert.equal(s.status, 'Closed'); assert.equal(s.averageEntryPrice, 79000);
      assert.equal(s.remainingQuantity, 0); assert.equal(s.realizedPnl, 9);
      assert.equal(s.addEntryCount, 1); assert.equal(s.partialTpCount, 1); assert.equal(s.partialSlCount, 1);
      assert.equal(s.lastExitPrice, 81000); assert.equal(s.lastExitDatetime, '2026-10-27T14:00');
      assert.deepEqual(await snapshot(page), before);
      await page.reload(); await page.waitForFunction(() => load().length === 1); assert.deepEqual(await state(page), s);
      await roundTrip(page); assert.deepEqual(await state(page), s); assert.deepEqual((await snapshot(page)).trades, before.trades);
    });

    await test('crypto Long/Short retain original fields, original text and image Blob; event result is direction independent', async page => {
      await page.locator('.header-add-btn').click();
      const analysis = '銘柄: BTC\n方向: Short\nEntry: 65000\nSize: 0.01\nCVD: 元の解析原文';
      await page.locator('#update-import-text').fill(analysis); await page.locator('#update-import-analyse').click();
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
      await page.evaluate(() => closeModal());
      await page.evaluate(async events => {
        const t = structuredClone(load()[0]); t.events = events;
        const c = document.createElement('canvas'); c.width = c.height = 5;
        const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg'));
        t.screenshots = [{ id: 'test-image', name: 'test.jpg', type: blob.type, width: 5, height: 5, size: blob.size, blob }];
        await dbPut('trades', t); await _initStorageCore();
      }, events);
      const before = await snapshot(page), s = await state(page);
      assert.equal(s.realizedPnl, 9);
      assert.deepEqual(await page.evaluate(() => getTradeState({ ...load()[0], cryptoJournal: { ...load()[0].cryptoJournal, direction: 'Long' } })), s);
      await roundTrip(page); assert.deepEqual(await state(page), s); assert.deepEqual((await snapshot(page)).trades, before.trades);
      assert.equal(await page.evaluate(() => load()[0].screenshots[0].blob instanceof Blob), true);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.analysisText), analysis);
    });

    await test('invalid histories flag issues without rewriting; failed append preserves original state and persisted record', async page => {
      const invalid = [{ ...events[0], quantity: .01 }, { ...events[4], quantity: .02 }];
      await seed(page, { ...legacy, events: invalid });
      const before = await snapshot(page), s = await state(page);
      assert.equal(s.status, 'Invalid'); assert.equal(s.remainingQuantity, -.01); assert.equal(s.isValid, false);
      assert.deepEqual(await snapshot(page), before);
      assert.equal(await page.evaluate(async () => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) { const r = original.apply(this, args); this.transaction.abort(); return r; };
        try { await appendTradeEvent(load()[0].id, { type: 'Add Entry', datetime: '2026-10-27T15:00', price: 79000, quantity: .01 }); return false; }
        catch { return true; } finally { IDBObjectStore.prototype.put = original; }
      }), true);
      assert.deepEqual(await state(page), s);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await state(page), s); assert.deepEqual(await snapshot(page), before);
    });
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
