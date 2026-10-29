const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c=vm.createContext({structuredClone,document:{getElementById:()=>({addEventListener(){}})}});for(const f of ['crypto-journal','trade-events','trade-state','calc','analysis-import','update-import-parser','exit-update','trade-mutations'])vm.runInContext(fs.readFileSync(__dirname+'/../js/'+f+'.js','utf8'),c);
const run=(expr,data={})=>{Object.assign(c,data);return JSON.parse(JSON.stringify(vm.runInContext(expr,c)));};let count=0;function test(n,f){f();count++;console.log('PASS',n);}
const base={id:'t',symbol:'BTC',date:'2026-10-26',cryptoJournal:{version:1,direction:'Short',entryAt:'2026-10-26T10:00',entryPrice:80000,positionSize:.01,exitAt:'2026-10-27T12:00',realizedPnl:0,result:'Win'}};
const event=(type='Final Exit',p=-1.349)=>({id:'exit',type,datetime:'2026-10-27T12:00',price:79000,quantity:.01,realizedPnl:p,reason:'reason',memo:'memo',rawText:'original'});
for(const mode of ['events','summary','legacy'])for(const pnl of [-1.349,10,0])test(`${mode} result derives from PnL ${pnl} despite conflicting labels`,()=>{let t=structuredClone(base);t.cryptoJournal.realizedPnl=pnl;t.cryptoJournal.result=pnl<0?'Win':'Loss';t.exitUpdate={result:pnl<0?'Win':'Loss',review:'old',reason:'',memo:''};if(mode==='events')t.events=[event('Final Exit',pnl)];if(mode==='summary'){t.historyMode='summary';t.finalSummary={datetime:'2026-10-27T12:00',price:null,realizedPnl:pnl,result:pnl<0?'Win':'Loss',rawText:'summary'};}const expected=pnl>0?'Win':pnl<0?'Loss':'BE';assert.equal(run('getResolvedTradeState(t).result',{t}),expected);assert.equal(run('tradeOutcome(t)',{t}),expected);});
test('Open/Invalid never have a final outcome',()=>{for(const t of [{...base,cryptoJournal:{...base.cryptoJournal,exitAt:''}},{...base,events:[event('Final Exit',-1)],cryptoJournal:{...base.cryptoJournal,positionSize:.001}}])assert.equal(run('getResolvedTradeState(t).result',{t}),'');});
test('same event ID and count survive edit with negative realized PnL',()=>{const t={...base,events:[event()]};const n=run('tradeMutationCandidate(t,"exit",{event:e})',{t,e:{...event(),id:'replacement',realizedPnl:-2}});assert.equal(n.events.length,1);assert.equal(n.events[0].id,'exit');assert.equal(run('getResolvedTradeState(t).result',{t:n}),'Loss');assert.deepEqual(n.cryptoJournal,t.cryptoJournal);assert.equal(t.events[0].realizedPnl,-1.349);});
test('different event type rejects without mutating input',()=>{const t={...base,events:[event()]};Object.assign(c,{t,e:event('Partial SL')});assert.throws(()=>vm.runInContext('tradeMutationCandidate(t,"exit",{event:e})',c));assert.equal(t.events[0].type,'Final Exit');});
test('delete Final Exit reopens and removes realization',()=>{const t={...base,cryptoJournal:{...base.cryptoJournal,exitAt:'',realizedPnl:null},events:[event()]};const n=run('tradeMutationCandidate(t,"exit",{},true)',{t});assert.equal(run('getResolvedTradeState(t).status',{t:n}),'Open');assert.equal(run('getPnl(t)',{t:n}),0);});
test('deleting Add Entry can expose Invalid without silent quantity repair',()=>{const t={...base,cryptoJournal:{...base.cryptoJournal,positionSize:.005},events:[{...event('Add Entry',null),id:'add',datetime:'2026-10-26T11:00',quantity:.005},event()]};const n=run('tradeMutationCandidate(t,"add",{},true)',{t});assert.equal(run('getResolvedTradeState(t).status',{t:n}),'Invalid');assert.equal(n.events[0].quantity,.01);});
test('Entry and Summary deletes are prohibited',()=>{for(const [t,target]of [[{...base,events:[{...event('Entry',null),id:'entry'}]},'entry'],[{...base,historyMode:'summary',finalSummary:{datetime:'2026-10-27T12:00',price:null,realizedPnl:2,result:'Win',rawText:''}},'summary']]){Object.assign(c,{t,target});assert.throws(()=>vm.runInContext('tradeMutationCandidate(t,target,{},true)',c));}});
test('Summary edit replaces final amount and keeps all existing history',()=>{const t={...base,events:[event('Partial SL',-5)],historyMode:'summary',finalSummary:{datetime:'2026-10-27T12:00',price:null,realizedPnl:2,result:'Win',rawText:'old'}};const n=run('tradeMutationCandidate(t,"summary",{summary:{realizedPnl:-3}})',{t});assert.equal(run('getResolvedTradeState(t).realizedPnl',{t:n}),-3);assert.equal(run('getResolvedTradeState(t).result',{t:n}),'Loss');assert.deepEqual(n.events,t.events);});
test('Daily Entry cohort and final exit cohort are separate',()=>{const a={...base,id:'a',events:[{...event('Final Exit',-3.1737),datetime:'2026-10-26T12:00'}]},b={...base,id:'b',events:[event()]};const first=run('getPeriodTradeStats(ts,"2026-10-26","2026-10-26")',{ts:[a,b]});assert.equal(first.entries.length,2);assert.equal(first.closedTrades,1);assert.equal(first.realizedPnl,-3.1737);assert.equal(first.losses,1);const second=run('getPeriodTradeStats(ts,"2026-10-27","2026-10-27")',{ts:[a,b]});assert.equal(second.entries.length,0);assert.equal(second.closedTrades,1);assert.equal(second.realizedPnl,-1.349);assert.equal(second.losses,1);});
test('cross-week Entry and Exit attribution stays separate',()=>{const t={...base,events:[{...event(),datetime:'2026-11-02T12:00'}]};const first=run('getPeriodTradeStats([t],"2026-10-26","2026-11-01")',{t});assert.equal(first.entries.length,1);assert.equal(first.closedTrades,0);assert.equal(first.realizedPnl,0);const second=run('getPeriodTradeStats([t],"2026-11-02","2026-11-08")',{t});assert.equal(second.entries.length,0);assert.equal(second.closedTrades,1);assert.equal(second.realizedPnl,-1.349);});
test('partial realization counts money without counting an Open trade as closed',()=>{const t={...base,events:[{...event('Partial TP',2),quantity:.005}]};const p=run('getPeriodTradeStats([t],"2026-10-27","2026-10-27")',{t});assert.equal(p.realizedPnl,2);assert.equal(p.closedTrades,0);assert.equal(p.wins,0);});

function splitCloseTrade(partialDate='2026-10-26', finalDate='2026-10-27') {
  return {...base,events:[{...event('Partial SL',-2),id:'partial',quantity:.005,datetime:partialDate+'T23:00'},
    {...event('Final Exit',1),quantity:.005,datetime:finalDate+'T09:00'}],exitUpdate:{reason:'',memo:'',review:'',result:'Win'}};
}
function assertCohort(p,pnl,closed,losses) {
  assert.equal(p.realizedPnl,pnl);assert.equal(p.closedTrades,closed);assert.equal(p.wins,0);assert.equal(p.losses,losses);assert.equal(p.be,0);
}
test('cross-day event PnL is -2 then +1, final close cohort is one Loss, never rebook -1',()=>{
  const t=splitCloseTrade();assertCohort(run('getPeriodTradeStats([t],"2026-10-26","2026-10-26")',{t}),-2,0,0);
  assertCohort(run('getPeriodTradeStats([t],"2026-10-27","2026-10-27")',{t}),1,1,1);
  assert.deepEqual(run('[getPnl(t),tradeOutcome(t)]',{t}),[-1,'Loss']);
});
test('cross-week event PnL is -2 then +1, with final Loss attributed only to close week',()=>{
  const t=splitCloseTrade('2026-11-01','2026-11-02');
  assertCohort(run('getPeriodTradeStats([t],"2026-10-26","2026-11-01")',{t}),-2,0,0);
  assertCohort(run('getPeriodTradeStats([t],"2026-11-02","2026-11-08")',{t}),1,1,1);
});
test('Summary books its complete final total once, ignores existing partial realization dates',()=>{
  const t={...splitCloseTrade(),historyMode:'summary',finalSummary:{datetime:'2026-10-28T12:00',price:null,realizedPnl:-1,result:'Win',rawText:'raw'}};
  assertCohort(run('getPeriodTradeStats([t],"2026-10-26","2026-10-27")',{t}),0,0,0);
  assertCohort(run('getPeriodTradeStats([t],"2026-10-28","2026-10-28")',{t}),-1,1,1);
});
test('Legacy books all realized PnL at Exit, never at Entry',()=>{
  const t={...base,cryptoJournal:{...base.cryptoJournal,realizedPnl:-1,result:'Win'}};
  assertCohort(run('getPeriodTradeStats([t],"2026-10-26","2026-10-26")',{t}),0,0,0);
  assertCohort(run('getPeriodTradeStats([t],"2026-10-27","2026-10-27")',{t}),-1,1,1);
});
test('realistic Short baseline + SL/Add/Final -1.349 overrides all stored Win labels without migration',()=>{
  const t={...base,result:'Win',cryptoJournal:{...base.cryptoJournal,entryPrice:80210,result:'Win'},exitUpdate:{reason:'',memo:'',review:'',result:'Win'},events:[
    {...event('Partial SL',-2.1595),id:'sl',quantity:.005,datetime:'2026-10-27T00:20'},
    {...event('Add Entry',null),id:'add',quantity:.005,price:80333.1,datetime:'2026-10-27T01:10'},
    {...event('Final Exit',.8105),quantity:.01,datetime:'2026-10-27T09:03'}]};
  const before=structuredClone(t),state=run('getResolvedTradeState(t)',{t}),stats=run('computeStats([t])',{t});
  assert.equal(state.status,'Closed');assert.equal(state.remainingQuantity,0);assert.equal(state.result,'Loss');assert.ok(Math.abs(state.realizedPnl+1.349)<1e-12);
  assert.equal(stats.wins,0);assert.equal(stats.losses,1);assert.equal(stats.winRate,'0.0');assert.equal(stats.avgWin,null);assert.equal(stats.avgLoss,'1.349');assert.equal(stats.pf,'0.00');assert.deepEqual(t,before);
});
for(const type of ['Partial TP','Partial SL'])test('deleting '+type+' recalculates PnL/quantity and exposes Final Exit inconsistency',()=>{
  const t=splitCloseTrade();t.events[0].type=type;
  const n=run('tradeMutationCandidate(t,"partial",{},true)',{t}),state=run('getResolvedTradeState(t)',{t:n});
  assert.equal(n.events.length,1);assert.equal(n.events[0].quantity,.005);assert.equal(state.remainingQuantity,.005);assert.equal(state.realizedPnl,1);assert.equal(state.status,'Invalid');
});
console.log(count+' tests passed');
