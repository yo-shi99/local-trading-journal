// node tests/pwa.cjs — actual Service Worker on a loopback origin and Pages subpath.
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const prefix = '/local-trading-journal/';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

(async () => {
  let revision = null, failInstall = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) || (failInstall && relative === 'css/base.css')) { res.writeHead(404).end(); return; }
    try {
      let body = await fs.readFile(target);
      if (relative === 'sw.js' && revision) body = Buffer.from(body.toString().replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = '${revision}';`));
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  let browser;
  try {
    const profile = await fs.mkdtemp('/tmp/ltj-pwa-');
    browser = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'], ...devices['Pixel 7'], acceptDownloads: true,
    });
    const context = browser;
    let page = await context.newPage();
    const errors = [];
    const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); };
    watch(page);
    await page.goto(base); await page.waitForSelector('.day-cell');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const registration = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const manifest = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
      const manifestUrl = document.querySelector('link[rel=manifest]').href;
      return { scope: reg.scope, start: new URL(manifest.start_url, manifestUrl).href, manifestScope: new URL(manifest.scope, manifestUrl).href, display: manifest.display, icons: manifest.icons };
    });
    assert.equal(registration.scope, base); assert.equal(registration.start, base);
    assert.equal(registration.manifestScope, base); assert.equal(registration.display, 'standalone');
    assert.deepEqual(registration.icons.map(i => i.sizes), ['192x192', '512x512', '512x512']);
    const cdp = await context.newCDPSession(page);
    const appManifest = await cdp.send('Page.getAppManifest');
    assert.deepEqual(appManifest.errors, []); assert.ok(appManifest.data.includes('standalone'));
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, []);
    console.log('PASS manifest recognized, icons, start_url, scope, actual SW activation at Pages subpath');

    await page.locator('.header-add-btn').click();
    const analysis = '銘柄: BTC\n方向: Long\nエントリー価格: 65000\nポジションサイズ: 0.01\n戦略: SFP\nCVD: 上昇';
    await page.locator('#crypto-analysis-text').evaluate((el, text) => {
      const data = new DataTransfer(); data.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
      el.value = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    }, analysis);
    await page.waitForFunction(() => document.getElementById('crypto-entry-price').value === '65000');
    const image = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 2000; c.height = 1000;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#67e8bb'; ctx.fillRect(0, 0, 2000, 1000);
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.setInputFiles('#screenshot-input', { name: 'pwa-test.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => !screenshotsBusy && screenshotDraft.length === 1);
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load().length === 1 && document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(() => closeModal());
    const id = await page.evaluate(() => load()[0].id);
    const history = await page.evaluate(async id => (await appendTradeEvent(id, {
      type: 'Entry', datetime: '2026-10-22T10:00', price: 65000, quantity: 0.01,
      realizedPnl: 0, reason: 'PWA test', memo: 'online',
    })).events, id);
    const initialState = await page.evaluate(() => getTradeState(load()[0]));
    assert.equal(initialState.remainingQuantity, 0.01);
    const version = JSON.parse(await fs.readFile(path.join(root, 'version.json'))).version;
    const cacheName = `ltj-static:${prefix}:${version}`;
    const cachedUrls = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => r.url), cacheName);
    assert.ok(cachedUrls.length > 40);
    assert.ok(cachedUrls.every(url => url.startsWith(base) && !/blob:|data:|api\/|pwa-test/.test(url)));
    console.log('PASS online paste, screenshot compression, save; cache contains only bundled static files');

    await context.setOffline(true); await page.reload(); await page.waitForFunction(() => load().length === 1);
    assert.deepEqual(await page.evaluate(() => load()[0].events), history);
    assert.deepEqual(await page.evaluate(() => getTradeState(load()[0])), initialState);
    const entryBeforeExitPatch = await page.evaluate(() => structuredClone(load()[0].cryptoJournal));
    await page.evaluate(async id => {
      const image = { ...load()[0].screenshots[0], id: 'pwa-exit-shot', category: 'Exit' };
      await saveTradeExitUpdate(id, { review: 'offline Exit review', reason: 'offline reason', memo: 'offline memo' }, [image]);
    }, id);
    assert.deepEqual(await page.evaluate(() => load()[0].cryptoJournal), entryBeforeExitPatch);
    await page.evaluate(id => appendTradeEvent(id, { type: 'Add Entry', datetime: '2026-10-22T11:00',
      price: 64000, quantity: 0.005, realizedPnl: null, reason: '', memo: 'offline' }), id);
    await page.locator('#nav-trades').click(); assert.ok((await page.locator('#trades-body').innerText()).includes('BTC'));
    await page.evaluate(id => editFromTable(id), id);
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
    const updateText = '更新種別: Partial TP\n日時: 2026-10-22 12:00:04\n価格: 66000\n数量: 0.001 BTC\n実現損益: 0 USDT\n理由: offline update';
    await page.setInputFiles('#update-import-input', { name: 'offline-update.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => !updateImportImagesBusy && updateImportImages.length === 1);
    await page.locator('#update-import-text').fill(updateText);
    await page.locator('#update-import-analyse').click();
    await page.waitForFunction(() => updateImportPending !== null);
    await page.locator('#update-import-confirm').click();
    await page.waitForFunction(() => load()[0].events.length === 3 && document.getElementById('trade-form').style.display === 'none');
    await page.evaluate(id => editFromTable(id), id);
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'block');
    await page.locator('#crypto-review').fill('オフラインで編集');
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load()[0].cryptoJournal.review === 'オフラインで編集');
    await page.evaluate(() => closeModal());
    await page.evaluate(() => openDay(load()[0].date));
    await page.waitForFunction(() => document.querySelector('.trade-screenshots img')?.naturalWidth === 1600);
    await page.locator('.trade-screenshots .screenshot-open').last().click();
    await page.waitForFunction(() => document.getElementById('screenshot-full').naturalWidth === 1600);
    await page.locator('#screenshot-viewer-close').click(); await page.evaluate(() => closeModal());
    console.log('PASS offline reload, trade list, edit, persisted screenshot thumbnail and enlargement');

    await page.locator('.header-add-btn').click();
    await page.locator('#crypto-analysis-text').fill('更新種別: New Entry\n銘柄: ETH\n方向: Short\nEntry: 2500\nSize: 0.1\nFutures CVD: offline futures\nSpot CVD: offline spot\nVolume: offline volume\nPrice Structure: offline structure');
    await page.locator('#analysis-apply').click();
    await page.setInputFiles('#screenshot-input', { name: 'offline.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => !screenshotsBusy && screenshotDraft.length === 1);
    await page.getByRole('button', { name: 'Save Trade', exact: true }).click();
    await page.waitForFunction(() => load().length === 2 && document.getElementById('trade-form').style.display === 'none');
    await page.reload(); await page.waitForFunction(() => load().length === 2);
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').screenshots[0].blob instanceof Blob), true);
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').cryptoJournal.entryAnalysis.futuresCvd), 'offline futures');
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').cryptoJournal.entryAnalysis.spotCvd), 'offline spot');
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').screenshots[0].category), 'Entry');
    // Exercise the new Final Exit analysis through the existing preview/confirm UI while offline.
    const ethId = await page.evaluate(() => load().find(t => t.symbol === 'ETH').id);
    const ethEntry = await page.evaluate(() => structuredClone(load().find(t => t.symbol === 'ETH').cryptoJournal));
    await page.evaluate(id => editFromTable(id), ethId);
    const ethExitText = `更新種別: Final Exit\n決済日時: ${ethEntry.entryAt}\nExit価格: 2501\n決済数量: 0.1 ETH\n実現損益: 0\nExit時Futures CVD: offline exit futures\nExit時Spot CVD: offline exit spot\n振り返り: offline final review`;
    await page.locator('#update-import-text').fill(ethExitText);
    await page.locator('#update-import-analyse').click();
    await page.waitForFunction(() => updateImportPending !== null);
    await page.locator('#update-import-confirm').click();
    await page.waitForFunction(() => document.getElementById('trade-form').style.display === 'none');
    await page.reload(); await page.waitForFunction(() => load().length === 2);
    assert.deepEqual(await page.evaluate(() => load().find(t => t.symbol === 'ETH').cryptoJournal), ethEntry);
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').exitUpdate.analysis.exitSpotCvd), 'offline exit spot');
    assert.equal(await page.evaluate(() => getTradeState(load().find(t => t.symbol === 'ETH')).status), 'Closed');
    const downloaded = page.waitForEvent('download'); await page.evaluate(() => backupData());
    const backup = await fs.readFile(await (await downloaded).path());
    assert.equal(JSON.parse(backup).stores.trades.length, 2);
    console.log('PASS offline new trade, analysis import, new image, reload persistence and backup download');

    await context.setOffline(false); await page.reload(); await page.waitForFunction(() => load().length === 2);
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').cryptoJournal.entryAnalysis.volume), 'offline volume');
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).events.length, id), 3);
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).events.find(e => e.type === 'Partial TP').rawText, id), updateText);
    const offlineState = await page.evaluate(id => getTradeState(load().find(t => t.id === id)), id);
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).exitUpdate.review, id), 'offline Exit review');
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).screenshots.some(image => image.category === 'Exit' && image.blob instanceof Blob), id), true);
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).screenshots.some(image => image.category === 'Update' && image.blob instanceof Blob), id), true);
    assert.ok(Math.abs(offlineState.remainingQuantity - 0.014) < 1e-12);
    assert.ok(Math.abs(offlineState.averageEntryPrice - 64666.666666666664) < 1e-8);
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).cryptoJournal.review, id), 'オフラインで編集');
    assert.equal(await page.evaluate(id => load().find(t => t.id === id).cryptoJournal.analysisText, id), analysis);
    const restoring = page.waitForEvent('load');
    await page.setInputFiles('#restore-input', { name: 'pwa-backup.json', mimeType: 'application/json', buffer: backup });
    await restoring; await page.waitForFunction(() => load().length === 2);
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').exitUpdate.analysis.exitFuturesCvd), 'offline exit futures');
    assert.equal(await page.evaluate(() => load().find(t => t.symbol === 'ETH').events[0].rawText), ethExitText);
    console.log('PASS online return preserves IndexedDB, original analysis and images; backup restore');

    await page.evaluate(() => caches.open('unrelated-cache').then(c => c.put('/unrelated', new Response('keep'))));
    revision = version + '-test-update';
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    assert.ok((await page.evaluate(() => navigator.serviceWorker.controller.state)) === 'activated');
    assert.ok((await page.evaluate(() => caches.keys())).includes(cacheName));
    await page.close();
    await new Promise(resolve => setTimeout(resolve, 300));
    page = await context.newPage(); watch(page); await page.goto(base); await page.waitForFunction(() => load().length === 2);
    await page.waitForFunction(async name => !(await caches.keys()).includes(name), cacheName);
    assert.ok((await page.evaluate(() => caches.keys())).includes('unrelated-cache'));
    const updatedCache = `ltj-static:${prefix}:${revision}`;
    assert.ok((await page.evaluate(() => caches.keys())).includes(updatedCache));
    console.log('PASS update waits while editor is open; closing clients activates new version, removes only own old cache, keeps IndexedDB');

    revision = version + '-test-failed'; failInstall = true;
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
      const installing = reg.installing;
      if (installing && installing.state !== 'redundant') await new Promise(resolve => installing.addEventListener('statechange', () => { if (installing.state === 'redundant' || installing.state === 'installed') resolve(); }));
    });
    await context.setOffline(true); await page.reload(); await page.waitForFunction(() => load().length === 2);
    assert.ok((await page.evaluate(() => caches.keys())).includes(updatedCache));
    assert.equal(await page.evaluate(() => load().filter(t => t.screenshots[0].blob instanceof Blob).length), 2);
    assert.deepEqual(errors, []);
    console.log('PASS incomplete update keeps working offline version and all records/images; no JavaScript errors');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
