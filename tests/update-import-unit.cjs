const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const ctx = vm.createContext({ structuredClone });
for (const file of ['crypto-journal', 'trade-events', 'trade-state', 'calc', 'update-import-parser']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file + '.js'), 'utf8'), ctx);
const base = { id: 'test', symbol: 'BTC', type: 'stock', cryptoJournal: { version: 1, direction: 'Short', entryAt: '2026-10-26T16:00', entryPrice: 80000, positionSize: .01, exitAt: '', realizedPnl: null } };
const text = (type = 'Partial TP', quantity = '.005', pnl = '7.05 USDT', datetime = '2026-10-27 10:15') => `更新種別: ${type}\n日時: ${datetime}\n価格: 78800\n数量: ${quantity} BTC\n実現損益: ${pnl}\n理由: 第一利確\nメモ: 第1TP到達`;
function parse(raw) { ctx.raw = raw; return vm.runInContext('parseUpdateImportText(raw)', ctx); }
function preview(trade, raw) { ctx.trade = trade; ctx.raw = raw; return vm.runInContext('previewUpdateImport(trade, raw)', ctx); }
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS', name); }
for (const [type, aliases] of Object.entries({ 'Add Entry': ['Add Entry', 'AddEntry', '追加エントリー'], 'Partial TP': ['Partial TP', 'PartialTP', '部分利確'],
  'Partial SL': ['Partial SL', 'PartialSL', '部分損切り'], 'Final Exit': ['Final Exit', 'FinalExit', 'Exit', '全決済', '最終決済'] })) {
  for (const alias of aliases) test('type ' + alias, () => { const p = parse(text(alias)); assert.equal(p.errors.length, 0); assert.equal(p.event.type, type); });
}
for (const [label, names, field, expected] of [
  ['日時', ['日時', '約定日時', '決済日時', 'Entry日時', 'Exit日時'], 'datetime', '2026-10-27T10:15'],
  ['価格', ['価格', '約定価格', 'エントリー価格', 'Entry価格', '決済価格', 'Exit価格', 'TP価格', 'SL価格'], 'price', 78800],
  ['数量', ['数量', '決済数量', 'Entry数量', 'ポジションサイズ', 'Qty', 'Size'], 'quantity', .005],
  ['実現損益', ['実現損益', 'Realized P&L', 'Realized PnL', 'P&L', 'PnL'], 'realizedPnl', 7.05],
  ['理由', ['理由', 'Exit理由', 'Entry理由', '利確理由', '損切り理由'], 'reason', '第一利確'],
  ['メモ', ['メモ', '振り返り', 'コメント'], 'memo', '第1TP到達'],
]) for (const name of names) test('alias ' + name, () => { const p = parse(text().replace(label + ':', name + ':')); assert.equal(p.errors.length, 0); assert.equal(p.event[field], expected); });
const actual = `更新種別: Final Exit

決済日時: 2026-10-26 17:41:04
Exit価格: 80339.3
決済数量: 0.01 BTC
実現損益: -3.1737 USDT
結果: Loss
Exit理由: SL到達
SLトリガー価格: 80313
ROE: -3.96%

振り返り: 80,313のSLに到達して全決済。実際の平均決済価格は80,339.3となった。`;
test('required real Final Exit example, seconds, unknown values, review, result and Closed', () => {
  const p = preview(base, actual);
  assert.equal(p.errors.length, 0); assert.equal(p.event.datetime, '2026-10-26T17:41:04');
  assert.equal(p.event.price, 80339.3); assert.equal(p.event.quantity, .01); assert.equal(p.event.realizedPnl, -3.1737);
  assert.equal(p.event.reason, 'SL到達'); assert.ok(p.exitUpdate.review.includes('80,313')); assert.equal(p.exitUpdate.result, 'Loss');
  assert.equal(p.after.status, 'Closed'); assert.equal(p.unknown.length, 2); assert.equal(p.event.rawText, actual);
});
test('Add Entry / Partial TP / Partial SL / Final Exit chain gives average 79500 and +9', () => {
  let trade = structuredClone(base);
  const steps = [['Add Entry', '.01', 'null'], ['Partial TP', '.005', '10'], ['Partial SL', '.005', '-4'], ['Final Exit', '.01', '3']];
  for (let i = 0; i < steps.length; i++) {
    const [type, qty, pnl] = steps[i]; const raw = text(type, qty, pnl, `2026-10-27 ${10 + i}:15`).replace('78800', '79000');
    const p = preview(trade, raw); assert.equal(p.errors.length, 0);
    if (i === 0) { assert.equal(p.after.totalEntryQuantity, .02); assert.equal(p.after.averageEntryPrice, 79500); assert.equal(p.after.remainingQuantity, .02); }
    if (i === 1) assert.equal(p.after.remainingQuantity, .015);
    if (i === 2) assert.equal(p.after.remainingQuantity, .01);
    ctx.trade = trade; ctx.e = { ...p.event, id: 'event-' + i }; trade = structuredClone(vm.runInContext('withTradeEvent(trade, e)', ctx));
    if (i === 3) { assert.equal(p.after.status, 'Closed'); assert.equal(p.after.realizedPnl, 9); }
  }
});
for (const pnl of ['', 'null', '0', '-3.1737', '+7.05']) test('Pnl ' + (pnl || 'blank'), () => {
  const p = preview(base, text('Partial SL', '.005', pnl)); assert.equal(p.errors.length, 0);
  assert.equal(p.event.realizedPnl, pnl === '' || pnl === 'null' ? null : Number(pnl));
});
test('missing PnL is null', () => { assert.equal(parse(text().replace(/実現損益:.*\n/, '')).event.realizedPnl, null); });
for (const type of ['Entry', 'Partial TP / Final Exit', 'たぶん利確']) test('ambiguous type rejected: ' + type, () => assert.ok(parse(text(type)).errors.length));
for (const [label, key] of [['日時', 'datetime'], ['価格', 'price'], ['数量', 'quantity']]) test('missing ' + key, () => {
  const raw = text().split('\n').filter(line => !line.startsWith(label + ':')).join('\n'), p = parse(raw);
  assert.ok(p.errors.some(error => error.includes(key))); assert.equal(p.event.rawText, raw);
});
for (const value of ['0', '-1', '0.005〜0.01', '0.01%', '不明']) test('invalid quantity ' + value, () => assert.ok(parse(text('Partial TP', value)).errors.length));
for (const date of ['2026-02-30 10:15', '2026-10-27 10:15:60', '2026-10-27T10:15:04Z']) test('invalid/ambiguous date ' + date, () => assert.ok(parse(text('Partial TP', '.005', '0', date)).errors.length));
test('shuffled fields and full-width colon with multiline memo', () => {
  const raw = 'Qty：0.005 BTC\nコメント：複数行\n続き\n更新種別：部分利確\nExit価格：78,800 USDT\n決済日時：2026/10/27 10:15:01';
  const p = parse(raw); assert.equal(p.errors.length, 0); assert.equal(p.event.memo, '複数行\n続き'); assert.equal(p.event.price, 78800); assert.equal(p.event.datetime, '2026-10-27T10:15:01');
});
test('memo and review retained independently for Final Exit', () => {
  const p = parse(text('Final Exit', '.01') + '\n振り返り: review');
  assert.ok(p.event.memo.includes('review')); assert.equal(p.exitUpdate.memo, '第1TP到達'); assert.equal(p.exitUpdate.review, 'review');
});
test('duplicate recognized field blocks guessing', () => assert.ok(parse(text() + '\nQty: 0.001 BTC').errors.some(e => e.includes('複数'))));
test('unknown metrics and percentage are retained without mapped price/PnL changes', () => {
  const raw = text() + '\nSLトリガー価格: 80313\nROE: -3.96%'; const p = parse(raw);
  assert.equal(p.errors.length, 0); assert.equal(p.unknown[1].value, '-3.96%'); assert.equal(p.event.price, 78800); assert.equal(p.event.realizedPnl, 7.05); assert.equal(p.event.rawText, raw);
});
test('quantity excess blocks without correction', () => {
  const p = preview(base, text('Partial TP', '.02')); assert.ok(p.errors.length); assert.equal(p.event.quantity, .02); assert.equal(base.cryptoJournal.positionSize, .01);
});
test('Final Exit under-quantity blocks', () => {
  const p = preview(base, text('Final Exit', '.005')); assert.ok(p.errors.some(e => e.includes('一致') || e.includes('MISMATCH'))); assert.equal(p.event.quantity, .005);
});
test('same fact duplicate detected across minute / second-zero precision', () => {
  const e = parse(text()).event; const trade = { ...base, events: [{ ...e, id: 'old', datetime: e.datetime + ':00' }] };
  assert.ok(preview(trade, text()).errors.some(e => e.includes('重複')));
});
test('preview never modifies Entry or history', () => { const before = structuredClone(base); preview(base, actual); assert.deepEqual(base, before); });
test('event seconds validation is separate from Entry minute validator', () => {
  ctx.dateFixture = '2026-10-26T17:41:04'; assert.equal(vm.runInContext('validTradeEventDateTime(dateFixture)', ctx), true);
  assert.equal(vm.runInContext('validCryptoDateTime(dateFixture)', ctx), false);
});
console.log(`${passed} tests passed`);
