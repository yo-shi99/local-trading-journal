// Start a static server, then run JOURNAL_TEST_URL=http://127.0.0.1:8081 node tests/journal-mobile.cjs
// Uses isolated browser contexts only. BASELINE=1 tests the original desktop workflow.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8081';
const baseline = process.env.BASELINE === '1';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let passed = 0;
  async function test(name, width, fn) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    try {
      await page.goto(base); await page.waitForSelector('.day-cell');
      await fn(page);
      assert.deepEqual(errors, []);
      console.log('PASS', name); passed++;
    } finally { await context.close(); }
  }
  async function noOverflow(page) {
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth,
      modal: document.querySelector('#day-overlay.open .modal')?.getBoundingClientRect().right }));
    assert.ok(dimensions.page <= dimensions.viewport + 1, JSON.stringify(dimensions));
    if (dimensions.modal) assert.ok(dimensions.modal <= dimensions.viewport + 1, JSON.stringify(dimensions));
  }
  try {
    await test('create, reload, tags/mistakes/rules, list, edit, calendar, backup/restore, delete', baseline ? 1280 : 390, async page => {
      if (baseline) await page.evaluate(() => openAddGlobal());
      else await page.locator('.header-add-btn').click();
      await page.locator('#f-sym').fill('BTCUSDT');
      await page.locator('.leg-add-btn.buy').click();
      const row = page.locator('.leg-row').first();
      await row.locator('input[type=number]').nth(0).fill('100');
      await row.locator('input[type=number]').nth(1).fill('2');
      await page.locator('#f-notes').fill('mobile-test');
      for (const [field, fn, checkbox] of [['f-new-tag', 'addTagOnTheFly', '.tag-check'],
        ['f-new-mistake', 'addMistakeOnTheFly', '.mistake-check'], ['f-new-rule', 'addRuleOnTheFly', '.rule-check']]) {
        await page.locator('#' + field).fill('テスト項目');
        await page.locator(`button[onclick="${fn}()"]`).click();
        if (!(await page.locator(checkbox).first().isChecked())) await page.locator(checkbox).first().check();
      }
      if (!baseline) await noOverflow(page);
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.waitForFunction(() => load().length === 1);
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await page.evaluate(() => [load()[0].tags.length, load()[0].mistakes.length, load()[0].rules.length]), [1, 1, 1]);
      await page.locator('#nav-trades').click();
      if (!baseline) await noOverflow(page);
      await page.locator('#trades-body button[title=Edit]').click();
      await page.locator('#f-notes').fill('edited');
      await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => load()[0].notes === 'edited');
      await page.locator('#nav-cal').click();
      await page.locator('.day-cell').filter({ has: page.locator('.day-count, .day-open-count') }).first().click();
      assert.ok((await page.locator('#trade-list').innerText()).includes('BTCUSDT'));
      await page.evaluate(() => closeModal());
      await page.locator('.util-dropdown-toggle').click();
      const downloaded = page.waitForEvent('download');
      await page.locator('.backup-btn').click();
      const file = await downloaded;
      const backup = await fs.readFile(await file.path());
      assert.equal(JSON.parse(backup).stores.trades[0].notes, 'edited');
      await page.locator('#nav-trades').click();
      await page.locator('#trades-body button[title=Delete]').click();
      await page.waitForFunction(() => load().length === 0);
      const reloaded = page.waitForEvent('load');
      await page.locator('.util-dropdown-toggle').click();
      const chooser = page.waitForEvent('filechooser');
      await page.locator('.restore-btn').click();
      await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
      await reloaded; await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => load()[0].notes), 'edited');
    });
    if (!baseline) {
      for (const width of [320, 360, 390, 412, 768, 915]) {
        await test(`mobile layout, form labels, popovers, tap targets at ${width}px`, width, async page => {
          await noOverflow(page);
          for (const sel of ['.header-add-btn', '.util-dropdown-toggle', '#nav-cal', '#nav-trades']) {
            const rect = await page.locator(sel).boundingBox(); assert.ok(rect.height >= 44 && rect.width >= 44, sel);
          }
          await page.locator('#gf-dr-btn').click(); await noOverflow(page);
          const bounds = await page.locator('#gf-dr-popover').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds));
          await page.locator('#gf-dr-popover .gf-dr-preset-btn').first().click();
          await page.locator('.header-add-btn').click();
          await page.locator('.leg-add-btn.buy').click();
          await page.getByLabel('価格 ($)', { exact: true }).fill('100000');
          await page.getByLabel('数量', { exact: true }).fill('0.001');
          await page.locator('button[onclick="addProfitTarget()"]').click();
          await page.locator('button[onclick="addStopLoss()"]').click();
          await page.locator('#f-profit-targets-body input').first().fill('120000');
          await page.locator('#f-stop-loss-body input').first().fill('90000');
          await noOverflow(page);
        });
      }
      await test('hidden routes cannot open; retained data and original mode remain available', 390, async page => {
        await page.evaluate(async () => {
          await dbPut('trades', { id: 'old-option', symbol: 'OLD', type: 'option', optionType: 'put', strikePrice: 100,
            expiryDate: '2027-01-01', date: todayStr(), tags: [], rules: [], mistakes: [], notes: 'preserve',
            profitTargets: [{ price: 3, qty: 1 }], stopLoss: [{ price: 1, qty: 1 }],
            legs: [{ id: 'old-leg', action: 'buy', price: 2, quantity: 1, date: nowDatetime(), commission: 0, fees: 0 }] });
          await dbPut('bankingEntries', { id: 'bank-old', note: 'preserve' });
          await dbPut('ideas', { id: 'idea-old', symbol: 'OLD' });
          await dbPut('llmTradePlans', { id: 'llm-old', cardData: { symbol: 'OLD' } });
        });
        const before = await page.evaluate(() => dbSnapshot());
        for (const name of ['plan', 'reports', 'banking', 'signal-intel', 'bulk', 'llm', 'unknown']) {
          await page.evaluate(name => { switchView(name); openBulkTradesView(); }, name);
          assert.equal(await page.evaluate(() => state.view), 'calendar');
          for (const sel of ['#view-plan', '#view-reports', '#view-banking', '#view-signal-intel', '#view-bulk', '#add-dropdown-menu'])
            assert.equal(await page.locator(sel).isVisible(), false, sel);
        }
        for (const hash of ['#banking', '#signal-intel', '#plan', '#bulk', '#reports']) {
          await page.goto(base + '/?view=banking' + hash); await page.waitForSelector('.day-cell');
          assert.equal(await page.evaluate(() => state.view), 'calendar');
        }
        await page.locator('#nav-trades').click();
        await page.locator('#trades-body button[title=Edit]').click();
        assert.equal(await page.locator('#opt-fields').isVisible(), false);
        await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
        await page.evaluate(() => closeModal());
        const after = await page.evaluate(() => dbSnapshot());
        for (const name of ['trades', 'bankingEntries', 'ideas', 'llmTradePlans']) assert.deepEqual(after[name], before[name], name);
        // Reversible presentation switch; it does not write configuration or data.
        await page.evaluate(() => { document.body.classList.remove('journal-simple'); switchView('banking'); });
        assert.equal(await page.locator('#nav-plan').isVisible(), true);
        assert.equal(await page.locator('#nav-reports').isVisible(), true);
        assert.equal(await page.locator('#view-banking').isVisible(), true);
      });
    }
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
