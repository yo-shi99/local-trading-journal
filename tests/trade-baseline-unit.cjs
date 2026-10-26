const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ structuredClone });
for (const name of ['crypto-journal', 'trade-events', 'trade-state']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
const event = (type, quantity, i = 0, price = 80000) => ({ id: 'e' + i, type, quantity, price, realizedPnl: 0,
  datetime: `2026-10-27T${11 + i}:00`, reason: '', memo: '' });
const crypto = { id: 'test', cryptoJournal: { version: 1, direction: 'Short', entryPrice: 80000, positionSize: .01, entryAt: '2026-10-27T10:00' } };
const calc = trade => { context.fixture = trade; return vm.runInContext('getTradeState(fixture)', context); };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS', name); }
test('legacy crypto baseline + Partial TP', () => {
  const s = calc({ ...crypto, events: [event('Partial TP', .005)] });
  assert.equal(s.baselineUsed, true); assert.equal(s.totalEntryQuantity, .01); assert.equal(s.remainingQuantity, .005); assert.equal(s.status, 'Open');
});
test('legacy baseline + Partial SL + Final Exit', () => {
  const s = calc({ ...crypto, cryptoJournal: { ...crypto.cryptoJournal, positionSize: .02 }, events: [event('Partial SL', .005), event('Final Exit', .015, 1)] });
  assert.equal(s.remainingQuantity, 0); assert.equal(s.status, 'Closed');
});
test('Add Entry alone uses baseline as explicitly requested', () => {
  const s = calc({ ...crypto, events: [event('Add Entry', .01, 0, 79000)] });
  assert.equal(s.totalEntryQuantity, .02); assert.equal(s.averageEntryPrice, 79500); assert.equal(s.addEntryCount, 1);
});
test('explicit Entry suppresses baseline even if old quantity differs', () => {
  const s = calc({ ...crypto, events: [event('Entry', .02), event('Partial TP', .005, 1)] });
  assert.equal(s.baselineUsed, undefined); assert.equal(s.totalEntryQuantity, .02); assert.equal(s.remainingQuantity, .015);
});
test('baseline excess Exit remains Invalid and negative', () => {
  const s = calc({ ...crypto, events: [event('Final Exit', .02)] });
  assert.equal(s.status, 'Invalid'); assert.equal(s.remainingQuantity, -.01); assert.equal(s.issues[0].index, 0);
});
test('reading baseline never modifies original fields or event list', () => {
  const t = { ...crypto, events: [event('Partial TP', .005)] }, before = structuredClone(t);
  calc(t); calc(t); assert.deepEqual(t, before); assert.equal(t.events.length, 1);
});
test('invalid entry price prevents baseline', () => {
  const s = calc({ ...crypto, cryptoJournal: { ...crypto.cryptoJournal, entryPrice: 0 }, events: [event('Partial TP', .005)] });
  assert.equal(s.baselineUsed, undefined); assert.equal(s.status, 'Invalid');
});
test('invalid entry quantity prevents baseline', () => {
  const s = calc({ ...crypto, cryptoJournal: { ...crypto.cryptoJournal, positionSize: null }, events: [event('Partial TP', .005)] });
  assert.equal(s.baselineUsed, undefined); assert.equal(s.status, 'Invalid');
});
test('missing entry datetime prevents ambiguous crypto baseline', () => {
  const s = calc({ ...crypto, cryptoJournal: { ...crypto.cryptoJournal, entryAt: '' }, events: [event('Partial TP', .005)] });
  assert.equal(s.baselineUsed, undefined); assert.equal(s.status, 'Invalid');
});
test('Exit before legacy entry time remains invalid', () => {
  const s = calc({ ...crypto, events: [{ ...event('Partial TP', .005), datetime: '2026-10-27T09:00' }] });
  assert.equal(s.status, 'Invalid'); assert.ok(s.issues.some(i => i.code === 'EXIT_EXCEEDS_ENTRY'));
});
test('legacy flat fields use date-only baseline without persistence', () => {
  const s = calc({ entryPrice: '80000', quantity: '0.01', side: 'short', date: '2026-10-27', events: [event('Partial TP', .005)] });
  assert.equal(s.status, 'Open'); assert.equal(s.remainingQuantity, .005); assert.equal(s.baseline.source, 'legacy');
});
for (const action of ['buy', 'sell']) test(action + ' opening legs baseline respects direction', () => {
  const s = calc({ legs: [{ action, price: 80000, quantity: .01, date: '2026-10-27T10:00' }], events: [event('Partial TP', .005)] });
  assert.equal(s.status, 'Open'); assert.equal(s.remainingQuantity, .005); assert.equal(s.baseline.source, 'openingLegs');
});
test('malformed history never silently becomes a legacy baseline', () => {
  const s = calc({ ...crypto, events: [{ ...event('Partial TP', .005), quantity: '1' }] });
  assert.equal(s.status, 'Invalid'); assert.equal(s.baselineUsed, undefined); assert.equal(s.issues[0].code, 'INVALID_EVENTS');
});
console.log(`${passed} tests passed`);
