// JOURNAL_TEST_URL=http://127.0.0.1:8083 node tests/crypto-journal.cjs
// All writes/deletions happen in isolated browser contexts, never a personal profile.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8083';
  let passed = 0;
  async function test(name, fn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    try {
      await page.goto(base); await page.waitForSelector('.day-cell');
      await fn(page, dialogs);
      assert.deepEqual(errors, []);
      console.log('PASS', name); passed++;
    } finally { await context.close(); }
  }
  async function begin(page, symbol, direction, pnl) {
    await page.locator('.header-add-btn').click();
    await page.locator(`input[name=crypto-asset][value=${symbol}]`).check();
    await page.locator(`input[name=crypto-direction][value=${direction}]`).check();
    await page.locator('#crypto-entry-at').fill('2026-10-22T12:34');
    await page.locator('#crypto-entry-price').fill(symbol === 'BTC' ? '65000.125' : '2500.5');
    await page.locator('#crypto-sl').fill(symbol === 'BTC' ? '64000' : '2600');
    await page.locator('#crypto-tp').fill(symbol === 'BTC' ? '68000' : '2300');
    await page.locator('#crypto-size').fill('0.015');
    if (pnl !== null) {
      await page.locator('#crypto-exit-at').fill('2026-10-22T14:00');
      await page.locator('#crypto-pnl').fill(String(pnl));
    }
  }
  async function save(page, count) {
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(n => load().length === n && document.getElementById('trade-form').style.display === 'none', count);
    await page.evaluate(() => closeModal());
  }
  try {
    await test('BTC Long and ETH Short: create/save/reload/list/detail/edit/backup/delete/restore', async page => {
      for (const [symbol, direction, pnl, strategy] of [['BTC', 'Long', 12.5, 'Breakout'], ['ETH', 'Short', -4.25, 'Absorption']]) {
        await begin(page, symbol, direction, pnl);
        await page.locator(`input[name=crypto-strategy][value=${strategy}]`).check();
        await page.locator('#crypto-reason').fill('出来高増加\n価格の反応を確認 <script>bad()</script>');
        await page.locator('#crypto-review').fill('待てた\n次回も確認する');
        const details = page.locator('#crypto-fields .crypto-details').first();
        await details.locator('summary').click();
        for (const [key, value] of Object.entries({ cvd: '下降、価格は横ばい', oi: '12000 / 増加', fundingRate: '0.01%\nプラス', footprint: '上部でBuy Absorption',
          imbalance: 'Stacked Imbalance 3段', orderBook: '上に厚い売り板', marketProfile: 'VAHを上抜け' })) {
          await page.locator('#crypto-flow-' + key).fill(value);
        }
        await save(page, symbol === 'BTC' ? 1 : 2);
      }
      await page.reload(); await page.waitForFunction(() => load().length === 2);
      const records = await page.evaluate(() => load());
      assert.equal(records[0].cryptoJournal.direction, 'Long');
      assert.equal(records[1].cryptoJournal.direction, 'Short');
      assert.equal(records[1].cryptoJournal.result, 'Loss');
      assert.equal(records[1].cryptoJournal.realizedPnl, -4.25);
      assert.equal(records[0].cryptoJournal.orderFlow.footprint, '上部でBuy Absorption');
      assert.equal(await page.evaluate(() => computeStats(load()).totalPnl), 8.25);
      assert.deepEqual(await page.evaluate(() => load().map(t => getOpenQty(t))), [0, 0]);
      await page.locator('#nav-trades').click();
      assert.ok((await page.locator('#trades-body').innerText()).includes('Breakout'));
      assert.ok((await page.locator('#trades-body').innerText()).includes('Short'));
      for (const trade of records) {
        await page.evaluate(id => editFromTable(id), trade.id);
        await page.waitForFunction(id => editingId === id && document.getElementById('crypto-fields').hidden === false, trade.id);
        assert.equal(await page.locator('#crypto-pnl').inputValue(), String(trade.cryptoJournal.realizedPnl));
        assert.ok((await page.locator('#trade-list').innerText()).includes('エントリー根拠'));
        const flow = page.locator('.crypto-trade-details details').first();
        await flow.locator('summary').click();
        assert.ok((await flow.innerText()).includes('下降、価格は横ばい'));
        assert.equal(await page.locator('#crypto-flow-footprint').inputValue(), '上部でBuy Absorption');
        await page.locator('#crypto-review').fill('編集済み\n振り返り');
        await page.locator('#crypto-size').fill('0.02');
        await save(page, 2);
      }
      await page.locator('#nav-cal').click();
      await page.evaluate(() => { curMonth = new Date(2026, 9, 1); renderCalendar(); });
      const day = page.locator('.day-cell[onclick="openDay(\'2026-10-22\')"]');
      assert.ok((await day.innerText()).includes('2 close'));
      await day.click();
      assert.ok((await page.locator('#trade-list').innerText()).includes('編集済み'));
      await page.evaluate(() => closeModal());
      const before = await page.evaluate(() => load());
      const dl = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = JSON.parse(await fs.readFile(await (await dl).path(), 'utf8'));
      assert.deepEqual(backup.stores.trades, before);
      assert.equal(backup.stores.trades[1].cryptoJournal.positionSize, 0.02);
      for (const t of before) await page.evaluate(id => deleteTrade(id), t.id);
      await page.waitForFunction(() => load().length === 0);
      const reloaded = page.waitForEvent('load');
      await page.setInputFiles('#restore-input', { name: 'crypto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
      await reloaded; await page.waitForFunction(() => load().length === 2);
      assert.deepEqual(await page.evaluate(() => load()), before);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });

    await test('pending, independent result/PnL, SOL/Other and validation', async (page, dialogs) => {
      await begin(page, 'SOL', 'Short', null);
      await page.locator('input[name=crypto-strategy][value="その他"]').check();
      await page.locator('#crypto-strategy-other').fill('独自の反転');
      await save(page, 1);
      assert.deepEqual(await page.evaluate(() => ({ pnl: load()[0].cryptoJournal.realizedPnl, open: getOpenQty(load()[0]), byDate: getRealizationsByDate(load()[0]) })),
        { pnl: null, open: 0.015, byDate: {} });
      await begin(page, 'BTC', 'Long', 3);
      await page.locator('input[name=crypto-asset][value="その他"]').check();
      await page.locator('#crypto-symbol-other').fill('XRP');
      await page.locator('input[name=crypto-result][value=Loss]').check();
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '3');
      await page.locator('input[name=crypto-result][value=BE]').check();
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '3');
      await page.locator('#crypto-size').fill('0');
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      assert.equal(await page.evaluate(() => load().length), 1);
      assert.ok(dialogs.some(m => m.includes('入力内容を確認')));
      await page.locator('#crypto-size').fill('1'); await save(page, 2);
      assert.equal(await page.evaluate(() => load()[1].cryptoJournal.result), 'BE');
      assert.equal(await page.evaluate(() => getOpenQty(load()[1])), 0);
      const invalid = await page.evaluate(() => {
        const t = structuredClone(load()[1]); t.cryptoJournal.entryPrice = -1;
        try { parseJournalBackup({ version: 9, trades: [t] }); return false; } catch { return true; }
      });
      assert.equal(invalid, true);
    });

    await test('legacy editing keeps unknown fields and creates no crypto metadata', async page => {
      await page.evaluate(async () => {
        await save([{ id: 'legacy', date: todayStr(), symbol: 'OLD', type: 'stock', notes: 'old', customFutureField: { keep: true },
          tags: [], mistakes: [], rules: [], legs: [{ id: 'leg', action: 'buy', date: nowDatetime(), price: 10, quantity: 1, commission: 0, fees: 0 }] }]);
      });
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      await page.evaluate(() => editFromTable('legacy'));
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      assert.equal(await page.locator('#crypto-fields').isVisible(), false);
      await page.locator('#f-notes').fill('updated'); await save(page, 1);
      const t = await page.evaluate(() => load()[0]);
      assert.equal(t.notes, 'updated'); assert.deepEqual(t.customFutureField, { keep: true }); assert.equal(t.cryptoJournal, undefined);
      assert.equal(await page.evaluate(() => getPnl(load()[0])), 0);
    });
    await test('cross-month trade realizes only on exit day, including daily and weekly details', async page => {
      await begin(page, 'BTC', 'Long', 12.5);
      await page.locator('#crypto-entry-at').fill('2026-10-31T23:30');
      await page.locator('#crypto-exit-at').fill('2026-11-02T01:15');
      await save(page, 1);
      assert.deepEqual(await page.evaluate(() => getRealizationsByDate(load()[0])), { '2026-11-02': 12.5 });
      assert.deepEqual(Object.keys(await page.evaluate(() => getRiskByDate(load()[0]))), ['2026-11-02']);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      await page.evaluate(() => { curMonth = new Date(2026, 9, 1); renderCalendar(); });
      assert.equal(await page.locator('#monthly-pnl').evaluate(el => el.firstChild.textContent.trim()), '$0.00');
      await page.evaluate(() => openDay('2026-10-31'));
      assert.equal((await page.locator('#day-summary .ds-value').first().innerText()).trim(), '$0.00');
      await page.evaluate(() => { closeModal(); openWeek('2026-10-25', '2026-10-31'); });
      assert.equal((await page.locator('#day-summary .ds-value').first().innerText()).trim(), '$0.00');
      await page.evaluate(() => { closeModal(); curMonth = new Date(2026, 10, 1); renderCalendar(); });
      assert.equal(await page.locator('#monthly-pnl').evaluate(el => el.firstChild.textContent.trim()), '$12.50');
      await page.locator('.day-cell[onclick="openDay(\'2026-11-02\')"]').click();
      assert.ok((await page.locator('#trade-list').innerText()).includes('BTC'));
      assert.equal((await page.locator('#day-summary .ds-value').first().innerText()).trim(), '$12.50');
      await page.evaluate(() => { closeModal(); openWeek('2026-11-01', '2026-11-07'); });
      assert.equal((await page.locator('#day-summary .ds-value').first().innerText()).trim(), '$12.50');
    });

    await test('pending amounts stay saved but are excluded from daily realized PnL', async page => {
      await begin(page, 'ETH', 'Short', null);
      await page.locator('#crypto-pnl').fill('9.25');
      await save(page, 1);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.realizedPnl), 9.25);
      assert.deepEqual(await page.evaluate(() => getRealizationsByDate(load()[0])), {});
      assert.equal(await page.evaluate(() => computeStats(load()).totalPnl), 0);
      assert.equal(await page.evaluate(() => getOpenQty(load()[0])), 0.015);
      await page.evaluate(() => openDay('2026-10-22'));
      assert.equal((await page.locator('#day-summary .ds-value').first().innerText()).trim(), '$0.00');
    });

    await test('BE with a small negative PnL survives editing, backup and restore', async page => {
      await begin(page, 'BTC', 'Long', -0.35);
      await page.locator('input[name=crypto-result][value=BE]').check();
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '-0.35');
      await page.locator('#crypto-pnl').fill('-0.45');
      assert.equal(await page.locator('input[name=crypto-result][value=BE]').isChecked(), true);
      await save(page, 1);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      const original = await page.evaluate(() => load()[0]);
      assert.equal(original.cryptoJournal.result, 'BE');
      assert.equal(original.cryptoJournal.realizedPnl, -0.45);
      assert.equal(await page.evaluate(() => computeStats(load()).losses), 0);
      assert.equal(await page.evaluate(() => computeStats(load()).totalPnl), -0.45);
      await page.evaluate(() => { curMonth = new Date(2026, 9, 1); renderCalendar(); });
      assert.equal(await page.locator('.day-cell[onclick="openDay(\'2026-10-22\')"] .day-pnl').evaluate(el => el.firstChild.textContent.trim()), '-$0.45');
      const dl = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = await fs.readFile(await (await dl).path());
      await page.evaluate(id => deleteTrade(id), original.id);
      await page.waitForFunction(() => load().length === 0);
      const loaded = page.waitForEvent('load');
      await page.setInputFiles('#restore-input', { name: 'be.json', mimeType: 'application/json', buffer: backup });
      await loaded; await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await page.evaluate(() => load()[0]), original);
    });

    await test('manual result overrides Win and survives later PnL edits; zero is not forced to BE', async page => {
      await begin(page, 'BTC', 'Long', 50);
      assert.equal(await page.locator('input[name=crypto-result][value=Win]').isChecked(), true);
      await page.locator('input[name=crypto-result][value=Loss]').check();
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '50');
      await page.locator('#crypto-pnl').fill('60');
      assert.equal(await page.locator('input[name=crypto-result][value=Loss]').isChecked(), true);
      await save(page, 1);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      await page.evaluate(() => editFromTable(load()[0].id));
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      await page.locator('#crypto-pnl').fill('70');
      assert.equal(await page.locator('input[name=crypto-result][value=Loss]').isChecked(), true);
      assert.equal(await page.evaluate(() => computeStats(load()).losses), 1);
      await page.locator('#crypto-result-auto').click();
      assert.equal(await page.locator('input[name=crypto-result][value=Win]').isChecked(), true);
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '70');
      await save(page, 1);
      await begin(page, 'ETH', 'Short', 0);
      assert.equal(await page.locator('input[name=crypto-result]:checked').count(), 0);
      await page.locator('input[name=crypto-result][value=Win]').check();
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '0');
      await save(page, 2);
      assert.equal(await page.evaluate(() => load()[1].cryptoJournal.result), 'Win');
    });

    await test('old crypto records without exit datetime remain intact and editable', async page => {
      await begin(page, 'BTC', 'Long', 25); await save(page, 1);
      const original = await page.evaluate(async () => {
        const t = structuredClone(load()[0]);
        delete t.cryptoJournal.exitAt; delete t.cryptoJournal.resultMode;
        await dbPut('trades', t); return t;
      });
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await page.evaluate(() => load()[0]), original);
      assert.deepEqual(await page.evaluate(() => getRealizationsByDate(load()[0])), {});
      await page.evaluate(() => editFromTable(load()[0].id));
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      assert.equal(await page.locator('#crypto-exit-at').inputValue(), '');
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '25');
      await page.locator('#crypto-review').fill('互換性確認');
      await save(page, 1);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.realizedPnl), 25);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.exitAt), '');
      await page.evaluate(() => editFromTable(load()[0].id));
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      await page.locator('#crypto-exit-at').fill('2026-10-23T09:00'); await save(page, 1);
      assert.deepEqual(await page.evaluate(() => getRealizationsByDate(load()[0])), { '2026-10-23': 25 });
    });

    for (const width of [320, 412, 915]) {
      await test(`crypto form and expanded order-flow fit ${width}px viewport`, async page => {
        await page.setViewportSize({ width, height: 844 });
        await begin(page, 'ETH', 'Short', -0.5);
        await page.locator('#crypto-fields .crypto-details summary').first().click();
        await page.locator('#crypto-flow-cvd').fill('下降、価格は横ばい\n文章と数値: 123.45');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const name of ['crypto-asset', 'crypto-direction', 'crypto-result', 'crypto-strategy']) {
          for (const span of await page.locator(`input[name="${name}"] + span`).all()) {
            const box = await span.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
          }
        }
        const fields = await page.locator('#crypto-fields .crypto-field:visible').all();
        let previous = -Infinity;
        for (const field of fields) { const box = await field.boundingBox(); assert.ok(box.y >= previous); previous = box.y + box.height; }
      });
    }
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
