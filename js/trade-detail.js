// A dedicated trade destination; period dialogs contain summaries and links only.
let activeTradeDetailId = null, tradeDetailToken = null, eventEditDraft = null;
let eventEditBusy = false, detailHistoryClosing = false, tradeDetailOrigin = null, pendingDetailOpen = null, pendingDetailClose = false;
function tradeModeLabel(trade) { const s=getResolvedTradeState(trade); return s.source==='summary'?'Summary':s.source==='legacy'?'Legacy':'Full History'; }
function openTradeDetail(id) {
  const trade=load().find(t=>t.id===id); if(!trade)return;
  if(detailHistoryClosing){pendingDetailOpen=id;return;}
  if(tradeEditorHistoryClosing){savedTradeDetailPending=id;return;}
  if(eventEditDraft || hasTradeEditorNavigation())return;
  if(!activeTradeDetailId){tradeDetailOrigin=captureTradeEditorReturn();tradeDetailToken='detail-'+uid();history.pushState({...history.state,tjTradeDetail:tradeDetailToken},'',location.href);}
  activeTradeDetailId=id;renderTradeDetail();
}
function renderTradeDetail() {
  if(!activeTradeDetailId)return;
  const t=load().find(t=>t.id===activeTradeDetailId);if(!t)return;
  const s=getResolvedTradeState(t),entry=t.events?.find(e=>e.type==='Entry'),v=n=>escHtml(String(n??'—'));
  const root=document.getElementById('trade-detail-overlay');root.classList.add('open');
  root.innerHTML=`<article class="modal trade-detail"><header class="modal-hdr"><div><h2>Trade Detail · ${v(t.symbol)} / ${v(t.cryptoJournal?.direction||t.side)}</h2><p>${v(s.status)} · ${tradeModeLabel(t)}</p><strong class="ti-pnl">${s.isValid?(s.realizedPnl<0?'-':'')+'$'+(isCryptoTrade(t)||hasResolvedTradeState(t)?journalAmount(s.realizedPnl,[t]):Math.abs(s.realizedPnl).toFixed(2)):'—'}</strong> <span>${v(s.result)}</span></div><button class="close-btn" data-detail-action="close" aria-label="Close Trade Detail">×</button></header>
    <div class="detail-content"><section><h3>Entry</h3><p>${v(getTradeEntryDatetime(t))} · Price ${v(entry?.price??t.cryptoJournal?.entryPrice??t.entryPrice)} · Qty ${v(entry?.quantity??t.cryptoJournal?.positionSize??t.quantity)}</p><button data-detail-action="entry">Entry / Analysisを編集</button></section>
    ${isCryptoTrade(t)?'<button data-detail-action="entry-text">Entryをテキストで編集</button>':''}<button data-detail-action="entry-analysis">Entry分析・画像を手動編集</button>${cryptoTradeDetails(t)}
    ${tradeStateAndEventsHtml(t)}
    ${!hasResolvedTradeState(t)?resolvedTradeSummaryHtml(t):''}
    ${t.historyMode==='summary'?'<button data-detail-action="summary">Final Summaryを編集</button>':''}
    ${exitUpdateDetailsHtml(t)}${screenshotsHtml(t)}
    <section><h3>ChatGPT取引テキスト</h3><p>新しい更新を追加します。既存履歴の修正には各eventの「編集」を使ってください。</p><button data-detail-action="append">更新を追加 / Unified Import</button></section>
    <div id="event-editor-host"></div></div></article>`;
  root.onclick=async e=>{
    const action=e.target.closest('[data-detail-action]')?.dataset.detailAction;
    if(action==='close')closeTradeDetail();
    if(action==='entry')editTradeEntry();
    if(action==='entry-analysis')editTradeEntry('fields');
    if(action==='append')editTradeEntry('append');
    if(action==='entry-text')openEventEditor(tradeEntryTarget());
    if(action==='summary')openEventEditor('summary');
    const edit=e.target.closest('[data-event-edit]');if(edit)openEventEditor(edit.dataset.eventEdit);
    const del=e.target.closest('[data-event-delete]');if(del)await deleteSavedEvent(del.dataset.eventDelete);
  };
  scheduleScreenshotCleanup();
}
function closeTradeDetail(consume=true){
  if(tradeEditorHistoryClosing){pendingDetailClose=true;return;}
  if(eventEditDraft){closeEventEditor(consume);return;}
  activeTradeDetailId=null;
  if(tradeDetailOrigin?.overlayOpen){document.getElementById('modal-title').textContent=tradeDetailOrigin.title;document.getElementById('modal-sub').textContent=tradeDetailOrigin.subtitle;activeDate=tradeDetailOrigin.activeDate;activeWeekStart=tradeDetailOrigin.activeWeekStart;activeWeekEnd=tradeDetailOrigin.activeWeekEnd;refreshCurrentModal();document.getElementById('day-overlay').classList.add('open');}
  tradeDetailOrigin=null;document.getElementById('trade-detail-overlay').classList.remove('open');
  document.getElementById('trade-detail-overlay').innerHTML='';scheduleScreenshotCleanup();
  if(consume&&history.state?.tjTradeDetail===tradeDetailToken){detailHistoryClosing=true;history.back();}
  tradeDetailToken=null;
}
function editTradeEntry(mode='entry'){
  if(!activeTradeDetailId)return;
  const explicit=load().find(t=>t.id===activeTradeDetailId)?.events?.find(e=>e.type==='Entry');
  if(mode==='entry'&&explicit){openEventEditor(explicit.id);return;}
  prepareTradeEditorNavigation();
  document.body.classList.add('detail-editing');
  document.getElementById('day-overlay').classList.add('open');
  showForm(activeTradeDetailId);
  if(explicit)for(const key of ['crypto-entry-at','crypto-entry-price','crypto-size'])document.getElementById(key).readOnly=true;
  document.getElementById('form-title').textContent=mode==='append'?'更新を追加':'Entry / Trade編集';
  if(mode==='append')document.getElementById('update-import-text').focus();
}
const EVENT_EDIT_FIELDS=[['datetime','日時','datetime-local'],['price','価格','number'],['quantity','数量','number'],['realizedPnl','実現損益','number'],['reason','理由','text'],['memo','メモ','text']];
function openEventEditor(target){
  if(eventEditBusy||eventEditDraft||hasTradeEditorNavigation())return;
  const trade=load().find(t=>t.id===activeTradeDetailId),summary=target==='summary';
  const event=summary?trade.finalSummary:target==='legacy-entry'?{type:'Entry',datetime:trade.cryptoJournal.entryAt,price:trade.cryptoJournal.entryPrice,quantity:trade.cryptoJournal.positionSize,realizedPnl:null,reason:trade.cryptoJournal.entryReason||'',memo:trade.cryptoJournal.review||'',rawText:trade.cryptoJournal.analysisText||''}:trade.events?.find(e=>e.id===target);if(!event)return;
  eventEditDraft={tradeId:trade.id,target,type:summary?'Final Summary':event.type,revision:updateImportRevision(trade),
    entryFields:{},entrySymbol:null,event:structuredClone(event),exitUpdate:structuredClone(trade.exitUpdate||{reason:'',memo:'',review:''}),rawText:event.rawText||'',preview:null};
  history.pushState({...history.state,tjEventEditor:true},'',location.href);renderEventEditor();
}
function renderEventEditor(){
  const d=eventEditDraft,summary=d.target==='summary',v=x=>escHtml(String(x??''));
  const fields=EVENT_EDIT_FIELDS.filter(([k])=>!summary||k!=='quantity');
  document.getElementById('event-editor-host').innerHTML=`<section id="event-editor" class="event-editor"><h3>${v(d.type)}を編集（既存IDを更新）</h3>
    <label>ChatGPT取引テキスト<textarea id="event-edit-text" rows="8">${v(d.rawText)}</textarea></label><button id="event-edit-analyse">解析して確認</button>
    ${fields.map(([key,label,type])=>`<label>${label}<input id="event-edit-${key}" type="${type}" step="any" value="${v(summary&&['reason','memo'].includes(key)?d.exitUpdate[key]:d.event[key])}"></label>`).join('')}
    ${['Final Exit','Final Summary'].includes(d.type)?`<label>振り返り<textarea id="event-edit-review">${v(d.exitUpdate.review)}</textarea></label>${EXIT_ANALYSIS_FIELDS.map(([key,label])=>`<label>${label}<textarea id="event-edit-${key}">${v(d.exitUpdate.analysis?.[key])}</textarea></label>`).join('')}`:''}
    <p>ResultはClosed時の最終実現損益から自動判定します。</p><pre id="event-edit-preview" role="status"></pre><button id="event-edit-preview-button">変更を確認</button><button id="event-edit-save" disabled>変更を保存</button><button id="event-edit-cancel">Cancel</button></section>`;
  document.getElementById('event-edit-analyse').onclick=analyseEventEdit;
  document.getElementById('event-edit-preview-button').onclick=previewEventEdit;
  document.getElementById('event-edit-save').onclick=saveEventEdit;
  document.getElementById('event-edit-cancel').onclick=()=>closeEventEditor();
  document.getElementById('event-editor').oninput=()=>{d.preview=null;document.getElementById('event-edit-save').disabled=true;};
  document.getElementById('event-editor').scrollIntoView({block:'start'});
}
function analyseEventEdit(){
  const d=eventEditDraft,raw=document.getElementById('event-edit-text').value;
  try{
    let e,exit={},notices=[];
    if(d.type==='Entry'){
      const p=parseAnalysisText(raw);if(p.classification.kind!=='entry'||!p.classification.explicit)throw new Error('Entryの編集には更新種別: New Entryが必要です。');
      d.entrySymbol=p.fields.symbol??null;d.entryFields=entryImportFields(p.fields,raw,load().find(t=>t.id===d.tradeId),d.target);
      e={type:'Entry',datetime:p.fields.entryAt,price:p.fields.entryPrice,quantity:p.fields.positionSize,realizedPnl:d.event.realizedPnl,reason:p.fields.entryReason??d.event.reason,memo:p.fields.review??d.event.memo};
      if(!e.datetime||!e.price||!e.quantity)throw new Error('Entry日時・価格・数量が必要です。');
    }else{
      const p=parseUpdateImportText(raw);notices=[...p.warnings,...p.unknown.map(x=>'未認識項目（原文に保持）: '+x.label)];if(p.errors.length)throw new Error(p.errors.join('\n'));
      e=d.target==='summary'?p.summary:p.event;exit=p.exitUpdate;
      if((p.summary?'Final Summary':p.event.type)!==d.type)throw new Error('編集中eventと更新種別が一致しません。');
    }
    d.parseNotice=notices.join('\n');d.rawText=raw;d.event={...d.event,...e,rawText:raw};d.exitUpdate={...d.exitUpdate,...exit,analysis:{...d.exitUpdate.analysis,...exit.analysis}};
    renderEventEditor();previewEventEdit();
  }catch(e){document.getElementById('event-edit-preview').textContent=e.message;document.getElementById('event-edit-save').disabled=true;d.preview=null;}
}
function readEventEditPatch(){
  const d=eventEditDraft,summary=d.target==='summary',event={...d.event};
  if(document.getElementById('event-edit-text').value!==d.rawText)throw new Error('貼り付けテキストを先に解析してください。');
  for(const [key] of EVENT_EDIT_FIELDS){
    if(summary&&['quantity','reason','memo'].includes(key))continue;
    const value=document.getElementById('event-edit-'+key).value;
    event[key]=['price','quantity','realizedPnl'].includes(key)?value===''?null:Number(value):value;
  }
  event.rawText=d.rawText;
  const patch=summary?{summary:event}:{event};
  if(d.type==='Entry'&&isCryptoTrade(load().find(t=>t.id===d.tradeId))){patch.entryFields={...d.entryFields};if(d.entrySymbol)patch.entrySymbol=d.entrySymbol;if(d.target==='legacy-entry')Object.assign(patch.entryFields,{entryAt:event.datetime,entryPrice:event.price,positionSize:event.quantity,entryReason:event.reason,review:event.memo});}
  if(['Final Exit','Final Summary'].includes(d.type)){
    patch.exitUpdate={...d.exitUpdate,review:document.getElementById('event-edit-review').value,
      reason:document.getElementById('event-edit-reason').value,memo:document.getElementById('event-edit-memo').value,
      analysis:Object.fromEntries(EXIT_ANALYSIS_FIELDS.map(([key])=>[key,document.getElementById('event-edit-'+key).value]))};
    if(summary){patch.summary.result=event.realizedPnl>0?'Win':event.realizedPnl<0?'Loss':'BE';}
  }
  return patch;
}
function previewEventEdit(){
  try{
    const d=eventEditDraft,trade=load().find(t=>t.id===d.tradeId),patch=readEventEditPatch();
    const next=tradeMutationCandidate(trade,d.target,patch),s=getResolvedTradeState(next);
    d.preview={patch,proof:JSON.stringify(patch)};
    document.getElementById('event-edit-preview').textContent=`${s.status} · ${s.result}\nRealized P&L ${s.realizedPnl}\nRemaining ${s.remainingQuantity??'不明'}${s.issues.length?'\n警告: '+s.issues.map(i=>i.code).join(', '):''}${d.parseNotice?'\n'+d.parseNotice:''}`;
    document.getElementById('event-edit-save').disabled=false;
  }catch(e){eventEditDraft.preview=null;document.getElementById('event-edit-preview').textContent=e.message;document.getElementById('event-edit-save').disabled=true;}
}
async function saveEventEdit(){
  const d=eventEditDraft;if(eventEditBusy||!d?.preview)return;
  try{
    if(JSON.stringify(readEventEditPatch())!==d.preview.proof)throw new Error('変更内容を再確認してください。');
    eventEditBusy=true;document.getElementById('event-edit-save').disabled=true;
    await mutateTradeHistory(d.tradeId,d.target,d.preview.patch,d.revision);
    if(eventEditDraft===d){eventEditBusy=false;closeEventEditor();}
    refreshTradeManagementViews();
  }catch(e){if(eventEditDraft===d){document.getElementById('event-edit-preview').textContent=e.message;document.getElementById('event-edit-save').disabled=false;}}
  finally{eventEditBusy=false;}
}
function closeEventEditor(consume=true){
  eventEditDraft=null;
  if(consume&&history.state?.tjEventEditor){detailHistoryClosing=true;history.back();}
  renderTradeDetail();
}
async function deleteSavedEvent(target){
  if(eventEditBusy||eventEditDraft)return;
  const t=load().find(t=>t.id===activeTradeDetailId);if(!confirm('このeventを削除しますか？状態・損益を再計算します。'))return;
  try{eventEditBusy=true;await mutateTradeHistory(t.id,target,{},updateImportRevision(t),true);refreshTradeManagementViews();}
  catch(e){alert(e.message);}finally{eventEditBusy=false;}
}
function refreshTradeManagementViews(){renderStats();renderCalendar();if(state.view==='trades')renderTrades();refreshCurrentModal();if(activeTradeDetailId)renderTradeDetail();}
window.addEventListener('popstate',e=>{
  if(detailHistoryClosing){detailHistoryClosing=false;if(pendingDetailOpen){const id=pendingDetailOpen;pendingDetailOpen=null;setTimeout(()=>openTradeDetail(id),0);}return;}
  if(pendingDetailClose){pendingDetailClose=false;setTimeout(()=>closeTradeDetail(),0);return;}
  if(eventEditDraft&&!e.state?.tjEventEditor){closeEventEditor(false);return;}
  if(activeTradeDetailId&&e.state?.tjTradeDetail!==tradeDetailToken&&!hasTradeEditorNavigation())closeTradeDetail(false);
  if(!activeTradeDetailId&&e.state?.tjTradeDetail){const{tjTradeDetail,tjEventEditor,...rest}=e.state;history.replaceState(rest,'',location.href);}
});
document.body.insertAdjacentHTML('beforeend','<div id="trade-detail-overlay" class="overlay" role="dialog" aria-label="Trade Detail"></div>');

function tradeEntryTarget(){return load().find(t=>t.id===activeTradeDetailId)?.events?.find(e=>e.type==='Entry')?.id || 'legacy-entry';}
function entryImportFields(fields,raw,trade,target){
  const c=trade.cryptoJournal;if(!c)return {};
  const patch={analysisText:raw};
  for(const key of ['direction','strategy','entryReason','review','stopLossPrice','takeProfitPrice'])if(fields[key]!==undefined)patch[key]=fields[key];
  if(fields.strategy!==undefined&&!CRYPTO_STRATEGIES.includes(fields.strategy)){patch.strategy='その他';patch.strategyOther=fields.strategy;}
  const flows=Object.fromEntries(CRYPTO_FLOW_FIELDS.filter(([key])=>fields[key]!==undefined).map(([key])=>[key,fields[key]]));
  const analysis=Object.fromEntries(ENTRY_ANALYSIS_FIELDS.filter(([key])=>fields[key]!==undefined).map(([key])=>[key,fields[key]]));
  if(Object.keys(flows).length)patch.orderFlow={...c.orderFlow,...flows};
  if(Object.keys(analysis).length)patch.entryAnalysis={...c.entryAnalysis,...analysis};
  return patch;
}
