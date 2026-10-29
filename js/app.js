const state = { view: 'calendar', tradesVisited: false };

const APP_VERSION = '1.13.0';

// Presentation-only mode: remove the body class to restore the original interface.
function isSimpleJournal() { return document.body.classList.contains('journal-simple'); }


function toggleUtilDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('util-dropdown-menu');
  const btn = e.currentTarget;
  const isOpen = menu.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
}
function closeUtilDropdown() {
  document.getElementById('util-dropdown-menu').classList.remove('open');
  const btn = document.querySelector('.util-dropdown-toggle');
  if (btn) btn.classList.remove('active');
}
document.addEventListener('click', function(e) {
  const dd = document.getElementById('util-dropdown');
  if (dd && !dd.contains(e.target)) closeUtilDropdown();
});

function toggleAddDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('add-dropdown-menu');
  const btn = e.currentTarget;
  const isOpen = menu.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
}
function closeAddDropdown() {
  document.getElementById('add-dropdown-menu').classList.remove('open');
  const btn = document.querySelector('.add-dropdown-toggle');
  if (btn) btn.classList.remove('active');
}
document.addEventListener('click', function(e) {
  const dd = document.getElementById('add-dropdown');
  if (dd && !dd.contains(e.target)) closeAddDropdown();
});

function switchView(v) {
  if (isSimpleJournal() && !['calendar', 'trades'].includes(v)) v = 'calendar';
  if (typeof _bulkIsActive === 'function' && _bulkIsActive() && !_bulkConfirmLeave()) return;
  if (typeof _bulkCleanup === 'function') _bulkCleanup();
  state.view = v;
  // Cleanup signal-intel SSE when leaving the view
  if (state.view === 'signal-intel' && v !== 'signal-intel' && typeof cleanupSignalIntelView === 'function') cleanupSignalIntelView();

  document.getElementById('view-bulk').style.display          = 'none';
  document.getElementById('view-cal').style.display           = v === 'calendar'     ? 'block' : 'none';
  document.getElementById('view-trades').style.display        = v === 'trades'       ? 'block' : 'none';
  document.getElementById('view-plan').style.display          = v === 'plan'         ? 'block' : 'none';
  document.getElementById('view-reports').style.display       = v === 'reports'      ? 'block' : 'none';
  document.getElementById('view-banking').style.display       = v === 'banking'      ? 'block' : 'none';
  document.getElementById('view-signal-intel').style.display  = v === 'signal-intel' ? 'block' : 'none';
  document.getElementById('nav-cal').classList.toggle('active',          v === 'calendar');
  document.getElementById('nav-trades').classList.toggle('active',       v === 'trades');
  document.getElementById('nav-plan').classList.toggle('active',         v === 'plan');
  document.getElementById('nav-reports').classList.toggle('active',      v === 'reports');
  document.getElementById('nav-banking').classList.toggle('active',      v === 'banking');
  document.getElementById('nav-signal-intel').classList.toggle('active', v === 'signal-intel');
  updateFilterBarContext(v);
  if (v === 'trades') renderTrades();
  if (v === 'calendar') renderCalendar();
  if (v === 'plan')     initPlanView();
  if (v === 'reports')  initReportsView();
  if (v === 'banking')      renderBankingView();
  if (v === 'signal-intel' && typeof initSignalIntelView === 'function') initSignalIntelView();
}

function openAddGlobal() {
  document.body.classList.add('detail-editing');
  const navigationTicket = prepareTradeEditorNavigation();
  activeDate = todayStr();
  editingId  = null;
  const dt = new Date();
  document.getElementById('modal-title').textContent = 'New Trade';
  document.getElementById('modal-sub').textContent   = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  hideForm();
  refreshDayModal();
  document.getElementById('day-overlay').classList.add('open');
  setTimeout(() => { if (isTradeEditorOpenTicket(navigationTicket)) showForm(null); }, 50);
}

function editFromTable(id) { openTradeDetail(id); }

// ─── CSV TEMPLATE & IMPORT ───

const CSV_HEADERS = 'trade_id,symbol,type,option_type,strike_price,expiry_date,action,datetime,price,quantity,commission,fees,notes';

function downloadCSVTemplate() {
  const rows = [
    CSV_HEADERS,
    'T1,AAPL,option,call,185.00,2026-04-17,buy,2026-03-24T09:35,3.50,2,1.30,0.00,Bought AAPL call ahead of earnings',
    'T1,AAPL,option,call,185.00,2026-04-17,sell,2026-03-24T14:15,6.80,2,1.30,0.00,Took profit on AAPL call',
    'T2,TSLA,stock,,,,buy,2026-03-24T10:00,175.50,100,1.00,0.00,Breakout entry on TSLA',
    'T2,TSLA,stock,,,,sell,2026-03-24T15:30,182.25,100,1.00,0.00,EOD close TSLA',
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'localtradejournal_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSVLine(line) {
  // Handles quoted fields containing commas
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function isValidDatetime(dt) {
  // Accepts YYYY-MM-DDTHH:MM or YYYY-MM-DD H:MM or YYYY-MM-DD HH:MM (Google Sheets export)
  return /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}$/.test(dt);
}

function normalizeDateTime(dt) {
  // Convert "2026-03-22 9:35" → "2026-03-22T09:35"
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/);
  if (!m) return dt;
  return `${m[1]}T${m[2].padStart(2, '0')}:${m[3]}`;
}

function isValidDate(d) {
  // YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function importCSVTrades(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) { alert('CSV file is empty.'); event.target.value = ''; return; }

    // Validate header
    const header = lines[0].toLowerCase().trim();
    if (header !== CSV_HEADERS) {
      alert('CSV header does not match the expected template. Please use the CSV Template button to get the correct format.');
      event.target.value = '';
      return;
    }

    const errors = [];
    const rowData = [];

    for (let i = 1; i < lines.length; i++) {
      const lineNum = i + 1; // 1-based, header = line 1
      const fields  = parseCSVLine(lines[i]);
      if (fields.length < 13) {
        errors.push({ line: lineNum, issues: ['Row has fewer than 13 columns'] });
        continue;
      }

      const [trade_id, symbol, type, option_type, strike_price, expiry_date,
             action, datetime, price, quantity, commission, fees, ...notesParts] = fields;
      const notes = notesParts.join(',');
      const issues = [];

      if (!trade_id) issues.push('trade_id is required');
      if (!symbol)   issues.push('symbol is required');
      if (!['stock','option'].includes(type)) issues.push(`type must be "stock" or "option" (got "${type}")`);
      if (!['buy','sell'].includes(action))   issues.push(`action must be "buy" or "sell" (got "${action}")`);
      if (!isValidDatetime(datetime))         issues.push(`datetime must be YYYY-MM-DDTHH:MM (got "${datetime}")`);
      if (isNaN(parseFloat(price)) || parseFloat(price) < 0)      issues.push('price must be a non-negative number');
      if (isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) issues.push('quantity must be a positive number');
      if (isNaN(parseFloat(commission)) || parseFloat(commission) < 0) issues.push('commission must be a non-negative number');
      if (isNaN(parseFloat(fees)) || parseFloat(fees) < 0)        issues.push('fees must be a non-negative number');

      if (type === 'option') {
        if (!['call','put'].includes(option_type)) issues.push(`option_type must be "call" or "put" for options (got "${option_type}")`);
        if (!strike_price || isNaN(parseFloat(strike_price))) issues.push('strike_price is required for options');
        if (!isValidDate(expiry_date)) issues.push(`expiry_date must be YYYY-MM-DD for options (got "${expiry_date}")`);
      }

      if (issues.length) { errors.push({ line: lineNum, issues }); }
      else { rowData.push({ trade_id, symbol, type, option_type, strike_price, expiry_date, action, datetime, price, quantity, commission, fees, notes }); }
    }

    if (errors.length) {
      showImportErrors(errors);
      event.target.value = '';
      return;
    }

    // Group rows by trade_id → build trade objects
    const tradeMap = {};
    for (const row of rowData) {
      if (!tradeMap[row.trade_id]) {
        tradeMap[row.trade_id] = {
          id:          uid(),
          symbol:      row.symbol.toUpperCase(),
          type:        row.type,
          optionType:  row.option_type || null,
          strikePrice: row.strike_price || null,
          expiryDate:  row.expiry_date  || null,
          notes:       row.notes        || '',
          legs:        [],
        };
      }
      tradeMap[row.trade_id].legs.push({
        id:         uid(),
        action:     row.action,
        date:       normalizeDateTime(row.datetime),
        price:      row.price,
        quantity:   row.quantity,
        commission: row.commission,
        fees:       row.fees,
      });
    }

    // Derive trade.date from first leg datetime
    const newTrades = Object.values(tradeMap).map(t => {
      t.date = t.legs[0].date.split('T')[0];
      return t;
    });

    const existing    = load();
    const merged      = [...existing, ...newTrades];
    save(merged);
    renderStats();
    renderCalendar();
    if (state.view === 'trades') renderTrades();

    const legCount = newTrades.reduce((s, t) => s + t.legs.length, 0);
    showImportSuccess(newTrades.length, legCount);
    event.target.value = '';
  };
  reader.readAsText(file);
}

function showImportErrors(errors) {
  document.getElementById('import-error-title').textContent = 'Import Failed — Fix These Errors';
  document.getElementById('import-error-sub').textContent   = `${errors.length} row${errors.length !== 1 ? 's' : ''} with issues`;
  document.getElementById('import-error-list').innerHTML = errors.map(e =>
    `<div class="import-error-item">
      <div class="err-row">Line ${e.line}</div>
      <div class="err-fields">${e.issues.join(' &bull; ')}</div>
    </div>`
  ).join('');
  document.getElementById('import-error-overlay').classList.add('open');
}

function showImportSuccess(tradeCountOrMsg, legCount) {
  const msg = legCount !== undefined
    ? `Imported ${tradeCountOrMsg} trade${tradeCountOrMsg !== 1 ? 's' : ''} with ${legCount} leg${legCount !== 1 ? 's' : ''} successfully.`
    : tradeCountOrMsg;
  document.getElementById('import-error-title').textContent = 'Import Successful';
  document.getElementById('import-error-sub').textContent   = '';
  document.getElementById('import-error-list').innerHTML =
    `<div class="import-success-msg">&#10003; ${msg}</div>`;
  document.getElementById('import-error-overlay').classList.add('open');
}

function closeImportErrors() {
  document.getElementById('import-error-overlay').classList.remove('open');
}

// ─── BACKUP & RESTORE ───

const TJ_BACKUP_VERSION = 10;

async function backupData() {
  try {
    const backup = {
      format: 'local-trading-journal',
      version: TJ_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      databaseVersion: TJ_DB_VERSION,
      stores: await screenshotsForBackup(await dbSnapshot()),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading-journal-backup-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('[TJ] Backup failed:', error);
    alert('バックアップを作成できませんでした。保存状態を確認してから再試行してください。');
  }
}

// Validate the complete file before any write. Keep support for historical JSON exports.
function parseJournalBackup(raw) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  let stores;
  if (object(raw) && raw.version === TJ_BACKUP_VERSION) {
    if (raw.format !== 'local-trading-journal' || raw.databaseVersion !== TJ_DB_VERSION ||
        typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt)) ||
        !object(raw.stores) || TJ_STORES.some(name => !Object.hasOwn(raw.stores, name))) {
      throw new Error('バックアップの形式・日時・データベースのバージョンが正しくありません。');
    }
    stores = raw.stores;
  } else {
    if (!Array.isArray(raw) && (!object(raw) || !Array.isArray(raw.trades) ||
        (raw.version !== undefined && (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > 9)))) {
      throw new Error('対応していないバックアップ形式です。');
    }
    if (Array.isArray(raw)) stores = { trades: raw };
    else {
      stores = {};
      for (const name of ['trades', 'tags', 'mistakes', 'rules', 'ideas', 'optionStrategies', 'llmTradePlans']) {
        if (raw[name] != null) stores[name] = raw[name];
      }
      if (raw.plans != null) {
        if (!object(raw.plans)) throw new Error('日別メモの形式が正しくありません。');
        stores.plans = Object.entries(raw.plans).map(([date, html]) => ({ date, html }));
      }
      stores.settings = [];
      if (raw.settings != null) {
        if (!object(raw.settings)) throw new Error('設定の形式が正しくありません。');
        stores.settings.push(...Object.entries(raw.settings).map(([key, value]) => ({ key, value })));
      }
      if (raw.llmQueries != null) {
        if (Array.isArray(raw.llmQueries)) stores.llmQueries = raw.llmQueries;
        else {
          if (!object(raw.llmQueries) || !Array.isArray(raw.llmQueries.queries) ||
              !Array.isArray(raw.llmQueries.categories)) throw new Error('AI質問の形式が正しくありません。');
          stores.llmQueries = raw.llmQueries.queries;
          stores.settings.push({ key: 'ltj_llm_categories', value: raw.llmQueries.categories });
        }
      }
      if (raw.banking != null) {
        if (Array.isArray(raw.banking)) stores.bankingEntries = raw.banking;
        else {
          if (!object(raw.banking)) throw new Error('入出金の形式が正しくありません。');
          stores.bankingAccounts = raw.banking.accounts;
          stores.bankingEntries = raw.banking.entries;
        }
      }
    }
  }
  for (const [name, records] of Object.entries(stores)) {
    if (!TJ_STORES.includes(name) || !Array.isArray(records)) throw new Error('保存データの形式が正しくありません。');
    const key = name === 'plans' ? 'date' : name === 'settings' ? 'key' : 'id';
    const seen = new Set();
    for (const record of records) {
      if (!object(record) || typeof record[key] !== 'string' || !record[key].trim() || seen.has(record[key])) {
        throw new Error(`${name}: 記録のキーが不正、または重複しています。`);
      }
      if ((name === 'plans' && (typeof record.html !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date))) ||
          (name === 'settings' && !Object.hasOwn(record, 'value')) ||
          (name === 'trades' && (typeof record.symbol !== 'string' ||
            (record.legs !== undefined && (!Array.isArray(record.legs) || record.legs.some(leg =>
              !object(leg) || !['buy', 'sell'].includes(leg.action) || !Number.isFinite(Number(leg.price)) ||
              !Number.isFinite(Number(leg.quantity)) || Number(leg.quantity) <= 0)))))) {
        throw new Error(`${name}: 記録の内容が正しくありません。`);
      }
      if (name === 'trades') validateScreenshots(record.screenshots);
      if (name === 'trades') validateTradeEvents(record.events);
      if (name === 'trades') validateTradeSummary(record);
      if (name === 'trades') validateExitUpdate(record.exitUpdate);
      if (name === 'trades' && record.cryptoJournal !== undefined) validateCryptoJournal(record.cryptoJournal);
      seen.add(record[key]);
    }
  }
  return stores;
}

async function restoreData(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const stores = parseJournalBackup(raw);
    const count = Object.values(stores).reduce((n, records) => n + records.length, 0);
    const date = raw.exportedAt ? new Date(raw.exportedAt).toLocaleString() : '不明（旧形式）';
    if (!confirm(`バックアップ日時: ${date}\n対象: ${count}件\n\n現在のデータを残して統合します。同じID・日付・設定キーがある場合、現在の内容を優先し、上書きしません。完全置換や削除は行いません。\n復元しますか？`)) return;
    const blobStores = screenshotStoresAsBlobs(stores);
    await dbMergeMissing(blobStores);
    // Re-read committed data on reload; no partially updated in-memory caches.
    alert('復元が完了しました。保存内容を読み直します。');
    window.location.reload();
  } catch (error) {
    console.error('[TJ] Restore failed:', error);
    alert('復元できませんでした。データの統合は完了していません。\n' + (error.message || String(error)));
  } finally { input.value = ''; }
}

// close multi-select dropdowns when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.gf-multiselect')) {
    document.querySelectorAll('.gf-multi-drop.open').forEach(d => d.classList.remove('open'));
  }
});

// close modal on overlay click
document.getElementById('day-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('import-error-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeImportErrors();
});

// Prevent mouse wheel from changing number input values
document.addEventListener('wheel', e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
    e.target.blur();
  }
}, { passive: false });

// Escape key closes modal / bulk view
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (typeof _bulkIsActive === 'function' && _bulkIsActive()) {
      closeBulkView();
      return;
    }
    closeModal();
    closeImportErrors();
  }
});

// ── App init: open IndexedDB → migrate → load data → render ──────────
(async () => {
  try {
    await _openTjDb();
    await runMigrationIfNeeded();

    // Pre-load all data into memory before first render
    await _initStorageCore();
    await _initOptionStrategiesStorage();
    await _initWotpStorage();
    await _initPlansStorage();
    await _initLlmTradePlansStorage();
    await _initLlmStorage();
    await _initBankingStorage();
    await _initCalendarMonth();

    // Restore persisted settings
    const savedPageSize   = await dbGetSetting('tradePageSize');
    const savedFilterState = await dbGetSetting('filterState');
    if (savedPageSize && [50, 100, 200, 250].includes(savedPageSize)) {
      tradePageSize = savedPageSize;
    }
    if (savedFilterState && typeof _applyFilterSnapshot === 'function') {
      _applyFilterSnapshot(savedFilterState);
    }
  } catch (e) {
    console.error('[TJ] Storage init failed:', e);
    _tjUnavailable = true;
    document.body.inert = true;
    alert('データベースを開けませんでした。データは削除していません。他のタブを閉じて再読み込みしてください。');
    return;
  }

  // Kick off the UI
  initIdeaModal();
  updateFilterBarContext('calendar');
  renderStats();
  renderCalendar();
})();

initScreenshotUI();
