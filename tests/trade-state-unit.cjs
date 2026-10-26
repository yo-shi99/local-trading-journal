// Pure calculation tests: node tests/trade-state-unit.cjs
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const context = vm.createContext({ structuredClone });
for (const file of ['crypto-journal.js', 'trade-events.js', 'trade-state.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
}
let passed = 0, next = 0;
const event = (type, quantity, price = 80000, realizedPnl = null, datetime = '2026-10-27T10:00') =>
  ({ id: 'e' + next++, type, quantity, price, realizedPnl, datetime, reason: '', memo: '' });
const entry = (qty, price = 80000) => event('Entry', qty, price);
const exit = (qty, pnl = null) => event('Final Exit', qty, 81000, pnl);
function calc(events) { context.fixture = events; return vm.runInContext('calculateEventTradeState(fixture)', context); }
function test(name, fn) { fn(); passed++; console.log('PASS', name); }
const near = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-12, 1e-20), `${a} != ${b}`);

test('single entry / final exit', () => {
  const s = calc([entry(.01), exit(.01)]);
  assert.equal(s.status, 'Closed'); assert.equal(s.remainingQuantity, 0); assert.equal(s.totalEntryQuantity, .01);
});
test('weighted Add Entry', () => {
  const s = calc([entry(.01), event('Add Entry', .01, 79000)]);
  assert.equal(s.averageEntryPrice, 79500); assert.equal(s.remainingQuantity, .02); assert.equal(s.addEntryCount, 1);
});
for (const type of ['Partial TP', 'Partial SL']) test(type, () => {
  const s = calc([entry(.02), event(type, .005)]);
  near(s.remainingQuantity, .015); assert.equal(s.status, 'Open');
  assert.equal(s[type === 'Partial TP' ? 'partialTpCount' : 'partialSlCount'], 1);
});
test('multiple exits and +10 -4 +3 = +9', () => {
  const s = calc([entry(.02), event('Partial TP', .005, 82000, 10), event('Partial SL', .005, 79000, -4), exit(.01, 3)]);
  assert.equal(s.status, 'Closed'); assert.equal(s.remainingQuantity, 0); assert.equal(s.realizedPnl, 9);
  assert.equal(s.closedQuantity, .02); assert.equal(s.partialTpCount, 1); assert.equal(s.partialSlCount, 1);
});
test('zero is recorded, null is omitted, entry-side PnL ignored', () => {
  const e = entry(3); e.realizedPnl = 1000;
  const s = calc([e, event('Partial TP', 1, 5, 0), event('Partial SL', 1, 5, null)]);
  assert.equal(s.realizedPnl, 0); assert.equal(s.realizedPnlEventCount, 1); assert.equal(s.missingRealizedPnlCount, 1);
});
test('all null exit PnLs return zero with explicit missing count', () => {
  const s = calc([entry(1), exit(1)]); assert.equal(s.realizedPnl, 0); assert.equal(s.missingRealizedPnlCount, 1);
});
test('0.1 - 0.03 - 0.07 closes within relative epsilon', () => {
  const s = calc([entry(.1), event('Partial TP', .03), exit(.07)]);
  assert.equal(s.status, 'Closed'); assert.equal(s.remainingQuantity, 0); assert.ok(Math.abs(s.rawRemainingQuantity) <= s.epsilon);
});
test('tiny valid open quantity is not rounded to zero', () => {
  const s = calc([entry(1e-15)]); assert.equal(s.status, 'Open'); assert.equal(s.remainingQuantity, 1e-15);
});
test('true negative quantity is retained and flagged', () => {
  const s = calc([entry(.01), exit(.02)]);
  assert.equal(s.status, 'Invalid'); assert.equal(s.isValid, false); assert.equal(s.remainingQuantity, -.01);
  assert.ok(s.issues.some(i => i.code === 'EXIT_EXCEEDS_ENTRY'));
});
test('small but meaningful over-exit is not hidden by epsilon', () => {
  const s = calc([entry(.1), exit(.100000000001)]);
  assert.equal(s.status, 'Invalid'); assert.ok(s.remainingQuantity < 0);
});
test('Final Exit under-closes: mismatch without changing input', () => {
  const events = [entry(.02), exit(.01)], before = structuredClone(events), s = calc(events);
  assert.equal(s.status, 'Invalid'); assert.equal(s.remainingQuantity, .01);
  const issue = s.issues.find(i => i.code === 'FINAL_EXIT_QUANTITY_MISMATCH');
  assert.equal(issue.expectedQuantity, .02); assert.equal(issue.actualQuantity, .01); assert.deepEqual(events, before);
});
test('earlier over-exit cannot be hidden by later Entry', () => {
  const s = calc([event('Partial TP', .01, 80000, null, '2026-10-27T09:00'), entry(.01)]);
  assert.equal(s.remainingQuantity, 0); assert.equal(s.status, 'Invalid');
});
test('unsorted inputs sorted for calculation only, latest exit wins', () => {
  const first = entry(.02); first.datetime = '2026-10-27T09:00';
  const events = [event('Partial SL', .005, 77000, -4, '2026-10-27T12:00'), first,
    event('Partial TP', .005, 82000, 10, '2026-10-27T11:00')];
  const before = structuredClone(events), s = calc(events);
  assert.equal(s.lastExitDatetime, '2026-10-27T12:00'); assert.equal(s.lastExitPrice, 77000);
  assert.equal(s.isValid, true); assert.deepEqual(events, before);
});
test('same-time last exit uses stored array order deterministically', () => {
  const events = [entry(.02), event('Partial TP', .005, 82000, 1), event('Partial SL', .005, 79000, -1)];
  for (let i = 0; i < 5; i++) assert.equal(calc(events).lastExitPrice, 79000);
});
test('same-time exit before entry is invalid', () => { assert.equal(calc([exit(1), entry(1)]).isValid, false); });
test('Entry after partial exit uses all entry fills for specified lifetime average', () => {
  const s = calc([entry(.02, 80000), event('Partial TP', .01), event('Add Entry', .01, 77000)]);
  near(s.averageEntryPrice, 79000); near(s.remainingQuantity, .02);
});
test('compensated realized PnL sum handles decimal cancellation', () => {
  const s = calc([entry(3), event('Partial TP', 1, 1, .1), event('Partial TP', 1, 1, .2), exit(1, -.3)]);
  assert.ok(Math.abs(s.realizedPnl) <= Number.EPSILON); assert.equal(s.status, 'Closed');
});
test('empty event calculation has no invented fills', () => {
  const s = calc([]); assert.equal(s.averageEntryPrice, null); assert.equal(s.lastExitPrice, null); assert.equal(s.remainingQuantity, 0);
});
for (const [name, change] of [
  ['negative quantity', e => { e.quantity = -1; }], ['string quantity', e => { e.quantity = '1'; }],
  ['invalid date', e => { e.datetime = '2026-02-30T10:00'; }], ['nonfinite PnL', e => { e.realizedPnl = Infinity; }],
]) test(name + ' is invalid, not a legacy fallback', () => {
  const e = entry(1); change(e); const s = calc([e]); assert.equal(s.status, 'Invalid'); assert.equal(s.remainingQuantity, null);
});
test('null history is invalid', () => { assert.equal(calc(null).status, 'Invalid'); });
test('overflow is flagged', () => {
  const s = calc([entry(Number.MAX_VALUE), entry(Number.MAX_VALUE)]);
  assert.equal(s.status, 'Invalid'); assert.ok(s.issues.some(i => i.code === 'NUMERIC_OVERFLOW'));
});
test('direction does not change quantities or stored PnL', () => {
  const events = [entry(.01), exit(.01, -2)]; context.eventsFixture = events;
  const states = ['Long', 'Short'].map(direction => {
    context.tradeFixture = { events, cryptoJournal: { direction } };
    return JSON.stringify(vm.runInContext('getTradeState(tradeFixture)', context));
  }); assert.equal(states[0], states[1]);
});
console.log(`${passed} tests passed`);
