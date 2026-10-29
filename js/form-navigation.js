// One history entry per editor session. Back discards drafts without a confirmation.
let tradeEditorNavigation = null;
let tradeEditorReturn = null;
let tradeEditorOpenTicket = 0;
let tradeEditorHistoryClosing = false;

function captureTradeEditorReturn() {
  return { overlayOpen: document.getElementById('day-overlay').classList.contains('open'),
    activeDate, activeWeekStart, activeWeekEnd, title: document.getElementById('modal-title').textContent, subtitle: document.getElementById('modal-sub').textContent, detailId: typeof activeTradeDetailId !== 'undefined' ? activeTradeDetailId : null };
}
function prepareTradeEditorNavigation() {
  if (!tradeEditorNavigation && !tradeEditorReturn) tradeEditorReturn = captureTradeEditorReturn();
  return ++tradeEditorOpenTicket;
}
function isTradeEditorOpenTicket(ticket) { return ticket === tradeEditorOpenTicket; }
function pushTradeEditorHistory() {
  if (!tradeEditorNavigation) return;
  history.pushState({ ...history.state, tjTradeEditor: tradeEditorNavigation.token }, '', location.href);
}
function beginTradeEditorNavigation() {
  if (tradeEditorNavigation) return;
  tradeEditorNavigation = { token: 'trade-editor-' + Date.now() + '-' + tradeEditorOpenTicket,
    returnTo: tradeEditorReturn || captureTradeEditorReturn() };
  tradeEditorReturn = null;
  if (!tradeEditorHistoryClosing) pushTradeEditorHistory();
}
function hasTradeEditorNavigation() { return Boolean(tradeEditorNavigation || tradeEditorReturn); }
function restoreTradeEditorReturn(returnTo) {
  document.body.classList.remove('detail-editing');
  if (!returnTo) return;
  document.getElementById('modal-title').textContent=returnTo.title;document.getElementById('modal-sub').textContent=returnTo.subtitle;
  activeDate = returnTo.activeDate; activeWeekStart = returnTo.activeWeekStart; activeWeekEnd = returnTo.activeWeekEnd;
  const overlay = document.getElementById('day-overlay');
  if (returnTo.detailId) { overlay.classList.remove('open'); renderTradeDetail(); return; }
  if (returnTo.overlayOpen) { refreshCurrentModal(); overlay.classList.add('open'); }
  else overlay.classList.remove('open');
}
function discardTradeEditorNavigation(consumeHistory = true) {
  const navigation = tradeEditorNavigation;
  const returnTo = navigation?.returnTo || tradeEditorReturn;
  tradeEditorNavigation = null; tradeEditorReturn = null; tradeEditorOpenTicket++;
  hideForm(); clearForm();
  restoreTradeEditorReturn(returnTo);
  if (consumeHistory && navigation && history.state?.tjTradeEditor === navigation.token) {
    tradeEditorHistoryClosing = true;
    history.back();
  }
}
let savedTradeDetailPending = null;
function completeTradeEditorNavigation(savedId, isNew = false) {
  const newTrade = savedId && (isNew || !tradeEditorNavigation?.returnTo.detailId);
  discardTradeEditorNavigation();
  if (newTrade) {
    if (tradeEditorHistoryClosing) savedTradeDetailPending = savedId;
    else openTradeDetail(savedId);
  }
}
window.addEventListener('popstate', event => {
  if (tradeEditorHistoryClosing) {
    tradeEditorHistoryClosing = false;
    if (savedTradeDetailPending) { const id = savedTradeDetailPending; savedTradeDetailPending = null; setTimeout(() => openTradeDetail(id), 0); }
    // A fast subsequent open is queued until the previous editor entry is consumed.
    if (tradeEditorNavigation) pushTradeEditorHistory();
    return;
  }
  if (tradeEditorNavigation && event.state?.tjTradeEditor !== tradeEditorNavigation.token) discardTradeEditorNavigation(false);
  else if (!tradeEditorNavigation && event.state?.tjTradeEditor) {
    // Forward/reload must never resurrect discarded, unsaved form contents.
    const { tjTradeEditor, ...rest } = event.state;
    history.replaceState(rest, '', location.href);
  }
});
if (history.state?.tjTradeEditor) {
  const { tjTradeEditor, ...rest } = history.state;
  history.replaceState(rest, '', location.href);
}
