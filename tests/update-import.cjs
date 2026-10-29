const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8088';
const text = (type = 'Partial TP', qty = '.005', pnl = '7.05 USDT', date = '2026-10-27 10:15') => `更新種別: ${type}\n日時: ${date}\n価格: 79000\n数量: ${qty} BTC\n実現損益: ${pnl}\n理由: 更新理由\nメモ: 更新メモ`;
const actual = `更新種別: Final Exit

決済日時: 2026-10-26 17:41:04
Exit価格: 80339.3
決済数量: 0.01 BTC
実現損益: -3.1737 USDT
結果: Loss
Exit理由: SL到達
SLトリガー価格: 80313
ROE: -3.96%

振り返り: 80,313のSLに到達して全決済。実際の平均決済価格は80,339.3となった。`;
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
  async function image(page) {
    return { name: 'update.png', mimeType: 'image/png', buffer: Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 160; c.getContext('2d').fillRect(0, 0, 320, 160); return c.toDataURL().split(',')[1];
    }), 'base64') };
  }
  async function create(page, withImage = false) {
    await page.locator('.header-add-btn').click(); await page.waitForSelector('#crypto-entry-price', { state: 'visible' });
    assert.equal(await page.locator('#update-import').isVisible(), true);
    await page.locator('#update-import-text').fill('銘柄: BTC\n方向: Short\nEntry: 80000\nSize: 0.01\nCVD: 元のCVD\nOI: 元のOI\nFunding: +0.01%\nエントリー根拠: 元の根拠\n振り返り: Entry時メモ');
    await page.locator('#update-import-analyse').click(); await page.locator('#crypto-entry-at').fill('2026-10-26T16:00');
    if (withImage) { await page.setInputFiles('#screenshot-input', await image(page)); await page.waitForFunction(() => !screenshotsBusy && screenshotDraft.length === 1); }
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(() => closeModal()); return page.evaluate(() => load()[0].id);
  }
  async function edit(page, id) { await page.evaluate(()=>{if(hasTradeEditorNavigation())cancelForm();}); await page.waitForFunction(()=>!tradeEditorHistoryClosing&&!detailHistoryClosing); await page.evaluate(id => (openTradeDetail(id), editTradeEntry('fields')), id); await page.waitForFunction(() => editingId !== null && document.getElementById('trade-form').style.display === 'block'); }
  async function analyse(page, raw) {
    await page.locator('#update-import-text').fill(raw); await page.locator('#update-import-analyse').click();
    await page.waitForFunction(() => document.getElementById('update-import-status').textContent !== '解析しています…');
  }
  async function confirm(page, count) {
    assert.equal(await page.locator('#update-import-confirm').isEnabled(), true);
    await page.locator('#update-import-confirm').click();
    await page.waitForFunction(count => load()[0].events?.length === count && document.getElementById('trade-form').style.display === 'none', count);
    await page.evaluate(() => openTradeDetail(load()[0].id));
  }
  async function snapshot(page) { return page.evaluate(async () => screenshotsForBackup(await dbSnapshot())); }
  async function commit(page, id, raw, images = []) {
    return page.evaluate(async ({ id, raw, images }) => {
      const t = await dbGet('trades', id), p = previewUpdateImport(t, raw);
      return commitUpdateImport({ tradeId: id, rawText: raw, expectedRevision: p.revision, images });
    }, { id, raw, images });
  }
  try {
    await test('paste and preview never save; target is shown; Add Entry confirms and immediately displays event/state', async page => {
      const id = await create(page), before = await snapshot(page); await edit(page, id);
      assert.ok((await page.locator('#update-import-target').innerText()).includes('BTC / Short'));
      const raw = text('追加エントリー', '.01', 'null');
      await page.locator('#update-import-text').evaluate((el, raw) => {
        const data = new DataTransfer(); data.setData('text/plain', raw); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
        el.value = raw; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      }, raw);
      assert.deepEqual(await snapshot(page), before); assert.equal(await page.locator('#update-import-confirm').isEnabled(), false);
      await page.locator('#update-import-analyse').click(); await page.waitForFunction(() => updateImportPending !== null);
      assert.deepEqual(await snapshot(page), before); assert.ok((await page.locator('#update-import-preview').innerText()).includes('79500'));
      await confirm(page, 1);
      const s = await page.evaluate(() => getTradeState(load()[0])); assert.equal(s.totalEntryQuantity, .02); assert.equal(s.averageEntryPrice, 79500); assert.equal(s.remainingQuantity, .02);
      assert.ok((await page.locator('.trade-event-card').innerText()).includes('Add Entry'));
      assert.equal(await page.evaluate(() => load()[0].events[0].rawText), raw);
    });

    await test('UI chain Add Entry / Partial TP / Partial SL / Final Exit closes with PnL +9', async page => {
      const id = await create(page);
      const steps = [['Add Entry', '.01', 'null'], ['Partial TP', '.005', '10'], ['Partial SL', '.005', '-4'], ['Final Exit', '.01', '3']];
      for (let i = 0; i < steps.length; i++) {
        await edit(page, id); const [type, qty, pnl] = steps[i]; await analyse(page, text(type, qty, pnl, `2026-10-27 ${10 + i}:15`)); await confirm(page, i + 1);
      }
      const s = await page.evaluate(() => getTradeState(load()[0])); assert.equal(s.status, 'Closed'); assert.equal(s.realizedPnl, 9);
      await page.reload(); await page.waitForFunction(() => load().length === 1); assert.deepEqual(await page.evaluate(() => getTradeState(load()[0])), s);
    });

    await test('required real Final Exit stores seconds, raw text, Loss/review, image; protects all Entry data and unsaved changes', async page => {
      const id = await create(page, true), before = (await snapshot(page)).trades[0]; await edit(page, id);
      await page.locator('#crypto-reason').fill('保存してはいけない根拠'); await page.locator('#update-import-text').fill('上書きしてはいけない原文');
      await page.evaluate(() => { screenshotDraft = []; renderScreenshotDraft(); });
      await page.setInputFiles('#update-import-input', await image(page)); await page.waitForFunction(() => !updateImportImagesBusy && updateImportImages.length === 1);
      await analyse(page, actual);
      assert.equal(await page.locator('#update-import-category').inputValue(), 'Exit');
      const preview = await page.locator('#update-import-preview').innerText(); assert.ok(preview.includes('SLトリガー価格')); assert.ok(preview.includes('ROE: -3.96%'));
      await confirm(page, 1); const after = (await snapshot(page)).trades[0];
      const { events, exitUpdate, screenshots, ...rest } = after, { screenshots: oldImages, ...oldRest } = before;
      assert.deepEqual(rest, oldRest); assert.deepEqual(screenshots.slice(0, oldImages.length), oldImages); assert.equal(screenshots[1].category, 'Exit');
      assert.equal(events[0].datetime, '2026-10-26T17:41:04'); assert.equal(events[0].price, 80339.3); assert.equal(events[0].quantity, .01); assert.equal(events[0].realizedPnl, -3.1737);
      assert.equal(events[0].reason, 'SL到達'); assert.equal(events[0].rawText, actual); assert.equal(exitUpdate.result, 'Loss'); assert.ok(exitUpdate.review.includes('80,313'));
      assert.equal(await page.evaluate(() => getTradeState(load()[0]).status), 'Closed');
      await page.locator('.trade-event-card details summary').click(); assert.ok((await page.locator('.trade-event-card details').innerText()).includes('ROE: -3.96%'));
    });

    await test('PnL zero, null and unexpected sign are preserved', async page => {
      const id = await create(page);
      await commit(page, id, text('Partial SL', '.002', '0', '2026-10-27 10:00'));
      await commit(page, id, text('Partial TP', '.002', 'null', '2026-10-27 11:00'));
      await commit(page, id, text('Partial SL', '.002', '5', '2026-10-27 12:00'));
      assert.deepEqual(await page.evaluate(() => load()[0].events.map(e => e.realizedPnl)), [0, null, 5]);
      assert.equal(await page.evaluate(() => getTradeState(load()[0]).realizedPnl), 5);
    });

    await test('excess, Final Exit mismatch and required omissions block; original text/data remain', async page => {
      const id = await create(page), before = await snapshot(page); await edit(page, id);
      for (const raw of [text('Partial TP', '.02'), text('Final Exit', '.005'), ...['日時', '価格', '数量'].map(label => text().split('\n').filter(line => !line.startsWith(label + ':')).join('\n'))]) {
        await analyse(page, raw); assert.equal(await page.locator('#update-import-confirm').isEnabled(), false);
        assert.ok((await page.locator('#update-import-status').innerText()).length > 5); assert.equal(await page.locator('#update-import-text').inputValue(), raw);
        assert.deepEqual(await snapshot(page), before);
      }
    });

    await test('unknown metrics and malicious markup retained safely; known event still saves', async page => {
      const id = await create(page); await edit(page, id);
      const raw = text() + '\n未知指標: <img src=x onerror=alert(1)>\nROE: -3.96%';
      await analyse(page, raw); assert.equal(await page.locator('#update-import-preview img').count(), 0); await confirm(page, 1);
      assert.equal(await page.evaluate(() => load()[0].events[0].rawText), raw);
      await page.locator('.trade-event-card details summary').click(); assert.equal(await page.locator('.trade-event-card details img').count(), 0);
    });

    await test('cancel discards pending update and raw text without DB writes', async page => {
      const id = await create(page), before = await snapshot(page); await edit(page, id); await analyse(page, text());
      await page.locator('#update-import-cancel').click(); assert.equal(await page.locator('#update-import-confirm').isEnabled(), false);
      assert.equal(await page.locator('#update-import-text').inputValue(), ''); assert.equal(await page.locator('#trade-form').isVisible(), false); assert.deepEqual(await snapshot(page), before);
    });

    await test('duplicate tuple warns and cannot save again', async page => {
      const id = await create(page); await edit(page, id); await analyse(page, text()); await confirm(page, 1);
      const before = await snapshot(page); await edit(page, id); await analyse(page, text());
      assert.equal(await page.locator('#update-import-confirm').isEnabled(), false); assert.ok((await page.locator('#update-import-status').innerText()).includes('重複'));
      assert.deepEqual(await snapshot(page), before);
    });

    await test('stale preview after another Entry save blocks, preserving the latest Entry', async page => {
      const id = await create(page); await edit(page, id); await analyse(page, actual);
      await page.evaluate(async id => { const t = await dbGet('trades', id); t.cryptoJournal.entryReason = '最新の根拠'; await dbPut('trades', t); }, id);
      const before = await snapshot(page); await page.locator('#update-import-confirm').click();
      await page.waitForFunction(() => document.getElementById('update-import-status').textContent.includes('再解析'));
      assert.deepEqual(await snapshot(page), before); assert.equal(await page.locator('#update-import-text').inputValue(), actual);
    });

    await test('concurrent duplicate import commits only one event and one Exit patch', async page => {
      const id = await create(page);
      const results = await page.evaluate(async ({ id, raw }) => {
        const t = await dbGet('trades', id), p = previewUpdateImport(t, raw), options = { tradeId: id, rawText: raw, expectedRevision: p.revision };
        return (await Promise.allSettled([commitUpdateImport(options), commitUpdateImport(options)])).map(r => r.status);
      }, { id, raw: actual });
      assert.deepEqual(results.sort(), ['fulfilled', 'rejected']); assert.equal(await page.evaluate(() => load()[0].events.length), 1);
      assert.equal(await page.evaluate(() => load()[0].exitUpdate.result), 'Loss');
    });

    await test('atomic failure rolls back event, raw text, review and new image; Entry/cache remain intact', async page => {
      const id = await create(page, true), before = await snapshot(page);
      const failed = await page.evaluate(async ({ id, raw }) => {
        const t = await dbGet('trades', id), p = previewUpdateImport(t, raw), image = { ...t.screenshots[0], id: 'new-exit', category: 'Exit' };
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) { const r = original.apply(this, args); this.transaction.abort(); return r; };
        try { await commitUpdateImport({ tradeId: id, rawText: raw, expectedRevision: p.revision, images: [image] }); return false; }
        catch { return true; } finally { IDBObjectStore.prototype.put = original; }
      }, { id, raw: actual });
      assert.equal(failed, true); assert.deepEqual(await page.evaluate(async () => (await screenshotsForBackup({ trades: load() })).trades), before.trades);
      await page.reload(); await page.waitForFunction(() => load().length === 1); assert.deepEqual(await snapshot(page), before);
    });

    await test('backup/delete/restore preserves seconds, raw text, event, Exit metadata, categories and Blob bytes', async page => {
      const id = await create(page, true); await edit(page, id);
      await page.setInputFiles('#update-import-input', await image(page)); await page.waitForFunction(() => !updateImportImagesBusy && updateImportImages.length === 1);
      await page.locator('#update-import-category').selectOption('Other'); await analyse(page, actual); await confirm(page, 1);
      const expected = (await snapshot(page)).trades[0]; assert.equal(expected.screenshots[1].category, 'Other');
      await page.evaluate(() => closeModal()); const dl = page.waitForEvent('download'); await page.evaluate(() => backupData()); const backup = await fs.readFile(await (await dl).path());
      assert.equal(JSON.parse(backup).version, 10); assert.equal(JSON.parse(backup).databaseVersion, 5);
      await page.evaluate(id => deleteTrade(id), id); await page.waitForFunction(() => load().length === 0);
      const loaded = page.waitForEvent('load'); await page.setInputFiles('#restore-input', { name: 'update.json', mimeType: 'application/json', buffer: backup });
      await loaded; await page.waitForFunction(() => load().length === 1); assert.deepEqual((await snapshot(page)).trades[0], expected);
      assert.equal(await page.evaluate(() => load()[0].screenshots.every(i => i.blob instanceof Blob)), true);
    });

    await test('changing open target invalidates old preview and never searches or updates another trade', async page => {
      const id = await create(page);
      await page.evaluate(async () => { const t = structuredClone(load()[0]); t.id = 'other'; t.symbol = 'ETH'; await dbPut('trades', t); await _initStorageCore(); });
      await edit(page, id); await analyse(page, text()); const before = await snapshot(page);
      await page.evaluate(()=>cancelForm()); await page.waitForFunction(()=>!tradeEditorHistoryClosing); await edit(page, 'other'); assert.equal(await page.locator('#update-import-text').inputValue(), ''); assert.equal(await page.locator('#update-import-confirm').isEnabled(), false);
      await page.evaluate(() => confirmUpdateImport()); assert.deepEqual(await snapshot(page), before);
      assert.ok((await page.locator('#update-import-target').innerText()).includes('ETH'));
    });

    await test('editing raw text after preview invalidates confirmation', async page => {
      const id = await create(page); await edit(page, id); await analyse(page, text());
      await page.locator('#update-import-text').fill(actual); assert.equal(await page.locator('#update-import-confirm').isEnabled(), false);
      assert.equal(await page.evaluate(() => load()[0].events), undefined);
    });

    await test('late screenshot compression cannot attach to another trade', async page => {
      const id = await create(page); await edit(page, id);
      await page.evaluate(() => { const original = compressScreenshot; window.releaseImportImage = null; compressScreenshot = file => new Promise(resolve => { window.releaseImportImage = async () => resolve(await original(file)); }); });
      await page.setInputFiles('#update-import-input', await image(page)); await page.waitForFunction(() => updateImportImagesBusy && !!window.releaseImportImage);
      await page.locator('#update-import-cancel').click(); await page.evaluate(() => window.releaseImportImage());
      assert.equal(await page.evaluate(() => updateImportImages.length), 0); assert.equal(await page.evaluate(() => load()[0].screenshots.length), 0);
    });
    for (const width of [320, 412, 915]) await test(`Update Import preview fits ${width}px`, async page => {
      const id = await create(page); await page.setViewportSize({ width, height: 844 }); await edit(page, id); await analyse(page, actual);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok((await page.locator('#update-import-text').boundingBox()).height >= 210);
      assert.ok((await page.locator('#update-import-confirm').boundingBox()).height >= 48);
    });
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
