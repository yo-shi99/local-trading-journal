// One history entry per editor session. Back discards drafts without a confirmation.
let tradeEditorNavigation = null;
let tradeEditorReturn = null;
let tradeEditorOpenTicket = 0;
let tradeEditorHistoryClosing = false;

function captureTradeEditorReturn() {
  return { overlayOpen: document.getElementById('day-overlay').classList.contains('open'),
    activeDate, activeWeekStart, activeWeekEnd };
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
  if (!returnTo) return;
  activeDate = returnTo.activeDate; activeWeekStart = returnTo.activeWeekStart; activeWeekEnd = returnTo.activeWeekEnd;
  const overlay = document.getElementById('day-overlay');
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
function completeTradeEditorNavigation() { discardTradeEditorNavigation(); }
window.addEventListener('popstate', event => {
  if (tradeEditorHistoryClosing) {
    tradeEditorHistoryClosing = false;
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
