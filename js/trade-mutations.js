// Explicit user edits only. No load-time migration, no derived-state persistence.
function tradeMutationCandidate(trade, targetId, patch, remove = false) {
  const next = structuredClone(trade);
  if (targetId === 'legacy-entry') {
    if(remove)throw new Error('Entryは削除できません。');
    if (!isCryptoTrade(trade)) throw new Error('旧株式取引は従来の手動編集を使用してください。');
    next.cryptoJournal = { ...next.cryptoJournal, ...patch.entryFields };
    validateCryptoJournal(next.cryptoJournal);
    next.date = next.cryptoJournal.entryAt.split('T')[0];
  } else if (targetId === 'summary') {
    if (trade.historyMode !== 'summary' || remove) throw new Error('Final Summaryは編集のみ可能です。削除はできません。');
    next.finalSummary = { ...next.finalSummary, ...patch.summary };
    validateTradeSummary(next);
  } else {
    const index = next.events?.findIndex(e => e.id === targetId) ?? -1;
    if (index < 0) throw new Error('編集対象のeventが見つかりません。');
    const current = next.events[index];
    if (remove) {
      if (current.type === 'Entry') throw new Error('Entry eventは削除できません。取引削除とは分離しています。');
      next.events.splice(index, 1);
    } else {
      if (patch.event?.type !== current.type) throw new Error('編集中eventと更新種別が一致しません。');
      next.events[index] = { ...current, ...patch.event, id: current.id };
    }
    next.events.sort((a,b) => tradeEventTimeKey(a.datetime).localeCompare(tradeEventTimeKey(b.datetime)));
    validateTradeEvents(next.events);
  }
  if (patch.entryFields && targetId !== 'legacy-entry') {
    const target = trade.events?.find(e=>e.id===targetId);
    if (target?.type !== 'Entry') throw new Error('Entry分析の編集対象が不正です。');
    next.cryptoJournal = { ...next.cryptoJournal, ...patch.entryFields };
    validateCryptoJournal(next.cryptoJournal);
  }
  if(patch.entrySymbol !== undefined){
    if((targetId!=='legacy-entry'&&!trade.events?.some(e=>e.id===targetId&&e.type==='Entry'))||typeof patch.entrySymbol!=='string'||!/^[-A-Z0-9/_.:]{1,40}$/.test(patch.entrySymbol))throw new Error('Entry銘柄が無効です。');
    next.symbol=patch.entrySymbol;
  }
  if(patch.entryFields?.direction)next.side=patch.entryFields.direction.toLowerCase();
  if (patch.exitUpdate) {
    next.exitUpdate = { review:'', reason:'', memo:'', ...next.exitUpdate, ...patch.exitUpdate };
    if (patch.exitUpdate.analysis) next.exitUpdate.analysis = { ...trade.exitUpdate?.analysis, ...patch.exitUpdate.analysis };
    validateExitUpdate(next.exitUpdate);
  }
  // Delete may intentionally reopen or expose an inconsistent history. Never repair it.
  return next;
}
async function mutateTradeHistory(tradeId, targetId, patch, expectedRevision, remove = false) {
  const db = await _openTjDb();
  const trade = await new Promise((resolve,reject) => {
    const tx = db.transaction('trades','readwrite'), store = tx.objectStore('trades');
    let updated, failure;
    tx.oncomplete=()=>resolve(updated);
    tx.onabort=()=>reject(failure || tx.error || new Error('保存に失敗しました。'));
    const req = store.get(tradeId);
    req.onsuccess = () => {
      try {
        if (!req.result || updateImportRevision(req.result) !== expectedRevision) throw new Error('取引が別操作で更新されました。開き直してください。');
        updated = tradeMutationCandidate(req.result, targetId, patch, remove);
        store.put(updated);
      } catch(e) { failure=e; try { tx.abort(); } catch (_) { /* already aborted */ } }
    };
  });
  _trades = load().map(t=>t.id===trade.id?trade:t);
  return structuredClone(trade);
}
function getPeriodTradeStats(trades, start, end) {
  const within = date => Boolean(date && date >= start && date <= end);
  const entries = trades.filter(t=>within(getTradeEntryDatetime(t).split('T')[0]));
  const closed = trades.filter(t=>{ const s=getResolvedTradeState(t); return s.isValid && s.status==='Closed' && within(s.lastExitDatetime?.split('T')[0]); });
  const stats = computeStats(closed);
  const pnl = eventStateSum(trades.flatMap(t=>Object.entries(getRealizationsByDate(t)).filter(([d])=>within(d)).map(([,p])=>p)));
  return { ...stats, realizedPnl:pnl, closedTrades:closed.length, be:closed.filter(t=>tradeOutcome(t)==='BE').length, entries, closed };
}

// Manual Entry/legacy form saves use the same optimistic safety as history edits.
function tradeDraftRevision(trade) { return JSON.stringify(trade); }
async function replaceTradeDraftAtomic(candidate, expectedRevision) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('trades', 'readwrite'), store = tx.objectStore('trades');
    let failure, validationFailure=false;
    _tjWriteComplete(tx,()=>resolve(candidate),error=>reject(failure||error));
    const storageFailure=tx.onabort;
    tx.onabort=()=>{if(validationFailure)reject(failure);else storageFailure();};
    const request = store.get(candidate.id);
    request.onsuccess = () => {
      try {
        if (!request.result || tradeDraftRevision(request.result) !== expectedRevision) { validationFailure=true; throw new Error('別操作で取引が更新されました。再度開いて編集してください。'); }
        store.put(candidate);
      } catch (error) { failure = error; try { tx.abort(); } catch (_) { /* already aborted */ } }
    };
  });
}
