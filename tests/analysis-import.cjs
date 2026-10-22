// JOURNAL_TEST_URL=http://127.0.0.1:8088 node tests/analysis-import.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const full = `銘柄: BTC
方向: Short
エントリー日時: 2026/10/22 10:30
決済日時: 2026-10-23T11:45
エントリー価格: 65,000.25 USDT
SL: 66000
TP: 63000
ポジションサイズ: 0.025 BTC
実現損益: -0.35
結果: BE
戦略: Breakout
CVD: 下降、価格は横ばい
OI: 上昇
Funding: +0.01%
Footprint: 上部でBuy Absorption
Imbalance / Stacked Imbalance: Sell Imbalanceあり
Order Book / Heatmap: 下のBidが薄い
TPO / Market Profile: Poor Lowあり
エントリー根拠: レンジ下抜け＋CVD/OI確認
出来高の増加も確認
振り返り: エントリーがやや遅かった
次回はリテストを待つ`;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8088';
  let passed = 0;
  async function test(name, fn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [], dialogs = [], external = [];
    const accept = async d => { dialogs.push(d.message()); await d.accept(); };
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', accept);
    page.on('request', request => { if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url()); });
    try {
      await page.goto(base); await page.waitForSelector('.day-cell');
      await page.locator('.header-add-btn').click();
      await fn(page, dialogs, accept);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      console.log('PASS', name); passed++;
    } finally { await context.close(); }
  }
  async function apply(page, text) {
    await page.locator('#crypto-analysis-text').fill(text);
    await page.locator('#analysis-apply').click();
  }
  async function save(page) {
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(() => closeModal());
  }
  try {
    await test('all fields, multiline, independent BE/PnL, manual edits/save/reload/edit/backup/restore', async page => {
      await apply(page, full);
      assert.equal(await page.locator('#crypto-entry-at').inputValue(), '2026-10-22T10:30');
      assert.equal(await page.locator('#crypto-entry-price').inputValue(), '65000.25');
      assert.equal(await page.locator('#crypto-exit-at').inputValue(), '2026-10-23T11:45');
      assert.equal(await page.locator('#crypto-sl').inputValue(), '66000');
      assert.equal(await page.locator('#crypto-tp').inputValue(), '63000');
      assert.equal(await page.locator('#crypto-size').inputValue(), '0.025');
      assert.equal(await page.locator('input[name=crypto-direction][value=Short]').isChecked(), true);
      assert.equal(await page.locator('input[name=crypto-result][value=BE]').isChecked(), true);
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '-0.35');
      assert.equal(await page.locator('#crypto-flow-fundingRate').inputValue(), '+0.01%');
      assert.equal(await page.locator('#crypto-flow-orderBook').inputValue(), '下のBidが薄い');
      assert.equal(await page.locator('#crypto-flow-marketProfile').inputValue(), 'Poor Lowあり');
      assert.equal(await page.locator('#crypto-reason').inputValue(), 'レンジ下抜け＋CVD/OI確認\n出来高の増加も確認');
      await page.locator('#crypto-entry-price').fill('64999');
      await page.locator('#crypto-pnl').fill('-0.5');
      assert.equal(await page.locator('input[name=crypto-result][value=BE]').isChecked(), true);
      await page.locator('#crypto-review').fill('手動修正済み');
      await save(page); await page.reload(); await page.waitForFunction(() => load().length === 1);
      const record = await page.evaluate(() => load()[0]);
      assert.equal(record.cryptoJournal.analysisText, full);
      assert.equal(record.cryptoJournal.entryPrice, 64999);
      assert.equal(record.cryptoJournal.result, 'BE');
      assert.equal(record.cryptoJournal.realizedPnl, -0.5);
      assert.equal(record.cryptoJournal.review, '手動修正済み');
      assert.equal(record.cryptoJournal.orderFlow.cvd, '下降、価格は横ばい');
      assert.equal(record.cryptoJournal.orderFlow.oi, '上昇');
      assert.equal(record.cryptoJournal.orderFlow.footprint, '上部でBuy Absorption');
      assert.equal(record.cryptoJournal.orderFlow.imbalance, 'Sell Imbalanceあり');
      await page.evaluate(() => editFromTable(load()[0].id));
      await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      assert.equal(await page.locator('#crypto-analysis-text').inputValue(), full);
      assert.equal(await page.locator('#crypto-entry-price').inputValue(), '64999');
      assert.equal(await page.locator('#crypto-review').inputValue(), '手動修正済み');
      await page.evaluate(() => closeModal());
      const dl = page.waitForEvent('download'); await page.evaluate(() => backupData());
      const backup = await fs.readFile(await (await dl).path());
      assert.equal(JSON.parse(backup).stores.trades[0].cryptoJournal.analysisText, full);
      await page.evaluate(() => deleteTrade(load()[0].id)); await page.waitForFunction(() => load().length === 0);
      const loaded = page.waitForEvent('load');
      await page.setInputFiles('#restore-input', { name: 'analysis.json', mimeType: 'application/json', buffer: backup });
      await loaded; await page.waitForFunction(() => load().length === 1);
      assert.deepEqual(await page.evaluate(() => load()[0]), record);
    });
    await test('partial, shuffled, mixed Japanese/English aliases and unknown fields remain savable', async page => {
      const text = `FR：+0.02%\nHeatmap: 薄いBid\nLong/Short: ロング\n**Symbol**: ETH\nStrategy: Pullback\nEntry Price: $2,500.5\nQty: 0.1 ETH\n未知の指標: 保持する <img src=x onerror=alert(1)>\nReview: 手動で補完`;
      await apply(page, text);
      assert.equal(await page.locator('input[name=crypto-asset][value=ETH]').isChecked(), true);
      assert.equal(await page.locator('input[name=crypto-direction][value=Long]').isChecked(), true);
      assert.equal(await page.locator('#crypto-entry-price').inputValue(), '2500.5');
      assert.equal(await page.locator('#crypto-flow-orderBook').inputValue(), '薄いBid');
      assert.ok((await page.locator('#analysis-status').innerText()).includes('未知の指標'));
      assert.equal(await page.locator('#crypto-sl').inputValue(), '');
      await save(page);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.analysisText), text);
      await page.evaluate(() => openDay(load()[0].date));
      const details = page.locator('.crypto-trade-details details').filter({ has: page.locator('summary', { hasText: '原文' }) });
      await details.locator('summary').click();
      assert.ok((await details.innerText()).includes('<img src=x onerror=alert(1)>'));
      assert.equal(await details.locator('img').count(), 0);
    });
    await test('uncertain values do not overwrite valid input; duplicate fields and dates are reported', async page => {
      await page.locator('#crypto-entry-price').fill('100');
      await page.locator('#crypto-size').fill('1');
      await page.locator('#crypto-flow-cvd').locator('xpath=ancestor::details').locator('summary').click();
      await page.locator('#crypto-flow-cvd').fill('元のメモ');
      await apply(page, 'Entry: 60,000〜61,000\nSize: 不明\n方向: Long / Short\nCVD:\nEntry datetime: 2026-02-31 10:00\nExit datetime: 2020-01-01 10:00');
      assert.equal(await page.locator('#crypto-entry-price').inputValue(), '100');
      assert.equal(await page.locator('#crypto-size').inputValue(), '1');
      assert.equal(await page.locator('#crypto-flow-cvd').inputValue(), '元のメモ');
      assert.equal(await page.locator('#crypto-exit-at').inputValue(), '');
      assert.ok((await page.locator('#analysis-status').innerText()).includes('形式を確認'));
      await apply(page, 'SL: 95\nSL: 90\n売買方向: 売り');
      assert.equal(await page.locator('#crypto-sl').inputValue(), '90');
      assert.ok((await page.locator('#analysis-status').innerText()).includes('重複'));
      await save(page);
    });
    await test('overwrite confirmation can cancel while preserving the raw text', async (page, dialogs, accept) => {
      await apply(page, 'Entry: 100\nSize: 1');
      await page.locator('#crypto-entry-price').fill('105');
      page.off('dialog', accept); page.once('dialog', d => d.dismiss());
      await apply(page, 'Entry: 200\nCVD: 下落');
      assert.equal(await page.locator('#crypto-entry-price').inputValue(), '105');
      assert.equal(await page.locator('#crypto-flow-cvd').inputValue(), '');
      assert.equal(await page.locator('#crypto-analysis-text').inputValue(), 'Entry: 200\nCVD: 下落');
      page.on('dialog', accept); await save(page);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.entryPrice), 105);
      assert.equal(await page.evaluate(() => load()[0].cryptoJournal.analysisText), 'Entry: 200\nCVD: 下落');
    });
    await test('paste event automatically applies locally; unknown strategy/symbol and zero PnL survive', async page => {
      const text = '銘柄: XRP\n売買方向: Short\nEntry: 0.5\nSize: 100\nPnL: 0\n結果: Win\n戦略: 独自の反転\nOrder Book Heatmap: 下のBidが薄い';
      await page.locator('#crypto-analysis-text').evaluate((element, text) => {
        const data = new DataTransfer(); data.setData('text/plain', text);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
        element.value = text; element.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);
      await page.waitForFunction(() => document.getElementById('crypto-entry-price').value === '0.5');
      assert.equal(await page.locator('#crypto-symbol-other').inputValue(), 'XRP');
      assert.equal(await page.locator('#crypto-strategy-other').inputValue(), '独自の反転');
      assert.equal(await page.locator('#crypto-pnl').inputValue(), '0');
      assert.equal(await page.locator('input[name=crypto-result][value=Win]').isChecked(), true);
      await save(page);
      assert.equal(await page.evaluate(() => load()[0].symbol), 'XRP');
    });
    await test('unknown-only text is retained; missing metadata in existing records remains compatible', async page => {
      await page.locator('#crypto-entry-price').fill('10'); await page.locator('#crypto-size').fill('1');
      const text = '不明指標: メモ\n続きの文章'; await apply(page, text); await save(page);
      await page.evaluate(async () => { const t = structuredClone(load()[0]); delete t.cryptoJournal.analysisText; await dbPut('trades', t); });
      await page.reload(); await page.waitForFunction(() => load().length === 1);
      await page.evaluate(() => editFromTable(load()[0].id)); await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
      assert.equal(await page.locator('#crypto-analysis-text').inputValue(), '');
      await save(page);
    });
    for (const width of [320, 412, 915]) {
      await test(`paste UI fits ${width}px and has large controls`, async page => {
        await page.setViewportSize({ width, height: 844 }); await apply(page, full);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const button = await page.locator('#analysis-apply').boundingBox(); assert.ok(button.height >= 48);
        const textarea = await page.locator('#crypto-analysis-text').boundingBox(); assert.ok(textarea.height >= 210);
      });
    }
    console.log(`${passed} tests passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
