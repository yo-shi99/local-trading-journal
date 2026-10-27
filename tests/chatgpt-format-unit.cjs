const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {entry,exit,expectedEntry,expectedExit}=require('./chatgpt-format-fixtures.cjs');
const ctx=vm.createContext({structuredClone});
for(const file of ['crypto-journal','trade-events','trade-state','calc','analysis-import','update-import-parser'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file+'.js'),'utf8'),ctx);
const evaluate=(expression,data={})=>{Object.assign(ctx,data);return JSON.parse(JSON.stringify(vm.runInContext(expression,ctx)));};
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
const parsed=evaluate('parseAnalysisText(raw)',{raw:entry});
for(const [key,value] of Object.entries(expectedEntry))test('independent Entry '+key,()=>assert.equal(parsed.fields[key],value));
test('formal Entry numbers, direction, strategy, date and shared legacy fields',()=>{
 assert.equal(parsed.fields.entryPrice,80210);assert.equal(parsed.fields.positionSize,.01);assert.equal(parsed.fields.entryAt,'2026-10-26T22:08');assert.equal(parsed.fields.direction,'Short');assert.equal(parsed.fields.strategy,'Pullback Short');
 assert.equal(parsed.fields.oi,'増加');assert.equal(parsed.fields.fundingRate,'+0.0097');assert.equal(parsed.fields.orderBook,'下側流動性あり');assert.equal(parsed.fields.footprint,'売り優勢');assert.equal(parsed.fields.imbalance,'明確なStackなし');assert.equal(parsed.fields.entryReason,'戻り売り');assert.deepEqual(parsed.unknown,[]);
});
test('shuffled formal Entry fields',()=>assert.deepEqual(evaluate('parseAnalysisText(raw).fields',{raw:entry.split('\n').reverse().join('\n')}),parsed.fields));
test('legacy CVD stays separate from Futures and Spot',()=>{
 const p=evaluate('parseAnalysisText(raw)',{raw:'CVD: 旧値\nFutures CVD: 先物\nSpot CVD: 現物'});assert.equal(p.fields.cvd,'旧値');assert.equal(p.fields.futuresCvd,'先物');assert.equal(p.fields.spotCvd,'現物');
});
test('legacy CVD only introduces no new analysis',()=>{const p=evaluate('parseAnalysisText(raw)',{raw:'銘柄: BTC\nCVD: 旧値'});assert.equal(p.fields.cvd,'旧値');assert.equal(p.fields.futuresCvd,undefined);assert.equal(p.classification.explicit,false);});
for(const type of ['Add Entry','Partial TP','Partial SL','Final Exit'])test(type+' blocked by Entry parser',()=>{const p=evaluate('parseAnalysisText(raw)',{raw:`更新種別: ${type}\nエントリー価格: 10\nFutures CVD: 上書き禁止`});assert.deepEqual(p.fields,{});assert.equal(p.classification.kind,'update');});
for(const type of ['New Entry','NewEntry','new entry'])test(type+' recognized only as Entry',()=>{assert.equal(evaluate('classifyChatgptText(raw)',{raw:`更新種別: ${type}`}).kind,'entry');assert.ok(evaluate('parseUpdateImportText(raw)',{raw:`更新種別: ${type}\n日時: 2026-10-27 12:00\n価格: 1\n数量: 1`}).errors.length);});
for(const raw of ['更新種別: 不明','更新種別:','更新種別: New Entry\n更新種別: Final Exit'])test('unknown or duplicate type rejected '+JSON.stringify(raw),()=>assert.equal(evaluate('classifyChatgptText(raw)',{raw}).kind,'invalid'));
const final=evaluate('parseUpdateImportText(raw)',{raw:exit});
for(const [key,value] of Object.entries(expectedExit))test('independent Exit '+key,()=>assert.equal(final.exitUpdate.analysis[key],value));
test('Final Exit fact, raw, review, reason and result',()=>{assert.deepEqual(final.errors,[]);assert.deepEqual(final.unknown,[]);assert.equal(final.event.realizedPnl,-3.1737);assert.equal(final.event.rawText,exit);assert.equal(final.exitUpdate.review,'SLで全決済');assert.equal(final.exitUpdate.reason,'SL到達');assert.equal(final.exitUpdate.result,'Loss');});
test('Exit analysis never becomes Entry analysis',()=>assert.equal(evaluate('parseAnalysisText(raw)',{raw:'Exit時Futures CVD: Exitのみ'}).fields.futuresCvd,undefined));
test('nonfinal Exit analysis raw only',()=>{const p=evaluate('parseUpdateImportText(raw)',{raw:exit.replace('Final Exit','Partial TP')});assert.deepEqual(p.exitUpdate,{});assert.equal(p.event.rawText.includes('Exit時Spot CVD'),true);assert.ok(p.warnings.some(x=>x.includes('Final Exit')));});
test('future unknown field preserved, never guessed',()=>{const p=evaluate('parseUpdateImportText(raw)',{raw:exit+'\n新指標: 123'});assert.equal(p.event.rawText.endsWith('新指標: 123'),true);assert.deepEqual(p.unknown,[{label:'新指標',value:'123'}]);});
test('invalid optional Entry analysis types rejected; missing accepted',()=>{ctx.a={futuresCvd:3};assert.throws(()=>vm.runInContext('validateOptionalAnalysis(a, ENTRY_ANALYSIS_FIELDS)',ctx));vm.runInContext('validateOptionalAnalysis(undefined, ENTRY_ANALYSIS_FIELDS)',ctx);});
console.log(count+' tests passed');
