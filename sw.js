// Bump this version whenever any cached file changes.
const CACHE_VERSION = '1.12.0';
const APP_BASE = new URL('./', self.location.href);
const CACHE_PREFIX = `ltj-static:${APP_BASE.pathname}:`;
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const APP_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'version.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'css/styles.css', 'css/base.css', 'css/header.css', 'css/filters.css',
  'css/calendar.css', 'css/trades.css', 'css/option-strategies.css',
  'css/rules-tags-mistakes.css', 'css/daily-plan.css', 'css/reports.css',
  'css/trade-plan.css', 'css/targets.css', 'css/bulk-entry.css', 'css/llm.css',
  'css/llm-trade-plan.css', 'css/signal-intel.css', 'css/banking.css',
  'css/journal-mobile.css',
  'js/db.js', 'js/migration.js', 'js/storage.js', 'js/option-strategies.js',
  'js/wotp-storage.js', 'js/helpers.js', 'js/crypto-journal.js', 'js/trade-events.js', 'js/trade-state.js',
  'js/analysis-import.js', 'js/screenshots.js', 'js/exit-update.js', 'js/update-import-parser.js', 'js/update-import-ui.js', 'js/trade-history-ui.js', 'js/wotp-helpers.js',
  'js/wotp-modal.js', 'js/llm-import.js', 'js/plan.js', 'js/calc.js',
  'js/filters.js', 'js/stats.js', 'js/calendar.js', 'js/trades.js',
  'js/modal.js', 'js/form-navigation.js', 'js/reports.js', 'js/bulk.js', 'js/llm-prompts.js',
  'js/banking.js', 'js/signal-intel.js', 'js/llm-trade-plan.js',
  'js/app.js', 'js/pwa.js',
];
const STATIC_URLS = new Set(APP_FILES.map(file => new URL(file, APP_BASE).href));

self.addEventListener('install', event => {
  // No skipWaiting: keep active editors on one complete version until closed.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...STATIC_URLS].map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  // Only exact, bundled static URLs are cached. No data, APIs, uploads or Blob URLs.
  if (request.method !== 'GET' || !STATIC_URLS.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request.url);
    if (cached) return cached;
    return fetch(request);
  })());
});
