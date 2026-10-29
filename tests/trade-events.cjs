// JOURNAL_TEST_URL=http://127.0.0.1:8088 node tests/trade-events.cjs
// Synthetic records and isolated browser contexts only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8088';
const legacy = { id: 'legacy', symbol: 'TEST', type: 'stock', date: '2026-10-22',
  notes: 'original', tags: [], mistakes: [], rules: [], future: { keep: true },
  legs: [{ id: 'leg', action: 'buy', date: '2026-10-22T09:00', price: 10, quantity: 2, commission: 0, fees: 0 }] };
const entry = { type: 'Entry', datetime: '2026-10-22T09:00', price: 10, quantity: 2, realizedPnl: null, reason: '根拠', memo: 'メモ' };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let passed = 0;
  async function test(name, fn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    try {
      await page.goto(base); await page.waitForSelector('.day-cell');
      await fn(page, context); assert.deepEqual(errors, []); passed++; console.log('PASS', name);
    } finally { await context.close(); }
  }
  async function seed(page, record = legacy) {
    await page.evaluate(async t => { await dbPut('trades', t); await _initStorageCore(); }, record);
  }
  async function edit(page, id, field, value) {
    await page.evaluate(()=>{if(hasTradeEditorNavigation())cancelForm();}); await page.waitForFunction(()=>!tradeEditorHistoryClosing&&!detailHistoryClosing); await page.evaluate(id => (openTradeDetail(id), editTradeEntry('fields')), id);
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
    await page.locator(field).fill(value);
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(() => closeModal());
  }
  async function snapshot(page) { return page.evaluate(async () => screenshotsForBackup(await dbSnapshot())); }
  async function restore(page, data) {
    const loaded = page.waitForEvent('load');
    await page.setInputFiles('#restore-input', { name: 'events.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await loaded; await page.waitForSelector('.day-cell');
  }
  try {
    await test('legacy load performs no trade writes; edit/save keeps events absent and unknown metadata', async (page, context) => {
      await seed(page);
      await context.addInitScript(() => {
        window.tradeWrites = 0;
        for (const method of ['put', 'add', 'clear', 'delete']) {
          const original = IDBObjectStore.prototype[method];
          IDBObjectStore.prototype[method] = function(...args) { if (this.name === 'trades') tradeWrites++; return original.apply(this, args); };
        }
      });
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => tradeWrites), 0);
      assert.deepEqual(await page.evaluate(() => dbGet('trades', 'legacy')), legacy);
      assert.deepEqual(await page.evaluate(() => getTradeEvents(load()[0])), []);
      await edit(page, 'legacy', '#f-notes', 'edited');
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => Object.hasOwn(load()[0], 'events')), false);
      assert.deepEqual(await page.evaluate(() => load()[0].future), legacy.future);
      assert.equal(await page.evaluate(() => load()[0].notes), 'edited');
    });

    await test('new trade with Entry; all five event types, signed/zero PnL, fractional quantity, chronological order and UI re-save', async page => {
      await page.evaluate(async ({ t, e }) => { await dbPut('trades', withTradeEvent(t, e)); await _initStorageCore(); }, { t: legacy, e: entry });
      const beforePnl = await page.evaluate(() => getPnl(load()[0]));
      const events = [
        { ...entry, type: 'Final Exit', datetime: '2026-10-22T13:00', quantity: 0.4, realizedPnl: 0 },
        { ...entry, type: 'Partial SL', datetime: '2026-10-22T12:00', quantity: 0.1, realizedPnl: -1.25 },
        { ...entry, type: 'Partial TP', datetime: '2026-10-22T11:00', quantity: 0.5, realizedPnl: 2.5 },
        { ...entry, type: 'Add Entry', datetime: '2026-10-22T10:00', quantity: 0.025, realizedPnl: 0 },
      ];
      await page.evaluate(async events => { for (const e of events) await appendTradeEvent('legacy', e); }, events);
      const expected = await page.evaluate(() => getTradeEvents(load()[0]));
      assert.deepEqual(expected.map(e => e.type), ['Entry', 'Add Entry', 'Partial TP', 'Partial SL', 'Final Exit']);
      assert.deepEqual(expected.map(e => e.realizedPnl), [null, 0, 2.5, -1.25, 0]);
      assert.deepEqual(expected.map(e => e.quantity), [2, 0.025, 0.5, 0.1, 0.4]);
      assert.equal(new Set(expected.map(e => e.id)).size, 5);
      assert.equal(await page.evaluate(() => getPnl(load()[0])), beforePnl);
      assert.deepEqual(await page.evaluate(() => load()[0].legs), legacy.legs);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      await edit(page, 'legacy', '#f-notes', 'events unchanged');
      assert.deepEqual(await page.evaluate(() => dbGet('trades', 'legacy').then(t => t.events)), expected);
      await page.evaluate(() => { const copy = getTradeEvents(load()[0]); copy[0].memo = 'do not mutate'; });
      assert.deepEqual(await page.evaluate(() => getTradeEvents(load()[0])), expected);
    });

    await test('crypto fields, original ChatGPT text and image Blob survive append, edit, JSON backup/delete/restore', async page => {
      await page.locator('.header-add-btn').click();
      const text = '銘柄: BTC\n方向: Long\nEntry: 65000\nSize: 0.01\nCVD: 元の解析\n振り返り: 元の振り返り';
      await page.locator('#update-import-text').fill(text); await page.locator('#update-import-analyse').click();
      const image = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 300; c.height = 150;
        c.getContext('2d').fillRect(0, 0, 300, 150); return c.toDataURL().split(',')[1];
      }), 'base64');
      await page.setInputFiles('#screenshot-input', { name: 'test.png', mimeType: 'image/png', buffer: image });
      await page.waitForFunction(() => !screenshotsBusy && screenshotDraft.length === 1);
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
      await page.evaluate(() => closeModal());
      const original = (await snapshot(page)).trades[0];
      assert.equal(Object.hasOwn(original, 'events'), false);
      await page.evaluate(e => appendTradeEvent(load()[0].id, e), entry);
      await page.evaluate(async e => {
        const types = ['Add Entry', 'Partial TP', 'Partial SL', 'Final Exit'];
        for (let i = 0; i < types.length; i++) await appendTradeEvent(load()[0].id, {
          ...e, type: types[i], datetime: `2026-10-22T${10 + i}:00`,
          realizedPnl: [0, 2.5, -1.25, 0][i], quantity: 0.001 * (i + 1),
        });
      }, entry);
      const id = original.id;
      await edit(page, id, '#crypto-review', 'edited review');
      const updated = (await snapshot(page)).trades[0];
      assert.equal(updated.events.length, 5);
      assert.deepEqual(updated.screenshots, original.screenshots);
      assert.deepEqual(updated.cryptoJournal, { ...original.cryptoJournal, review: 'edited review' });
      assert.deepEqual(updated.legs, original.legs);
      const downloaded = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = JSON.parse(await fs.readFile(await (await downloaded).path()));
      assert.deepEqual(backup.stores.trades[0], updated);
      await page.evaluate(id => deleteTrade(id), id); await page.waitForFunction(() => load().length === 0);
      await restore(page, backup); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual((await snapshot(page)).trades[0], updated);
      assert.equal(await page.evaluate(() => load()[0].screenshots[0].blob instanceof Blob), true);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.analysisText), text);
    });

    await test('legacy array/v9 backups without events restore without inventing history', async page => {
      await restore(page, [{ ...legacy, id: 'array' }]);
      await restore(page, { version: 9, trades: [{ ...legacy, id: 'v9' }] });
      assert.deepEqual(await page.evaluate(() => load().map(t => ({ id: t.id, has: Object.hasOwn(t, 'events') })).sort((a,b) => a.id.localeCompare(b.id))),
        [{ id: 'array', has: false }, { id: 'v9', has: false }]);
    });

    await test('invalid events reject before writing; duplicate IDs and malformed backups cannot corrupt existing data', async page => {
      await seed(page);
      const before = await snapshot(page);
      const invalid = [ { ...entry, type: 'Exit' }, { ...entry, datetime: '2026-02-30T10:00' },
        { ...entry, price: 0 }, { ...entry, quantity: -1 }, { ...entry, quantity: '1' },
        { ...entry, realizedPnl: '0' }, { ...entry, realizedPnl: Infinity }, { ...entry, memo: 1 } ];
      for (const e of invalid) {
        assert.equal(await page.evaluate(async e => { try { await appendTradeEvent('legacy', e); return false; } catch { return true; } }, e), true);
      }
      assert.deepEqual(await snapshot(page), before);
      await page.evaluate(e => appendTradeEvent('legacy', { ...e, id: 'fixed' }), entry);
      const valid = await snapshot(page);
      assert.equal(await page.evaluate(async e => { try { await appendTradeEvent('legacy', { ...e, id: 'fixed' }); return false; } catch { return true; } }, entry), true);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await snapshot(page), valid);
      const malformed = { format: 'local-trading-journal', version: 10, databaseVersion: 5, exportedAt: new Date().toISOString(), stores: structuredClone(valid) };
      malformed.stores.trades = [{ ...legacy, id: 'bad', events: [{ ...entry, id: 'bad', quantity: 0 }] }];
      await page.setInputFiles('#restore-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malformed)) });
      await page.waitForFunction(() => document.getElementById('restore-input').value === '');
      assert.deepEqual(await snapshot(page), valid);
    });

    await test('concurrent appends read the latest IndexedDB record and preserve unrelated metadata', async page => {
      await seed(page);
      await page.evaluate(async e => {
        const record = await dbGet('trades', 'legacy');
        await dbPut('trades', { ...record, notes: 'newer in DB' });
        await Promise.all(Array.from({ length: 5 }, (_, i) => appendTradeEvent('legacy', { ...e, id: 'concurrent-' + i })));
      }, entry);
      const record = await page.evaluate(() => dbGet('trades', 'legacy'));
      assert.equal(record.events.length, 5); assert.equal(record.notes, 'newer in DB');
      assert.equal(await page.evaluate(() => load()[0].events.length), 5);
    });

    await test('transaction abort preserves existing events, record, images and in-memory cache', async page => {
      await seed(page);
      await page.evaluate(async e => {
        await appendTradeEvent('legacy', e);
        const t = await dbGet('trades', 'legacy');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 5;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        t.screenshots = [{ id: 'shot', name: 'test.jpg', type: blob.type, size: blob.size, width: 5, height: 5, blob }];
        t.testAnalysis = '原文保持'; await dbPut('trades', t); await _initStorageCore();
      }, entry);
      const before = await snapshot(page);
      assert.equal(await page.evaluate(async e => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) { const result = original.apply(this, args); this.transaction.abort(); return result; };
        try { await appendTradeEvent('legacy', { ...e, type: 'Add Entry' }); return false; } catch { return true; }
        finally { IDBObjectStore.prototype.put = original; }
      }, entry), true);
      assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades), before.trades);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await snapshot(page), before);
    });
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
