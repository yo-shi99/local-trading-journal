// Relative URLs keep the worker inside this repository on GitHub Pages.
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  const pwaBase = new URL('../', document.currentScript.src);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', pwaBase), {
      scope: pwaBase.pathname,
      updateViaCache: 'none',
    }).catch(error => console.warn('[TJ] Offline setup unavailable:', error));
  });
}
