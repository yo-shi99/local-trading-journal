/* ── db.js ── IndexedDB core layer ────────────────────────────────────
 *
 * Database: trading-journal-db  (version 5)
 * Object stores:
 *   trades            keyPath: 'id'
 *   tags              keyPath: 'id'
 *   mistakes          keyPath: 'id'
 *   rules             keyPath: 'id'
 *   ideas             keyPath: 'id'
 *   llmTradePlans     keyPath: 'id'
 *   llmQueries        keyPath: 'id'
 *   bankingAccounts   keyPath: 'id'
 *   bankingEntries    keyPath: 'id'
 *   optionStrategies  keyPath: 'id'
 *   plans             keyPath: 'date'   { date:'YYYY-MM-DD', html:'...' }
 *   settings          keyPath: 'key'    { key:'...', value:... }
 *
 * All functions are async and return Promises.
 * ───────────────────────────────────────────────────────────────────── */

const TJ_DB_NAME    = 'trading-journal-db';
const TJ_DB_VERSION = 5;

const TJ_STORES = ['trades', 'tags', 'mistakes', 'rules', 'ideas',
  'llmTradePlans', 'llmQueries', 'bankingAccounts', 'bankingEntries',
  'optionStrategies', 'plans', 'settings'];
let _tjIdb = null;
let _tjOpening = null;
let _tjUnavailable = false;

function _openTjDb() {
  if (_tjUnavailable) return Promise.reject(new Error('データベースを開けませんでした。再読み込みしてください。'));
  if (_tjIdb) return Promise.resolve(_tjIdb);
  if (_tjOpening) return _tjOpening;
  _tjOpening = new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _tjUnavailable = true;
      reject(error);
    };
    // A slow/blocked open must never delete stored data or retry destructively.
    const timer = setTimeout(() => fail(new Error('IndexedDB open timed out')), 4000);
    let req;
    try { req = indexedDB.open(TJ_DB_NAME, TJ_DB_VERSION); }
    catch (error) { fail(error); return; }
    req.onblocked = () => console.warn('[TJ] DB open blocked; close other tabs and reload');
    req.onupgradeneeded = e => {
      if (settled) { req.transaction.abort(); return; }
      const db = e.target.result;
      for (const name of TJ_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'plans' ? 'date' : name === 'settings' ? 'key' : 'id' });
        }
      }
    };
    req.onsuccess = e => {
      const db = e.target.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      _tjIdb = db;
      db.onversionchange = () => {
        db.close();
        _tjIdb = null;
        _tjUnavailable = true;
        document.body.inert = true;
        alert('データベースが別の画面で更新されました。再読み込みしてください。');
      };
      resolve(db);
    };
    req.onerror = () => fail(req.error);
  });
  return _tjOpening;
}

// Resolve writes only after commit, and report failures even when callers log them.
function _tjWriteComplete(tx, resolve, reject) {
  tx.oncomplete = () => resolve();
  const failed = () => {
    const error = tx.error || new Error('IndexedDB transaction aborted');
    // Caches may already contain the failed edit. Prevent subsequent stale saves.
    _tjUnavailable = true;
    document.body.inert = true;
    alert('データを保存できませんでした。変更を再度入力する前に、再読み込みして保存状態を確認してください。');
    reject(error);
  };
  tx.onabort = failed;
}

// Read all stores in one consistent snapshot, including settings omitted by older backups.
async function dbSnapshot() {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TJ_STORES, 'readonly');
    const stores = {};
    for (const name of TJ_STORES) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => { stores[name] = req.result; };
    }
    tx.oncomplete = () => resolve(stores);
    tx.onabort = () => reject(tx.error || new Error('Backup read aborted'));
  });
}

// Add missing keys only: preserve current records. All stores commit or roll back together.
async function dbMergeMissing(stores) {
  const names = Object.keys(stores);
  if (!names.length) return;
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    _tjWriteComplete(tx, resolve, reject);
    try {
      for (const name of names) {
        const store = tx.objectStore(name);
        for (const record of stores[name]) {
          const req = store.getKey(record[store.keyPath]);
          req.onsuccess = () => { if (req.result === undefined) store.add(record); };
        }
      }
    } catch (error) { tx.abort(); }
  });
}

// ── Read helpers ─────────────────────────────────────────────────────

async function dbGetAll(storeName) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Write helpers ────────────────────────────────────────────────────

/** Put a single record (insert or update). */
async function dbPut(storeName, record) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _tjWriteComplete(tx, resolve, reject);
    try { tx.objectStore(storeName).put(record); } catch (error) { tx.abort(); }
  });
}

/** Delete a single record by key. */
async function dbDelete(storeName, key) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _tjWriteComplete(tx, resolve, reject);
    try { tx.objectStore(storeName).delete(key); } catch (error) { tx.abort(); }
  });
}

/**
 * Replace the entire contents of a store in a single transaction.
 * Equivalent to clear() + put(each record).
 */
async function dbReplaceAll(storeName, records) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, 'readwrite');
    } catch (e) {
      reject(e);
      return;
    }
    _tjWriteComplete(tx, resolve, reject);
    try {
      const store = tx.objectStore(storeName);
      store.clear();
      for (const r of records) store.put(r);
    } catch (error) { tx.abort(); }
  });
}

// ── Settings convenience helpers ─────────────────────────────────────

/** Get a named setting value (returns undefined if not set). */
async function dbGetSetting(key) {
  const rec = await dbGet('settings', key);
  return rec !== undefined ? rec.value : undefined;
}

/** Persist a named setting value. */
async function dbPutSetting(key, value) {
  return dbPut('settings', { key, value });
}

/** Remove a named setting. */
async function dbDeleteSetting(key) {
  return dbDelete('settings', key);
}
