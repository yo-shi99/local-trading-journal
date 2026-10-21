/* ── migration.js ── One-time localStorage → IndexedDB migration ──────
 *
 * Called once during app startup (before any UI renders).
 * Reads every localStorage key used by the app and writes it into the
 * appropriate IndexedDB store.  After a successful migration the flag
 * '_migrated_v1' is set in the settings store so the routine is skipped
 * on every subsequent page load.
 *
 * localStorage keys are intentionally left in place so that old browser
 * tabs / cached pages continue to work gracefully.
 * ───────────────────────────────────────────────────────────────────── */

async function runMigrationIfNeeded() {
  if (await dbGetSetting('_migrated_v1')) return;
  // Read and validate everything before starting a single atomic, non-overwriting merge.
  // On failure, keep both old localStorage and IndexedDB untouched; do not mark complete.
  const stores = {};
  const settings = new Map();
  for (const [oldKey, name] of [
    ['tj-v1', 'trades'], ['tj-tags-v1', 'tags'], ['tj-mistakes-v1', 'mistakes'],
    ['tj-rules-v1', 'rules'], ['ow-ideas-v1', 'ideas'],
    ['tj-llm-trade-plans-v1', 'llmTradePlans'],
  ]) {
    const raw = localStorage.getItem(oldKey);
    if (raw !== null) {
      const records = JSON.parse(raw);
      if (!Array.isArray(records)) throw new Error(`Invalid legacy data: ${oldKey}`);
      stores[name] = records;
    }
  }
  const plans = localStorage.getItem('tj-plans-v1');
  if (plans !== null) {
    const data = JSON.parse(plans);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid legacy plans');
    stores.plans = Object.entries(data).map(([date, html]) => ({ date, html }));
  }
  const queries = localStorage.getItem('ltj_llm_queries');
  if (queries !== null) {
    const data = JSON.parse(queries);
    stores.llmQueries = Array.isArray(data) ? data : data?.queries;
    if (!Array.isArray(stores.llmQueries)) throw new Error('Invalid legacy LLM queries');
    if (Array.isArray(data?.categories)) settings.set('ltj_llm_categories', data.categories);
  }
  const keys = ['ltj_news_config', 'ltj_news_taxonomy', 'ltj_llm_results',
    'ltj_llm_categories', 'tj-cal-month', 'plan-last-view'];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('ltj_prevRptIds_') || key.startsWith('ltj_prevRptGenAt_'))) keys.push(key);
  }
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    settings.set(key, value);
  }
  settings.set('_migrated_v1', true);
  stores.settings = [...settings].map(([key, value]) => ({ key, value }));
  parseJournalBackup({ format: 'local-trading-journal', version: TJ_BACKUP_VERSION,
    databaseVersion: TJ_DB_VERSION, exportedAt: new Date().toISOString(),
    stores: Object.fromEntries(TJ_STORES.map(name => [name, stores[name] || []])) });
  await dbMergeMissing(stores);
}
