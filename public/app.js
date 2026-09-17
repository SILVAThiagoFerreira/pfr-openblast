const form = document.querySelector('#form');
const input = document.querySelector('#inputs');
const list = document.querySelector('#file-list');
const drop = document.querySelector('#dropzone');
const result = document.querySelector('#result');
const button = document.querySelector('#submit');
const statusText = document.querySelector('#status-text');
const statusBox = document.querySelector('.status');
const progress = document.querySelector('#progress');
const progressLabel = document.querySelector('#progress-label');
const progressValue = document.querySelector('#progress-value');
const progressBar = document.querySelector('#progress-bar');
const chargeTargetToggle = document.querySelector('#enable-charge-target');
const chargeTargetSettings = document.querySelector('#charge-target-settings');
const chargeTargetInput = document.querySelector('#charge-target-input');
const chargeTargetError = document.querySelector('#charge-target-error');
const chargeMinimumInput = document.querySelector('#charge-minimum-input');
const chargeMinimumError = document.querySelector('#charge-minimum-error');
const chargeMinimumHoleInput = document.querySelector('#charge-minimum-hole-id');
const chargeMinimumHoleError = document.querySelector('#charge-minimum-hole-error');
const timezoneOffset = document.querySelector('#timezone-offset');
const planIdentityInput = document.querySelector('#plan-identity');
const manualFireTimeInput = document.querySelector('#manual-fire-time');
const manualFireTimeError = document.querySelector('#manual-fire-time-error');
const forceButton = document.querySelector('#force-submit');
let attachedFiles = [];

const REQUIRED_PROJECT = ['Number', 'UTM_X', 'UTM_Y', 'Length_m', 'Stemming_m', 'Diameter_mm', 'Subdrilling_m', 'Angle_deg', 'Azimuth_deg', 'Total_Charge_kg'];
const REQUIRED_FINAL = ['Number', 'X', 'Y', 'Z', 'X_Toe', 'Y_Toe', 'Z_Toe', 'Length', 'Stemming', 'Diameter', 'Subdrilling', 'Angle', 'Azimuth', 'DetonatingTime', 'InputedCharge'];
const OUTPUT_COLUMNS = ['Data', 'Horario', 'Plano', 'Tipo', 'id', 'y', 'x', 'Z (crest)', 'Z (toe)', 'profundidade prevista', 'profundidade realizada', 'azimute', 'inclinacao', 'cargas previstas', 'cargas realizadas', 'tampao previsto', 'tampao realizado', 'subfuracao', 'diametro', 'tempo detonacao (ms)'];
const ALIASES = {
  'UTM X': 'UTM_X', 'UTM Y': 'UTM_Y', 'Length (m)': 'Length_m', 'Stemming (m)': 'Stemming_m',
  'Diameter (mm)': 'Diameter_mm', 'Subdrilling (m)': 'Subdrilling_m', 'Angle (º)': 'Angle_deg',
  'Angle (°)': 'Angle_deg', 'Azimuth (º)': 'Azimuth_deg', 'Azimuth (°)': 'Azimuth_deg',
  'Total_Charge (Kg)': 'Total_Charge_kg'
};
const BUSINESS = {
  type: 'producao', fillMissingTime: true, stemmingVariation: true, stemmingMaxDelta: 0.12,
  redistributeZeroCharges: true, chargeTarget: 17136.048, zeroChargeMinimum: 0.01,
  ...(window.PFR_BROWSER_CONFIG?.business || {})
};

document.querySelector('#year').textContent = new Date().getFullYear();
if (typeof XLSX === 'undefined') {
  statusText.textContent = 'Biblioteca Excel indisponível · recarregue a página';
  statusBox.classList.add('offline');
} else {
  statusText.textContent = 'Online';
}

function renderFiles(files) {
  list.replaceChildren();
  if (!files.length) { list.append(document.createTextNode('Nenhum arquivo selecionado')); return; }
  files.forEach((file, index) => {
    const item = document.createElement('span');
    item.className = 'file';
    const name = document.createElement('span');
    name.textContent = file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-remove';
    remove.setAttribute('aria-label', `Remover ${file.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      attachedFiles = attachedFiles.filter((_, fileIndex) => fileIndex !== index);
      syncInputFiles();
    });
    item.append(name, remove);
    list.append(item);
  });
}

function fileKey(file) { return `${file.name.toLocaleLowerCase()}|${file.size}|${file.lastModified}`; }

function syncInputFiles() {
  const transfer = new DataTransfer();
  attachedFiles.forEach(file => transfer.items.add(file));
  input.files = transfer.files;
  renderFiles(attachedFiles);
  syncActionControls();
}

function syncActionControls() {
  if (forceButton) forceButton.disabled = !attachedFiles.length;
}

function appendFiles(files) {
  const existing = new Set(attachedFiles.map(fileKey));
  for (const file of files) {
    if (!existing.has(fileKey(file))) {
      attachedFiles.push(file);
      existing.add(fileKey(file));
    }
  }
  syncInputFiles();
}

input.addEventListener('change', () => {
  appendFiles([...input.files]);
  input.value = '';
});
['dragenter', 'dragover'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => appendFiles([...e.dataTransfer.files]));
syncActionControls();

function makeClientLog(error, options = {}) {
  const files = attachedFiles.map(file => file.name).join('\n') || '-';
  const offset = timezoneOffset?.value || 'none';
  const identity = options.planIdentity?.raw || '-';
  const fireTime = options.manualFireTime || '-';
  const history = options.histoMissing ? 'não anexado' : 'anexado ou não identificado';
  return `OPENBLAST - LOG DE ERRO\nData: ${new Date().toISOString()}\nModo: processamento online\nConversão de horário: ${offset}\nIdentificação informada: ${identity}\nHorário local informado: ${fireTime}\nHistorial da DRB: ${history}\nExecução forçada: ${options.force ? 'sim' : 'não'}\nArquivos selecionados:\n${files}\n\nErro:\n${error?.stack || error?.message || error}\n`;
}

function setProgress(value, label) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  progress.hidden = false;
  progressLabel.textContent = label;
  progressValue.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
}

function addLogDownload(container, text) {
  const link = document.createElement('a');
  link.className = 'download log-download';
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  link.download = 'openblast-log-erro.txt';
  link.textContent = 'Baixar log local (.txt) →';
  container.append(link);
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  let text = String(value).trim().replace(/\s/g, '');
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function formatKg(value) {
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function setChargeTargetError(message = '') {
  chargeTargetError.textContent = message;
  chargeTargetError.hidden = !message;
  chargeTargetInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function setChargeMinimumError(message = '') {
  chargeMinimumError.textContent = message;
  chargeMinimumError.hidden = !message;
  chargeMinimumInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function setChargeMinimumHoleError(message = '') {
  chargeMinimumHoleError.textContent = message;
  chargeMinimumHoleError.hidden = !message;
  chargeMinimumHoleInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function syncChargeTargetControls() {
  const enabled = chargeTargetToggle.checked;
  chargeTargetSettings.hidden = !enabled;
  chargeTargetSettings.setAttribute('aria-hidden', String(!enabled));
  if (!enabled) {
    setChargeTargetError();
    setChargeMinimumError();
    setChargeMinimumHoleError();
  }
}

function readChargeTarget() {
  if (!chargeTargetToggle.checked) return { enabled: false, target: null, minimum: null, minimumHoleId: '' };
  const target = parseNumber(chargeTargetInput.value);
  const minimum = parseNumber(chargeMinimumInput.value);
  const minimumHoleId = chargeMinimumHoleInput.value.trim();
  let firstError = '';
  if (target === null || target <= 0) {
    setChargeTargetError('Informe um total de carga realizada maior que zero.');
    firstError ||= 'Informe um total de carga realizada maior que zero.';
  } else {
    setChargeTargetError();
  }
  if (minimum === null || minimum <= 0) {
    setChargeMinimumError('Informe uma carga mínima por furo maior que zero.');
    firstError ||= 'Informe uma carga mínima por furo maior que zero.';
  } else {
    setChargeMinimumError();
  }
  if (!minimumHoleId) {
    setChargeMinimumHoleError('Informe o ID do furo que receberá a menor carga.');
    firstError ||= 'Informe o ID do furo que receberá a menor carga.';
  } else {
    setChargeMinimumHoleError();
  }
  if (firstError) {
    throw new Error(firstError);
  }
  return { enabled: true, target, minimum, minimumHoleId };
}

function readTimezoneOffset() {
  const value = timezoneOffset?.value || 'none';
  return value === 'none' ? null : value;
}

function readPlanIdentity() {
  const raw = planIdentityInput?.value.trim() || '';
  return { raw, manualPlanId: window.OpenBlastPlanId.parseManualPlanId(raw) };
}

function setManualFireTimeError(message = '') {
  if (!manualFireTimeError || !manualFireTimeInput) return;
  manualFireTimeError.textContent = message;
  manualFireTimeError.hidden = !message;
  manualFireTimeInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function readManualFireTime() {
  const raw = manualFireTimeInput?.value.trim() || '';
  if (!raw) {
    setManualFireTimeError();
    return '';
  }
  const normalized = window.OpenBlastPlanId.normalizeFireTime(raw);
  if (!normalized) {
    setManualFireTimeError('Use um horário válido no formato HH:MM ou HH:MM:SS.');
    const error = new Error('O horário informado é inválido. Use o formato HH:MM ou HH:MM:SS.');
    error.code = 'INVALID_FIRE_TIME';
    throw error;
  }
  setManualFireTimeError();
  return normalized;
}

chargeTargetToggle.addEventListener('change', syncChargeTargetControls);
chargeTargetInput.addEventListener('input', () => setChargeTargetError());
chargeMinimumInput.addEventListener('input', () => setChargeMinimumError());
chargeMinimumHoleInput.addEventListener('input', () => setChargeMinimumHoleError());
syncChargeTargetControls();

function key(value) {
  const number = parseNumber(value);
  return number === null ? String(value ?? '').trim() : String(number);
}

function normalizeRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [ALIASES[name.trim()] || name.trim(), value])));
}

async function readTable(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['csv', 'xlsx', 'xlsm'].includes(ext)) throw new Error(`Formato de tabela não permitido: ${file.name}`);
  const bytes = await file.arrayBuffer();
  const workbook = ext === 'csv'
    ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string', raw: true })
    : XLSX.read(bytes, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return normalizeRows(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
}

function hasColumns(rows, columns) {
  if (!rows.length) return false;
  const available = new Set(rows.flatMap(row => Object.keys(row)));
  return columns.every(column => available.has(column));
}

function requireColumns(rows, columns, label) {
  const available = new Set(rows.flatMap(row => Object.keys(row)));
  const missing = columns.filter(column => !available.has(column));
  if (!rows.length) throw new Error(`O arquivo ${label} está vazio.`);
  if (missing.length) throw new Error(`${label}: colunas obrigatórias ausentes: ${missing.join(', ')}.`);
}

function decodeText(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

const { extractPlanIds, normalizePlanId, resolvePlanAndFire } = window.OpenBlastPlanId;

function sourcePlanHints(files, parsedTables) {
  const hints = [];
  files.forEach(file => hints.push(...extractPlanIds(file.name)));
  parsedTables.forEach(item => {
    item.rows.slice(0, 20).forEach(row => Object.values(row).forEach(value => hints.push(...extractPlanIds(value))));
  });
  return [...new Set(hints.map(normalizePlanId).filter(Boolean))];
}

async function findSources(files, { allowMissingHistory = false } = {}) {
  setProgress(12, 'Lendo as tabelas e identificando os arquivos...');
  const tables = files.filter(file => /\.(csv|xlsx|xlsm)$/i.test(file.name));
  const parsedTables = await Promise.all(tables.map(async file => {
    try { return { file, rows: await readTable(file) }; } catch (error) { return { file, rows: [], error }; }
  }));
  const namedProject = parsedTables.find(item => /projeto\s*completo/i.test(item.file.name) && hasColumns(item.rows, REQUIRED_PROJECT));
  const namedFinal = parsedTables.find(item => /config\s*final/i.test(item.file.name) && hasColumns(item.rows, REQUIRED_FINAL));
  const projectEntry = namedProject || parsedTables.find(item => hasColumns(item.rows, REQUIRED_PROJECT));
  const finalEntry = namedFinal || parsedTables.find(item => hasColumns(item.rows, REQUIRED_FINAL));
  if (projectEntry && finalEntry && projectEntry.file.name === finalEntry.file.name) {
    throw new Error('Os arquivos de projeto e realizado precisam ser tabelas diferentes.');
  }
  const textFiles = files.filter(file => /\.(?:txt|log)$/i.test(file.name));
  setProgress(30, allowMissingHistory ? 'Lendo as entradas; o histórico pode ser omitido no modo forçado...' : 'Lendo o histórico de disparos...');
  const textCandidates = await Promise.all(textFiles.map(async file => ({ file, text: decodeText(new Uint8Array(await file.arrayBuffer())) })));
  const histoEntry = textCandidates.find(item => /^HISTO-.*\.(?:txt|log)$/i.test(item.file.name))
    || textCandidates.find(item => /histo|historial.*drb/i.test(item.file.name))
    || textCandidates.find(item => /\[\s*Fire\s*\][ \t]*(?:(?:\d{4}\/\d{1,2}\/\d{1,2}-)?\d{1,2}:\d{2}:\d{2})/i.test(item.text));
  const histo = histoEntry?.file;
  const pdf = files.find(file => /\.pdf$/i.test(file.name));
  if (!projectEntry || !finalEntry) throw new Error('Não foi possível identificar as tabelas. Confira se uma contém as colunas do projeto e outra as colunas do realizado.');
  if (!histo && !allowMissingHistory) throw new Error('Envie o Historial da DRB em HISTO-*.txt ou HISTO-*.log.');
  if (!pdf) throw new Error('Envie o PP.pdf.');
  const pdfHeader = decodeText(new Uint8Array(await pdf.slice(0, 5).arrayBuffer()));
  if (!pdfHeader.startsWith('%PDF-')) throw new Error(`O arquivo ${pdf.name} não parece ser um PDF válido.`);
  return { project: projectEntry.file, projectRows: projectEntry.rows, final: finalEntry.file, finalRows: finalEntry.rows, histo, histoText: histoEntry?.text || '', histoMissing: !histo, pdf, planHints: sourcePlanHints(files, parsedTables) };
}

async function sha256(bytes) {
  if (globalThis.crypto?.subtle) return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return new Uint8Array([hash >>> 24, hash >>> 16, hash >>> 8, hash, hash >>> 16, hash >>> 8, hash >>> 24, hash]);
}

async function applyStemmingVariation(values, numbers, planId) {
  if (!BUSINESS.stemmingVariation) return values;
  const result = values.slice();
  const encoder = new TextEncoder();
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] === null || numbers[index] === null) continue;
    const digest = await sha256(encoder.encode(`${planId}:${Math.trunc(numbers[index])}:stemming`));
    const magnitude = (((digest[0] * 0x1000000) + (digest[1] * 0x10000) + (digest[2] * 0x100) + digest[3]) / 0xFFFFFFFF) * BUSINESS.stemmingMaxDelta;
    const sign = digest[4] % 2 ? 1 : -1;
    result[index] = Math.max(0, Math.round((result[index] + sign * magnitude) * 100) / 100);
  }
  return result.map(value => value === null ? null : Math.round(value * 10) / 10);
}

function redistributeZeros(values) {
  const result = values.slice();
  const zeroIndexes = result.map((value, index) => value === 0 ? index : -1).filter(index => index >= 0);
  if (!BUSINESS.redistributeZeroCharges || !zeroIndexes.length) return result;
  const validIndexes = result.map((value, index) => value !== null && value !== 0 ? index : -1).filter(index => index >= 0);
  if (validIndexes.length < 3) throw new Error('Não há furos suficientes para redistribuir a carga zerada preservando os extremos.');
  const minIndex = validIndexes.reduce((best, index) => result[index] < result[best] ? index : best, validIndexes[0]);
  const maxIndex = validIndexes.reduce((best, index) => result[index] > result[best] ? index : best, validIndexes[0]);
  const adjustable = validIndexes.filter(index => index !== minIndex && index !== maxIndex);
  const zeroAllocation = BUSINESS.zeroChargeMinimum * zeroIndexes.length;
  const adjustableTotal = adjustable.reduce((sum, index) => sum + result[index], 0);
  if (!adjustableTotal || zeroAllocation >= BUSINESS.chargeTarget) throw new Error('Não foi possível redistribuir a carga mantendo os extremos.');
  zeroIndexes.forEach(index => { result[index] = BUSINESS.zeroChargeMinimum; });
  adjustable.forEach(index => { result[index] -= (result[index] / adjustableTotal) * zeroAllocation; });
  const remainder = Math.round((values.reduce((sum, value) => sum + (value ?? 0), 0) - result.reduce((sum, value) => sum + (value ?? 0), 0)) * 1000) / 1000;
  result[adjustable[0]] = Math.round((result[adjustable[0]] + remainder) * 1000) / 1000;
  return result;
}

function findUniqueHoleIndex(rows, holeId) {
  const normalizedId = key(holeId);
  const indexes = rows.map((row, index) => key(row.Number) === normalizedId ? index : -1).filter(index => index >= 0);
  if (!indexes.length) {
    throw new Error(`O ID do furo de menor carga "${holeId}" não foi encontrado no plano realizado.`);
  }
  if (indexes.length > 1) {
    throw new Error(`O ID do furo de menor carga "${holeId}" aparece mais de uma vez no plano realizado.`);
  }
  return indexes[0];
}

function buildRows(projectRows, finalRows, event, chargeOptions = {}) {
  const projects = new Map(projectRows.map(row => [key(row.Number), row]));
  const merged = finalRows.map(row => ({ ...(projects.get(key(row.Number)) || {}), ...row }))
    .filter(row => parseNumber(row.eliminated) === null || parseNumber(row.eliminated) === 0)
    .sort((left, right) => (parseNumber(left.Number) ?? 0) - (parseNumber(right.Number) ?? 0));
  const numbers = merged.map(row => parseNumber(row.Number));
  const times = window.OpenBlastTiming.fillMissingTimes(merged.map(row => parseNumber(row.DetonatingTime))).values;
  const rawCharges = merged.map(row => parseNumber(row.InputedCharge));
  const baseCharges = redistributeZeros(rawCharges);
  const positiveIndexes = rawCharges.map((value, index) => value !== null && value > 0 ? index : -1).filter(index => index >= 0);
  let chargeOptionsWithExtremes = chargeOptions;
  if (chargeOptions.enabled) {
    if (positiveIndexes.length < 2) {
      throw new Error('São necessários pelo menos dois furos com carga positiva na planilha para preservar a maior carga.');
    }
    const minimumIndex = findUniqueHoleIndex(merged, chargeOptions.minimumHoleId);
    const maximumIndex = positiveIndexes.reduce((best, index) => rawCharges[index] > rawCharges[best] ? index : best, positiveIndexes[0]);
    chargeOptionsWithExtremes = {
      ...chargeOptions,
      minimumIndex,
      minimumValue: chargeOptions.minimum,
      maximumIndex,
      maximumValue: rawCharges[maximumIndex]
    };
  }
  const charges = chargeOptions.enabled
    ? window.OpenBlastCharge.distributeCharges(baseCharges, chargeOptions.target, chargeOptionsWithExtremes)
    : baseCharges;
  const stemming = applyStemmingVariation(merged.map(row => parseNumber(row.Stemming)), numbers, event.planId);
  return stemming.then(stemmingValues => merged.map((row, index) => {
    const diameterRaw = parseNumber(row.Diameter);
    const diameter = diameterRaw !== null && diameterRaw < 1 ? (diameterRaw * 1000) / 25.4 : diameterRaw;
    return {
      Data: event.date, Horario: event.time, Plano: event.planId, Tipo: BUSINESS.type, id: numbers[index],
      y: parseNumber(row.Y), x: parseNumber(row.X), 'Z (crest)': parseNumber(row.Z), 'Z (toe)': parseNumber(row.Z_Toe),
      'profundidade prevista': parseNumber(row.Length_m ?? row.p_length), 'profundidade realizada': parseNumber(row.Length),
      azimute: parseNumber(row.Azimuth), inclinacao: parseNumber(row.Angle), 'cargas previstas': parseNumber(row.Total_Charge_kg),
      'cargas realizadas': charges[index], 'tampao previsto': parseNumber(row.Stemming_m), 'tampao realizado': stemmingValues[index],
      subfuracao: parseNumber(row.Subdrilling) ?? parseNumber(row.Subdrilling_m), diametro: diameter, 'tempo detonacao (ms)': times[index]
    };
  }));
}

function summarizeChargeDistribution(data, chargeOptions = {}) {
  const values = data.map(row => row['cargas realizadas']);
  if (!values.length || values.some(value => !Number.isFinite(value))) {
    throw new Error('Não foi possível resumir as cargas realizadas após a distribuição.');
  }
  const minimumIndex = chargeOptions.enabled
    ? data.findIndex(row => key(row.id) === key(chargeOptions.minimumHoleId))
    : values.reduce((best, value, index) => value < values[best] ? index : best, 0);
  const maximumIndex = values.reduce((best, value, index) => value > values[best] ? index : best, 0);
  if (minimumIndex < 0) throw new Error('O ID do furo de menor carga não foi encontrado na saída.');
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    minimum: values[minimumIndex],
    minimumHoleId: data[minimumIndex].id,
    maximum: values[maximumIndex],
    maximumHoleId: data[maximumIndex].id
  };
}

function buildWorkbook(data, sources, event, chargeOptions = {}, chargeSummary = null) {
  const sheet = XLSX.utils.json_to_sheet(data, { header: OUTPUT_COLUMNS });
  sheet['!cols'] = [14, 12, 12, 12, 10, 12, 12, 12, 12, 18, 18, 12, 12, 16, 16, 16, 16, 12, 12, 18].map(width => ({ wch: width }));
  const summaryRows = [
    ['Campo', 'Valor'], ['Plano', event.planId], ['Data', event.date], ['Hora', event.time],
    ['Fuso horário', event.timezoneOffset || (event.timeSource ? 'Não convertido — horário local informado' : 'Horário original do HISTO')],
    ['Fonte da data', event.dateSource === 'browser' ? 'Data local do navegador no momento da execução' : 'HISTO'],
    ['Historial da DRB', event.historySource === 'missing' ? 'Não anexado — execução forçada' : 'Anexado'],
    ['Fonte do horário', event.timeSource === 'force-default' ? 'Fallback da execução forçada — 12:00:00' : event.timeSource === 'manual' ? 'Horário informado pelo usuário' : 'HISTO'],
    ['Modo de execução', event.forced ? 'Forçada' : 'Validação automática']
  ];
  if (event.planIdentity) summaryRows.push(['Identificação informada', event.planIdentity]);
  if (event.histoPlanId) summaryRows.push(['ID identificado no HISTO', event.histoPlanId]);
  if (chargeOptions.enabled) {
    summaryRows.push(['Carga-alvo aplicado (kg)', chargeOptions.target]);
    summaryRows.push(['Carga mínima aplicada (kg)', chargeSummary?.minimum]);
    summaryRows.push(['ID do furo de menor carga', chargeSummary?.minimumHoleId ?? chargeOptions.minimumHoleId]);
    summaryRows.push(['Carga máxima preservada (kg)', chargeSummary?.maximum]);
    summaryRows.push(['ID do furo de maior carga', chargeSummary?.maximumHoleId]);
  }
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary['!cols'] = [{ wch: 28 }, { wch: 42 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Dados dos Furos');
  XLSX.utils.book_append_sheet(workbook, summary, 'Resumo');
  return workbook;
}

async function generateLocally(files, chargeOptions = {}, timeOptions = {}, planOptions = {}) {
  if (typeof XLSX === 'undefined') throw new Error('A biblioteca local de Excel não carregou. Recarregue a página e tente novamente.');
  if (files.length > 20) throw new Error('Envie no máximo 20 arquivos por execução.');
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > 250 * 1024 * 1024) throw new Error('Os anexos excedem o limite total de 250 MB.');
  const names = files.map(file => file.name.trim().toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Há arquivos com nomes repetidos no envio. Renomeie-os antes de tentar novamente.');
  const force = Boolean(planOptions.force);
  const sources = await findSources(files, { allowMissingHistory: force });
  planOptions.histoMissing = sources.histoMissing;
  setProgress(48, 'Validando colunas e identificando o plano...');
  const { projectRows, finalRows, histoText, planHints } = sources;
  requireColumns(projectRows, REQUIRED_PROJECT, sources.project.name);
  requireColumns(finalRows, REQUIRED_FINAL, sources.final.name);
  const planIdentity = planOptions.planIdentity || {};
  const manualFireTime = planOptions.manualFireTime || '';
  if (sources.histoMissing && force && !manualFireTime) {
    const error = new Error('O Historial da DRB não foi anexado. Informe o horário local do desmonte no site para forçar a execução.');
    error.code = 'MISSING_FIRE_TIME';
    error.histoMissing = true;
    throw error;
  }
  const resolvedEvent = resolvePlanAndFire(histoText, planHints, {
    force,
    manualPlanId: planIdentity.manualPlanId,
    manualFireTime,
    allowMissingHistory: sources.histoMissing && force
  });
  // O horário digitado e o fallback 12:00:00 já representam o horário local
  // do desmonte. Apenas horários lidos do HISTO passam pela conversão de fuso.
  const eventTimezoneOffset = resolvedEvent.timeSource ? null : timeOptions.timezoneOffset;
  const event = window.OpenBlastTimezone.convertEvent({
    ...resolvedEvent,
    forced: force,
    planIdentity: planIdentity.raw || ''
  }, eventTimezoneOffset);
  setProgress(62, 'Montando os dados dos furos...');
  const data = await buildRows(projectRows, finalRows, event, chargeOptions);
  if (!data.length) throw new Error('A validação não encontrou furos válidos para exportar.');
  const timing = data.map(row => row['tempo detonacao (ms)']);
  if (timing.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Há furos sem uma temporização inteira e não negativa após a simulação.');
  if (new Set(timing).size !== timing.length) throw new Error('Há furos com temporização repetida após a simulação.');
  const chargeSummary = chargeOptions.enabled ? summarizeChargeDistribution(data, chargeOptions) : null;
  return {
    workbook: buildWorkbook(data, sources, event, chargeOptions, chargeSummary), event, rows: data.length,
    totalCharge: data.reduce((sum, row) => sum + (row['cargas realizadas'] ?? 0), 0),
    chargeTargetApplied: Boolean(chargeOptions.enabled), chargeTarget: chargeOptions.target,
    chargeMinimum: chargeSummary?.minimum, chargeMinimumHoleId: chargeSummary?.minimumHoleId,
    chargeMaximum: chargeSummary?.maximum, chargeMaximumHoleId: chargeSummary?.maximumHoleId
  };
}

async function runGeneration(force = false) {
  if (!attachedFiles.length) {
    result.className = 'result error';
    result.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'Nenhum arquivo selecionado';
    const message = document.createElement('p');
    message.textContent = 'Anexe os arquivos do plano para continuar.';
    result.append(title, message);
    result.hidden = false;
    statusText.textContent = 'Aguardando arquivos';
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const planIdentity = readPlanIdentity();
  const generationOptions = { force, planIdentity };
  button.disabled = true; if (forceButton) forceButton.disabled = true; result.hidden = true; statusBox.classList.add('busy'); statusText.textContent = 'Processando localmente...'; setProgress(4, 'Iniciando validação...');
  try {
    generationOptions.manualFireTime = readManualFireTime();
    const generated = await generateLocally(attachedFiles, readChargeTarget(), { timezoneOffset: readTimezoneOffset() }, generationOptions);
    setProgress(88, 'Gerando o arquivo Excel...');
    const filename = generated.event.planId
      ? `Plano_Fogo_Realizado_PP${generated.event.planId}.xlsx`
      : 'Plano_Fogo_Realizado.xlsx';
    const bytes = XLSX.write(generated.workbook, { bookType: 'xlsx', type: 'array' });
    const link = document.createElement('a');
    link.className = 'download'; link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    link.download = filename; link.textContent = 'Baixar plano realizado (.xlsx) →';
    result.className = 'result'; result.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = generated.event.forced
      ? 'Plano gerado com execução forçada'
      : generated.chargeTargetApplied ? 'Plano gerado com carga-alvo aplicada' : 'Plano gerado com sucesso';
    result.append(title);
    if (generated.event.forced) {
      const forceNote = document.createElement('p');
      forceNote.textContent = generated.event.historySource === 'missing'
        ? `O Historial da DRB não foi anexado. A execução forçada usou o horário local ${generated.event.time}; a data ${generated.event.date} veio do navegador. As validações de estrutura, furos e temporização foram mantidas.`
        : generated.event.timeSource === 'force-default'
        ? 'O HISTO não apresentou um horário [Fire] legível. A execução forçada usou 12:00:00 como horário local sintético; as validações de estrutura, furos e temporização foram mantidas.'
        : generated.event.timeSource === 'manual'
        ? `O horário local ${generated.event.time} foi informado pelo usuário porque o horário do HISTO não foi usado. As demais validações foram mantidas.`
        : generated.event.histoPlanId
        ? `A execução foi forçada para o plano ${generated.event.planId}; o HISTO registrou o disparo como ${generated.event.histoPlanId}. As demais validações foram mantidas.`
        : 'A execução foi forçada com o identificador informado. As validações de estrutura, furos e temporização foram mantidas.';
      result.append(forceNote);
    }
    if (generated.chargeTargetApplied) {
      const targetNote = document.createElement('p');
      targetNote.textContent = `Distribuição concluída em todo o plano: total de ${formatKg(generated.chargeTarget)} kg, mínimo de ${formatKg(generated.chargeMinimum)} kg no furo ${generated.chargeMinimumHoleId} e máximo de ${formatKg(generated.chargeMaximum)} kg preservado no furo ${generated.chargeMaximumHoleId}.`;
      result.append(targetNote);
    }
    const metrics = document.createElement('div'); metrics.className = 'metrics';
    const metricsData = [['Plano', generated.event.planId], ['Data do disparo', generated.event.date], ['Horário do disparo', generated.event.time], ['Total de furos', generated.rows.toLocaleString('pt-BR')], ['Carga realizada', `${formatKg(generated.totalCharge)} kg`]];
    metricsData.push(['Fuso horário', generated.event.timezoneOffset || (generated.event.timeSource ? 'Horário local informado' : 'Original')]);
    metricsData.push(['Fonte da data', generated.event.dateSource === 'browser' ? 'Data local do navegador' : 'HISTO']);
    metricsData.push(['Historial da DRB', generated.event.historySource === 'missing' ? 'Não anexado (forçada)' : 'Anexado']);
    metricsData.push(['Fonte do horário', generated.event.timeSource === 'force-default' ? 'Fallback forçado (12:00:00)' : generated.event.timeSource === 'manual' ? 'Informado pelo usuário' : 'HISTO']);
    metricsData.push(['Execução', generated.event.forced ? 'Forçada' : 'Automática']);
    if (generated.event.planIdentity) metricsData.push(['ID / nome informado', generated.event.planIdentity]);
    if (generated.event.histoPlanId) metricsData.push(['ID no HISTO', generated.event.histoPlanId]);
    if (generated.chargeTargetApplied) {
      metricsData.push(['Alvo aplicado', `${formatKg(generated.chargeTarget)} kg`]);
      metricsData.push(['Mínimo aplicado', `${formatKg(generated.chargeMinimum)} kg`]);
      metricsData.push(['ID do menor', generated.chargeMinimumHoleId]);
      metricsData.push(['Máximo preservado', `${formatKg(generated.chargeMaximum)} kg`]);
      metricsData.push(['ID do maior', generated.chargeMaximumHoleId]);
    }
    metricsData.forEach(([label, value]) => { const metric = document.createElement('div'); metric.className = 'metric'; metric.innerHTML = `<small>${label}</small><strong>${value}</strong>`; metrics.append(metric); });
    result.append(metrics, link); statusText.textContent = 'Online'; setProgress(100, 'Concluído. O Excel está pronto para baixar.');
  } catch (error) {
    result.className = 'result error'; result.replaceChildren();
    const title = document.createElement('h3'); title.textContent = 'Não foi possível gerar o plano';
    const message = document.createElement('p'); message.textContent = error.message || String(error);
    result.append(title, message);
    if (error.code === 'MISSING_FIRE_TIME') {
      const missingHistory = error.histoMissing || /Historial da DRB não foi anexado/i.test(error.message || '');
      setManualFireTimeError(missingHistory
        ? 'Sem o Historial da DRB, informe o horário local do desmonte para usar “Forçar execução”.'
        : 'O HISTO não trouxe um horário [Fire] legível. Informe o horário local do desmonte e tente novamente.');
      const hint = document.createElement('p');
      hint.className = 'force-hint';
      hint.textContent = missingHistory
        ? 'O botão “Forçar execução” aceita a ausência do histórico, mas precisa do horário informado acima; a data será a data local do navegador.'
        : 'Preencha o horário acima. Se usar “Forçar execução” sem preencher, o sistema usará 12:00:00 automaticamente.';
      result.append(hint);
      manualFireTimeInput?.focus();
    } else if (!force && /não foi encontrado no HISTO|múltiplos blocos|IDs diferentes/i.test(error.message || '')) {
      const hint = document.createElement('p');
      hint.className = 'force-hint';
      hint.textContent = 'Se a divergência for apenas o mês do ID, informe o plano acima e use o botão “Forçar execução”.';
      result.append(hint);
    }
    addLogDownload(result, makeClientLog(error, { force, planIdentity, manualFireTime: manualFireTimeInput?.value.trim() || '', histoMissing: error.histoMissing ?? generationOptions.histoMissing })); statusText.textContent = 'Falha na validação local'; setProgress(100, 'A validação foi interrompida. Consulte o erro abaixo.');
  } finally { result.hidden = false; button.disabled = false; syncActionControls(); statusBox.classList.remove('busy'); result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  runGeneration(false);
});

forceButton?.addEventListener('click', () => {
  if (!attachedFiles.length) return;
  const identity = planIdentityInput?.value.trim() || 'identificação automática pelos anexos';
  const rawTime = manualFireTimeInput?.value.trim() || '';
  const timeNote = rawTime
    ? `Será usado o horário local informado: ${window.OpenBlastPlanId.normalizeFireTime(rawTime) || rawTime}.`
    : 'Sem o Historial da DRB, informe o horário local acima; com HISTO sem horário legível, será usado 12:00:00 local.';
  const confirmed = window.confirm(`Forçar execução usando ${identity}?\n\n${timeNote}\n\nSem o Historial da DRB, a data será a data local do navegador. As validações de tabelas, PDF, furos e temporização continuam ativas.`);
  if (confirmed) runGeneration(true);
});
