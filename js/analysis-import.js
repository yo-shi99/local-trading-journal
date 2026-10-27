/* Local, deterministic parsing of manually copied ChatGPT text. No network/clipboard API. */
let analysisFormGeneration = 0;
let analysisApplied = false;
let analysisPasteTicket = 0;
const analysisEditedFields = new Set();
function analysisImportMarkup() {
  return `<section id="analysis-import" aria-label="ChatGPT解析結果の取り込み">
    <label class="crypto-field" for="crypto-analysis-text">ChatGPT解析結果を貼り付け
      <textarea id="crypto-analysis-text" rows="8" placeholder="更新種別: New Entry&#10;銘柄: BTC&#10;方向: Short&#10;戦略: Breakout&#10;Futures CVD: 下落&#10;Spot CVD: 横ばい&#10;エントリー根拠: レンジ下抜け＋CVD/OI確認"></textarea>
    </label>
    <button type="button" id="analysis-apply">解析してフォームへ反映</button>
    <p class="crypto-hint">貼り付け時に自動反映します。全文はトレードと一緒に保存します。反映後も自由に修正できます。未反映の項目は原文に残ります。価格・数量などの必須項目は確認・補完してください。</p>
    <p id="analysis-status" role="status"></p>
  </section>`;
}
// Only an explicit, unambiguous type switches the workflow. Untyped text stays legacy Entry.
function classifyChatgptText(text) {
  const types = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').match(/^([^:：]{1,80})[:：]\s*(.*)$/);
    if (match && ['更新種別', 'updatetype'].includes(normalizeAnalysisKey(match[1]))) types.push(match[2].replace(/[*`]/g, '').trim());
  }
  if (!types.length) return { kind: 'entry', explicit: false };
  if (types.length !== 1) return { kind: 'invalid', explicit: true };
  const type = types[0].normalize('NFKC').toLowerCase().replace(/\s/g, '');
  if (type === 'newentry') return { kind: 'entry', explicit: true };
  if (['addentry', '追加エントリー', 'partialtp', '部分利確', 'partialsl', '部分損切り', 'finalexit', 'exit', '全決済', '最終決済'].includes(type)) return { kind: 'update', explicit: true };
  return { kind: 'invalid', explicit: true };
}
function normalizeAnalysisKey(key) {
  return key.normalize('NFKC').toLowerCase().replace(/[\s_\-/／・&＆().（）*`]/g, '');
}
const ANALYSIS_ALIASES = new Map();
for (const [key, aliases] of Object.entries({
  symbol: ['銘柄', '通貨', 'symbol', 'ticker', 'asset', 'coin'],
  direction: ['方向', '売買方向', '取引方向', 'Long/Short', 'direction', 'side'],
  entryAt: ['エントリー日時', 'エントリー時間', 'entry datetime', 'entry date', 'entry time', 'entryAt'],
  exitAt: ['決済日時', '決済時間', 'exit datetime', 'exit time', 'exitAt'],
  entryPrice: ['エントリー価格', 'entry price', 'entry'],
  stopLossPrice: ['SL', '損切り', '損切り価格', 'stop loss', 'stop loss price'],
  takeProfitPrice: ['TP', '利確', '利確価格', 'take profit', 'take profit price'],
  positionSize: ['ポジションサイズ', '数量', 'size', 'position size', 'quantity', 'qty'],
  realizedPnl: ['実現損益', '損益', 'PnL', 'P&L', 'realized pnl', 'realised pnl'],
  result: ['結果', '勝敗', 'result', 'outcome', 'Win/Loss/BE'],
  strategy: ['戦略', '戦略タグ', 'strategy', 'strategy tag'],
  priceStructure: ['Price Structure'], keyLevelZone: ['Key Level / Zone', 'Key Level', 'Zone'],
  futuresCvd: ['Futures CVD'], spotCvd: ['Spot CVD'], volume: ['Volume', '出来高'],
  futuresBidAskDelta: ['Futures Bid & Ask Delta'], invalidation: ['Invalidation条件', 'Invalidation'],
  cvd: ['CVD', 'cumulative volume delta'], oi: ['OI', 'open interest', '建玉'],
  fundingRate: ['Funding', 'FR', 'Funding Rate', 'ファンディング', '資金調達率'],
  footprint: ['Footprint', 'フットプリント'],
  imbalance: ['Imbalance', 'Stacked Imbalance', 'Imbalance / Stacked Imbalance', 'インバランス'],
  orderBook: ['Heatmap', 'Order Book', 'Order Book Heatmap', 'Order Book / Heatmap', '板', 'ヒートマップ'],
  marketProfile: ['TPO', 'Market Profile', 'TPO / Market Profile', 'マーケットプロファイル'],
  entryReason: ['エントリー根拠', '根拠', 'entry reason', 'rationale', 'reason'],
  review: ['振り返り', '反省', 'review', 'reflection'],
})) for (const alias of aliases) ANALYSIS_ALIASES.set(normalizeAnalysisKey(alias), key);
function analysisNumber(raw) {
  const value = raw.normalize('NFKC').trim().replace(/−/g, '-');
  const match = value.match(/^(?:[$¥]\s*)?([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?:\s*(?:USDT|USDC|USD|JPY|BTC|ETH|SOL|枚))?$/i);
  if (!match) return undefined;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}
function analysisDate(raw) {
  const value = raw.normalize('NFKC').trim();
  const match = value.match(/^(\d{4})(?:[-/.]|年)(\d{1,2})(?:[-/.]|月)(\d{1,2})日?[T\s]+(\d{1,2})(?::|時)(\d{2})分?$/);
  if (!match) return undefined; // No guessed dates or silent timezone conversion.
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}`;
  return validCryptoDateTime(date) ? date : undefined;
}
function parseAnalysisText(text) {
  const fields = {}, warnings = [], unknown = [];
  const classification = classifyChatgptText(text);
  if (classification.kind !== 'entry') return { fields, warnings: [classification.kind === 'update' ? '更新テキストは既存取引のUpdate Import欄へ貼り付けてください。' : '更新種別が不明または重複しています。'], unknown, classification };
  let current = null;
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '');
    const match = cleaned.match(/^([^:：]{1,80})[:：]\s*(.*)$/);
    if (match) {
      const label = match[1].replace(/[*`]/g, '').trim();
      const key = ANALYSIS_ALIASES.get(normalizeAnalysisKey(label));
      if (['更新種別', 'updatetype'].includes(normalizeAnalysisKey(label))) { current = null; continue; }
      current = key ? { key, label, value: match[2].replace(/^\*\*\s*/, '') } : null;
      if (current) blocks.push(current); else unknown.push(label);
    } else if (current && !/^```/.test(cleaned)) current.value += '\n' + line;
  }
  for (const { key, label, value: body } of blocks) {
    const value = body.trim();
    if (!value) { warnings.push(`${label}（空欄）`); continue; }
    let parsed = value;
    if (['entryPrice', 'stopLossPrice', 'takeProfitPrice', 'positionSize', 'realizedPnl'].includes(key)) {
      parsed = analysisNumber(value);
      if (parsed !== undefined && key !== 'realizedPnl' && parsed <= 0) parsed = undefined;
    } else if (['entryAt', 'exitAt'].includes(key)) parsed = analysisDate(value);
    else if (key === 'direction') {
      parsed = ({ long: 'Long', buy: 'Long', 'ロング': 'Long', '買い': 'Long', short: 'Short', sell: 'Short', 'ショート': 'Short', '売り': 'Short' })[normalizeAnalysisKey(value)];
    } else if (key === 'result') {
      parsed = ({ win: 'Win', '勝ち': 'Win', '勝利': 'Win', loss: 'Loss', lose: 'Loss', '負け': 'Loss', be: 'BE', breakeven: 'BE', '建値': 'BE', '引き分け': 'BE' })[normalizeAnalysisKey(value)];
    } else if (key === 'symbol') {
      parsed = ({ bitcoin: 'BTC', 'ビットコイン': 'BTC', ethereum: 'ETH', 'イーサリアム': 'ETH', solana: 'SOL', 'ソラナ': 'SOL' })[normalizeAnalysisKey(value)] || value.replace(/^[$#]/, '').toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9/_.:-]{0,39}$/.test(parsed)) parsed = undefined;
    } else if (key === 'strategy') {
      parsed = ({ breakout: 'Breakout', 'ブレイクアウト': 'Breakout', sfp: 'SFP', swingfailurepattern: 'SFP',
        absorption: 'Absorption', '吸収': 'Absorption', pullback: 'Pullback', '押し目': 'Pullback', '戻り売り': 'Pullback' })[normalizeAnalysisKey(value)] || value;
    }
    if (parsed === undefined) { warnings.push(`${label}（形式を確認）`); continue; }
    if (Object.hasOwn(fields, key)) warnings.push(`${label}（重複・後の有効な値を採用）`);
    fields[key] = parsed;
  }
  return { fields, warnings, unknown, classification };
}
function analysisOperations(fields) {
  const ops = [];
  const input = (id, value) => ops.push({ key: id, value: String(value), old: document.getElementById(id).value, set: () => { document.getElementById(id).value = value; } });
  const choice = (name, value) => ops.push({ key: name, value, old: selectedCryptoChoice(name), set: () => selectCryptoChoice(name, value) });
  if (fields.symbol !== undefined) {
    const known = ['BTC', 'ETH', 'SOL'].includes(fields.symbol);
    choice('crypto-asset', known ? fields.symbol : 'その他');
    if (!known) input('crypto-symbol-other', fields.symbol);
  }
  if (fields.direction !== undefined) choice('crypto-direction', fields.direction);
  const ids = { entryAt: 'crypto-entry-at', exitAt: 'crypto-exit-at', entryPrice: 'crypto-entry-price', stopLossPrice: 'crypto-sl',
    takeProfitPrice: 'crypto-tp', positionSize: 'crypto-size', realizedPnl: 'crypto-pnl', entryReason: 'crypto-reason', review: 'crypto-review' };
  for (const [key, id] of Object.entries(ids)) if (fields[key] !== undefined) input(id, fields[key]);
  if (fields.result !== undefined) choice('crypto-result', fields.result);
  if (fields.strategy !== undefined) {
    const known = CRYPTO_STRATEGIES.includes(fields.strategy) && fields.strategy !== 'その他';
    choice('crypto-strategy', known ? fields.strategy : 'その他');
    if (!known) input('crypto-strategy-other', fields.strategy);
  }
  for (const [key] of CRYPTO_FLOW_FIELDS) if (fields[key] !== undefined) input('crypto-flow-' + key, fields[key]);
  for (const [key] of ENTRY_ANALYSIS_FIELDS) if (fields[key] !== undefined) input('crypto-analysis-' + key, fields[key]);
  return ops;
}
function applyAnalysisText() {
  if (!cryptoFormActive || cryptoSaving) return;
  const text = document.getElementById('crypto-analysis-text').value;
  const parsed = parseAnalysisText(text);
  const { fields } = parsed;
  if (parsed.classification.kind !== 'entry' || (editingId && parsed.classification.explicit)) {
    document.getElementById('analysis-status').textContent = parsed.classification.kind === 'entry' ? 'New Entryは新規取引画面で登録してください。既存取引には反映しません。' : parsed.warnings.join('\n');
    return;
  }
  // Do not introduce an invalid entry/exit pair into the existing form.
  const entry = fields.entryAt ?? document.getElementById('crypto-entry-at').value;
  const exit = fields.exitAt ?? document.getElementById('crypto-exit-at').value;
  if (entry && exit && exit < entry) {
    for (const key of ['entryAt', 'exitAt']) {
      if (fields[key] !== undefined) {
        delete fields[key];
        parsed.warnings.push(`${key === 'entryAt' ? 'エントリー日時' : '決済日時'}（前後関係を確認）`);
      }
    }
  }
  const operations = analysisOperations(fields);
  const conflicts = operations.filter(op => op.old !== '' && op.old !== op.value && (editingId || analysisApplied || analysisEditedFields.has(op.key)));
  if (conflicts.length && !confirm('解析結果で入力済みの項目を上書きしますか？認識した項目だけを反映します。元の解析テキストは残ります。')) {
    document.getElementById('analysis-status').textContent = '反映をキャンセルしました。各項目は変更していません。原文は保存対象に残ります。';
    return;
  }
  for (const op of operations) op.set();
  if (fields.result !== undefined) cryptoResultManual = true; // Never derive/alter PnL from a qualitative outcome.
  updateCryptoChoices();
  analysisApplied = true;
  const messages = [`${Object.keys(fields).length}項目を反映しました。保存前に内容を確認してください。`];
  if (parsed.warnings.length) messages.push('未反映・注意: ' + parsed.warnings.join('、'));
  if (parsed.unknown.length) messages.push('不明な項目（原文に保持）: ' + parsed.unknown.join('、'));
  if (!operations.length) messages.push('反映できる項目がありません。原文は保存できます。必須項目は手動で入力してください。');
  document.getElementById('analysis-status').textContent = messages.join('\n');
}
function initAnalysisImport(root) {
  document.getElementById('analysis-apply').addEventListener('click', applyAnalysisText);
  root.addEventListener('input', event => {
    if (event.target.id === 'crypto-analysis-text') return;
    analysisEditedFields.add(event.target.name || event.target.id);
  });
  root.addEventListener('change', event => { analysisEditedFields.add(event.target.name || event.target.id); });
  const textarea = document.getElementById('crypto-analysis-text');
  const afterPaste = () => {
    const generation = analysisFormGeneration, ticket = ++analysisPasteTicket;
    setTimeout(() => {
      if (ticket === analysisPasteTicket && generation === analysisFormGeneration && document.getElementById('day-overlay').classList.contains('open') && document.getElementById('trade-form').style.display === 'block') applyAnalysisText();
    }, 0);
  };
  textarea.addEventListener('paste', afterPaste);
  textarea.addEventListener('input', event => { if (event.inputType === 'insertFromPaste') afterPaste(); });
}
function resetAnalysisImport(text = '') {
  analysisFormGeneration++;
  analysisApplied = false;
  analysisEditedFields.clear();
  document.getElementById('crypto-analysis-text').value = text;
  document.getElementById('analysis-status').textContent = '';
}
