// Run against a local static server: node tests/data-safety.cjs
// Requires Playwright and Chromium. Every destructive operation uses an isolated context.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.JOURNAL_TEST_URL || 'http://127.0.0.1:8080';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [];
  async function test(name, fn) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try { await fn(page, context); assert.deepEqual(errors, []); results.push(name); console.log('PASS', name); }
    finally { await context.close(); }
  }
  async function ready(page) {
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('.day-cell') && !_tjUnavailable);
  }
  async function upload(page, backup, accept = true) {
    const messages = [];
    const handler = async d => {
      messages.push({ type: d.type(), text: d.message() });
      if (d.type() === 'confirm' && !accept) await d.dismiss(); else await d.accept();
    };
    page.on('dialog', handler);
    // Await restore including confirmation; reload is scheduled by the actual app.
    const reloaded = accept ? page.waitForEvent('load', { timeout: 5000 }).catch(() => null) : Promise.resolve();
    await page.setInputFiles('#restore-input', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    if (accept) await reloaded;
    await page.waitForFunction(() => document.querySelector('#restore-input').value === '');
    page.off('dialog', handler);
    return messages;
  }
  try {
    await test('save → reload → full JSON download → delete test data → restore → reload', async page => {
      await ready(page);
      const seed = await page.evaluate(async () => {
        const t = { id: 'test-trade', date: '2026-10-21', symbol: 'TEST', type: 'stock', tags: [], mistakes: [], rules: [], legs: [
          { action: 'buy', date: '2026-10-21T09:30', price: 100, quantity: 10, commission: 1 },
          { action: 'sell', date: '2026-10-21T10:30', price: 110, quantity: 10, commission: 1 }] };
        await save([t]);
        const fixtures = {
          tags: [{ id: 'tag', name: 'test' }], mistakes: [{ id: 'mistake', name: 'test' }], rules: [{ id: 'rule', name: 'test' }],
          plans: [{ date: '2026-10-21', html: '<p>日記</p>' }], ideas: [{ id: 'idea', symbol: 'TEST', weekOf: '2026-10-19' }],
          optionStrategies: [{ id: 'strategy', strategyType: 'Custom', tradeIds: ['test-trade'] }],
          llmQueries: [{ id: 'query', title: 'test', prompt: 'test', createdAt: '2026-10-21T00:00:00Z' }],
          llmTradePlans: [{ id: 'llm-plan', cardData: { symbol: 'TEST' } }],
          bankingEntries: [{ id: 'entry', date: '2026-10-21', bankAmount: -100, brokerageAmount: 100 }],
          settings: [{ key: 'ltj_llm_results', value: { query: '<p>回答本文</p>' } },
            { key: 'custom-setting', value: { nested: [1, '日本語', true] } }],
        };
        await dbMergeMissing(fixtures);
        return await dbSnapshot();
      });
      await page.reload();
      await page.waitForFunction(() => load().length === 1);
      assert.equal(await page.evaluate(() => getPnl(load()[0])), 98);
      const downloaded = page.waitForEvent('download');
      await page.evaluate(() => backupData());
      const download = await downloaded;
      const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      assert.equal(backup.version, 10);
      assert.equal(backup.format, 'local-trading-journal');
      assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
      assert.equal(Object.keys(backup.stores).length, 12);
      // UI initialization may persist settings; compare every seeded record.
      for (const [name, records] of Object.entries(seed)) for (const record of records) {
        assert.ok(backup.stores[name].some(r => JSON.stringify(r) === JSON.stringify(record)), name);
      }
      await page.evaluate(async () => {
        const db = await _openTjDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(TJ_STORES, 'readwrite');
          for (const name of TJ_STORES) tx.objectStore(name).clear();
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
      });
      const messages = await upload(page, backup);
      assert.ok(messages.some(m => m.type === 'confirm' && m.text.includes('上書きしません')));
      assert.ok(messages.some(m => m.text.includes('復元が完了')));
      await page.waitForFunction(() => load().length === 1);
      const restored = await page.evaluate(() => dbSnapshot());
      assert.deepEqual(restored, backup.stores);
    });

    await test('merge preserves current records and settings; cancel changes nothing; legacy v9 supported', async page => {
      await ready(page);
      await page.evaluate(async () => {
        await dbPut('tags', { id: 'same', name: 'current' });
        await dbPutSetting('ltj_llm_results', { current: 'keep' });
      });
      const legacy = { version: 9, trades: [], tags: [{ id: 'same', name: 'old' }, { id: 'new', name: 'new' }],
        plans: { '2026-10-20': '<p>legacy</p>' }, llmQueries: { queries: [], categories: ['test'] } };
      const before = await page.evaluate(() => dbSnapshot());
      const messages = await upload(page, legacy, false);
      assert.equal(messages[0].type, 'confirm');
      assert.deepEqual(await page.evaluate(() => dbSnapshot()), before);
      await upload(page, legacy);
      assert.deepEqual(await page.evaluate(() => dbGet('tags', 'same')), { id: 'same', name: 'current' });
      assert.equal((await page.evaluate(() => dbGet('tags', 'new'))).name, 'new');
      assert.deepEqual(await page.evaluate(() => dbGetSetting('ltj_llm_results')), { current: 'keep' });
      assert.equal((await page.evaluate(() => dbGet('plans', '2026-10-20'))).html, '<p>legacy</p>');
    });

    await test('invalid/future/duplicate/incomplete backups rejected before writes', async page => {
      await ready(page);
      const before = await page.evaluate(() => dbSnapshot());
      const valid = { format: 'local-trading-journal', version: 10, databaseVersion: 5, exportedAt: new Date().toISOString(), stores: before };
      const invalids = [null, { version: 11, trades: [] }, { trades: [], tags: [{ id: 'x' }, { id: 'x' }] },
        { ...valid, stores: { trades: [] } }, { ...valid, exportedAt: 'bad' },
        { trades: [], banking: { accounts: [], entries: 'bad' } }, { trades: [{ id: 'bad' }] }];
      for (const invalid of invalids) {
        const messages = await upload(page, invalid, false);
        assert.ok(messages.some(m => m.type === 'alert' && m.text.includes('復元できません')));
        assert.ok(!messages.some(m => m.type === 'confirm'));
        assert.deepEqual(await page.evaluate(() => dbSnapshot()), before);
      }
    });

    await test('transaction failure rolls back every store; clear+put failure preserves old records', async page => {
      await ready(page);
      page.on('dialog', d => d.accept());
      await page.evaluate(() => dbPut('tags', { id: 'keep', name: 'keep' }));
      const before = await page.evaluate(() => dbSnapshot());
      for (const operation of ['merge', 'replace']) {
        const outcome = await page.evaluate(async operation => {
          let failed = false;
          try {
            if (operation === 'merge') await dbMergeMissing({ trades: [{ id: 'new', symbol: 'TEST' }], tags: [{ name: 'missing-key' }] });
            else await dbReplaceAll('tags', [{ name: 'missing-key' }]);
          } catch { failed = true; }
          return { failed, unavailable: _tjUnavailable, inert: document.body.inert };
        }, operation);
        assert.deepEqual(outcome, { failed: true, unavailable: true, inert: true });
        await page.reload();
        await page.waitForFunction(() => !_tjUnavailable && document.querySelector('.day-cell'));
        assert.deepEqual(await page.evaluate(() => dbSnapshot()), before);
      }
    });

    await test('legacy migration merges atomically without overwriting IndexedDB', async page => {
      await ready(page);
      await page.evaluate(async () => {
        await dbPut('tags', { id: 'same', name: 'current' });
        await dbDeleteSetting('_migrated_v1');
        localStorage.setItem('tj-tags-v1', JSON.stringify([{ id: 'same', name: 'stale' }, { id: 'legacy', name: 'legacy' }]));
      });
      await page.reload(); await page.waitForFunction(() => !_tjUnavailable && document.querySelector('.day-cell'));
      assert.equal((await page.evaluate(() => dbGet('tags', 'same'))).name, 'current');
      assert.equal((await page.evaluate(() => dbGet('tags', 'legacy'))).name, 'legacy');
      assert.ok(await page.evaluate(() => localStorage.getItem('tj-tags-v1')));
    });

    await test('failed backup read produces an error and no empty download', async page => {
      await ready(page);
      let downloaded = false;
      const messages = [];
      page.on('download', () => { downloaded = true; });
      page.on('dialog', async d => { messages.push(d.message()); await d.accept(); });
      await page.evaluate(async () => {
        dbSnapshot = async () => { throw new Error('simulated read failure'); };
        await backupData();
      });
      assert.equal(downloaded, false);
      assert.ok(messages.some(m => m.includes('バックアップを作成できませんでした')));
    });

    await test('malformed legacy migration changes no stored records or completion flag', async page => {
      await ready(page);
      const before = await page.evaluate(async () => {
        await dbDeleteSetting('_migrated_v1');
        localStorage.setItem('tj-tags-v1', JSON.stringify([{ id: 'would-add', name: 'legacy' }]));
        localStorage.setItem('tj-plans-v1', 'not-json');
        return dbSnapshot();
      });
      page.on('dialog', d => d.accept());
      await page.reload();
      await page.waitForFunction(() => document.body.inert);
      const inspect = await page.context().newPage();
      // Inspect the DB without rerunning migration or modifying it.
      await inspect.goto(base + '/version.json');
      const after = await inspect.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('trading-journal-db', 5);
          req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        const names = Array.from(db.objectStoreNames);
        const data = await new Promise((resolve, reject) => {
          const tx = db.transaction(names, 'readonly'), out = {};
          for (const name of names) { const req = tx.objectStore(name).getAll(); req.onsuccess = () => { out[name] = req.result; }; }
          tx.oncomplete = () => resolve(out); tx.onabort = () => reject(tx.error);
        });
        db.close(); return data;
      });
      assert.deepEqual(after, before);
      await inspect.close();
    });

    for (const mode of ['timeout', 'error', 'throw']) {
      await test(`DB ${mode}: Japanese error, no deletion or writes; late success closed`, async page => {
        await ready(page);
        await page.evaluate(() => dbPut('tags', { id: 'keep', name: 'keep' }));
        const dialogs = [];
        page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
        await page.addInitScript(mode => {
          window.dbAudit = { deleted: 0, closed: 0, opens: 0 };
          indexedDB.deleteDatabase = () => { window.dbAudit.deleted++; throw Error('must not delete'); };
          indexedDB.open = () => {
            window.dbAudit.opens++;
            if (mode === 'throw') throw Error('open denied');
            const req = {};
            if (mode === 'error') setTimeout(() => { req.error = Error('open failed'); req.onerror(); }, 0);
            else setTimeout(() => req.onsuccess({ target: { result: { close() { window.dbAudit.closed++; } } } }), 4200);
            return req;
          };
        }, mode);
        await page.reload();
        await page.waitForFunction(() => document.body.inert === true);
        assert.ok(dialogs.some(t => t.includes('データベースを開けませんでした')));
        if (mode === 'timeout') await page.waitForFunction(() => window.dbAudit.closed === 1);
        assert.equal(await page.evaluate(() => dbAudit.deleted), 0);
        assert.equal(await page.evaluate(() => dbAudit.opens), 1);
        assert.equal(await page.evaluate(async () => { try { await dbPut('tags', { id: 'bad' }); return false; } catch { return true; } }), true);
        // Open the real same-origin database in a fresh page without the fault injection.
        const inspect = await page.context().newPage();
        await inspect.goto(base); await inspect.waitForFunction(() => document.querySelector('.day-cell'));
        assert.equal((await inspect.evaluate(() => dbGet('tags', 'keep'))).name, 'keep');
        await inspect.close();
      });
    }
    console.log(`${results.length} tests passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
