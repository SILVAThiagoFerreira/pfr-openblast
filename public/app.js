const form = document.querySelector('#form');
const input = document.querySelector('#inputs');
const list = document.querySelector('#file-list');
const drop = document.querySelector('#dropzone');
const result = document.querySelector('#result');
const button = document.querySelector('#submit');
const statusText = document.querySelector('#status-text');
const statusBox = document.querySelector('.status');

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
  files.forEach(file => { const item = document.createElement('span'); item.className = 'file'; item.textContent = file.name; list.append(item); });
}

input.addEventListener('change', () => renderFiles([...input.files]));
['dragenter', 'dragover'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => { input.files = e.dataTransfer.files; renderFiles([...input.files]); });

function makeClientLog(error) {
  const files = [...input.files].map(file => file.name).join('\n') || '-';
  return `OPENBLAST - LOG DE ERRO\nData: ${new Date().toISOString()}\nModo: processamento online\nArquivos selecionados:\n${files}\n\nErro:\n${error?.stack || error?.message || error}\n`;
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

async function findSources(files) {
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
  const textFiles = files.filter(file => /\.txt$/i.test(file.name));
  const textCandidates = await Promise.all(textFiles.map(async file => ({ file, text: decodeText(new Uint8Array(await file.arrayBuffer())) })));
  const histoEntry = textCandidates.find(item => /^HISTO-.*\.txt$/i.test(item.file.name))
    || textCandidates.find(item => /histo/i.test(item.file.name))
    || textCandidates.find(item => /\[Fire\]\d{4}\/\d{2}\/\d{2}-\d{2}:\d{2}:\d{2}/.test(item.text));
  const histo = histoEntry?.file;
  const pdf = files.find(file => /\.pdf$/i.test(file.name));
  if (!projectEntry || !finalEntry) throw new Error('Não foi possível identificar as tabelas. Confira se uma contém as colunas do projeto e outra as colunas do realizado.');
  if (!histo) throw new Error('Envie o arquivo HISTO-*.txt.');
  if (!pdf) throw new Error('Envie o PP.pdf.');
  const pdfHeader = decodeText(new Uint8Array(await pdf.slice(0, 5).arrayBuffer()));
  if (!pdfHeader.startsWith('%PDF-')) throw new Error(`O arquivo ${pdf.name} não parece ser um PDF válido.`);
  return { project: projectEntry.file, projectRows: projectEntry.rows, final: finalEntry.file, finalRows: finalEntry.rows, histo, histoText: histoEntry.text, pdf };
}

function formatDate(date) {
  const [year, month, day] = date.split('/');
  return `${day}/${month}/${year}`;
}

function extractPlanAndFire(text) {
  const eventRegex = /\[(BlastingPlan|Fire)\](\d{4}\/\d{2}\/\d{2})-(\d{2}:\d{2}:\d{2})/g;
  const events = [...text.matchAll(eventRegex)];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event[1] !== 'BlastingPlan') continue;
    const end = index + 1 < events.length ? events[index + 1].index : text.length;
    const block = text.slice(event.index, end);
    const blockPlans = [...block.matchAll(/\bPP(\d{6})\b/gi)].map(match => match[1]);
    const planId = blockPlans[blockPlans.length - 1];
    if (!planId) continue;
    const fire = events.slice(index + 1).find(item => item[1] === 'Fire');
    if (fire) return { planId, date: formatDate(fire[2]), time: fire[3] };
  }
  const plans = [...text.matchAll(/\bPP(\d{6})\b/gi)].map(match => match[1]);
  const planId = [...new Set(plans)].pop();
  if (!planId) throw new Error('Não foi possível identificar o plano no HISTO.');
  const fires = events.filter(event => event[1] === 'Fire');
  if (!fires.length) throw new Error('Não foi encontrado nenhum evento [Fire] válido no HISTO.');
  const fire = fires[fires.length - 1];
  return { planId, date: formatDate(fire[2]), time: fire[3] };
}

function uniqueSequence(lower, upper, count, forbidden) {
  if (count <= 0) return [];
  const chosen = [];
  if (lower !== null && upper !== null) {
    for (let index = 1; index <= count; index += 1) {
      let value = Math.floor(lower + ((upper - lower) * index) / (count + 1));
      if (value <= (chosen[index - 2] ?? lower)) value = (chosen[index - 2] ?? lower) + 1;
      while (forbidden.has(value) || chosen.includes(value)) value += 1;
      chosen.push(value);
    }
    return chosen;
  }
  if (upper !== null) {
    let value = upper - 1;
    while (chosen.length < count && value > 0) { if (!forbidden.has(value)) chosen.unshift(value); value -= 1; }
    if (chosen.length < count) throw new Error('Não foi possível preencher tempos de detonação antes do primeiro valor conhecido.');
    return chosen;
  }
  let value = lower ?? 0;
  while (chosen.length < count) { value += 1; if (!forbidden.has(value)) chosen.push(value); }
  return chosen;
}

function fillMissingTimes(values) {
  const result = values.slice();
  const forbidden = new Set(values.filter(value => value !== null).map(value => Math.round(value)));
  let imputed = 0;
  let start = 0;
  while (start < values.length) {
    if (values[start] !== null) { start += 1; continue; }
    let end = start;
    while (end < values.length && values[end] === null) end += 1;
    let left = null; for (let index = start - 1; index >= 0; index -= 1) if (values[index] !== null) { left = Math.round(values[index]); break; }
    let right = null; for (let index = end; index < values.length; index += 1) if (values[index] !== null) { right = Math.round(values[index]); break; }
    const filled = uniqueSequence(left, right, end - start, forbidden);
    filled.forEach((value, offset) => { result[start + offset] = value; forbidden.add(value); imputed += 1; });
    start = end;
  }
  return { values: result.map(value => value === null ? null : Math.round(value)), imputed };
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

function buildRows(projectRows, finalRows, event) {
  const projects = new Map(projectRows.map(row => [key(row.Number), row]));
  const merged = finalRows.map(row => ({ ...(projects.get(key(row.Number)) || {}), ...row }))
    .filter(row => parseNumber(row.eliminated) === null || parseNumber(row.eliminated) === 0)
    .sort((left, right) => (parseNumber(left.Number) ?? 0) - (parseNumber(right.Number) ?? 0));
  const numbers = merged.map(row => parseNumber(row.Number));
  const times = fillMissingTimes(merged.map(row => parseNumber(row.DetonatingTime))).values;
  const charges = redistributeZeros(merged.map(row => parseNumber(row.InputedCharge)));
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

function buildWorkbook(data, sources, event) {
  const sheet = XLSX.utils.json_to_sheet(data, { header: OUTPUT_COLUMNS });
  sheet['!cols'] = [14, 12, 12, 12, 10, 12, 12, 12, 12, 18, 18, 12, 12, 16, 16, 16, 16, 12, 12, 18].map(width => ({ wch: width }));
  const totalDepth = data.reduce((sum, row) => sum + (row['profundidade realizada'] ?? 0), 0);
  const totalCharge = data.reduce((sum, row) => sum + (row['cargas realizadas'] ?? 0), 0);
  const summary = XLSX.utils.aoa_to_sheet([
    ['Campo', 'Valor'], ['Plano', event.planId], ['Data', event.date], ['Hora', event.time], ['Total de furos', data.length],
    ['Profundidade total (m)', Math.round(totalDepth * 100) / 100], ['Carga total (kg)', Math.round(totalCharge * 100) / 100],
    ['Arquivo projeto', sources.project.name], ['Arquivo realizado', sources.final.name], ['Arquivo PDF', sources.pdf.name]
  ]);
  summary['!cols'] = [{ wch: 28 }, { wch: 42 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Dados dos Furos');
  XLSX.utils.book_append_sheet(workbook, summary, 'Resumo');
  return workbook;
}

async function generateLocally(files) {
  if (typeof XLSX === 'undefined') throw new Error('A biblioteca local de Excel não carregou. Recarregue a página e tente novamente.');
  if (files.length > 20) throw new Error('Envie no máximo 20 arquivos por execução.');
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > 250 * 1024 * 1024) throw new Error('Os anexos excedem o limite total de 250 MB.');
  const names = files.map(file => file.name.trim().toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Há arquivos com nomes repetidos no envio. Renomeie-os antes de tentar novamente.');
  const sources = await findSources(files);
  const { projectRows, finalRows, histoText } = sources;
  requireColumns(projectRows, REQUIRED_PROJECT, sources.project.name);
  requireColumns(finalRows, REQUIRED_FINAL, sources.final.name);
  const event = extractPlanAndFire(histoText);
  const data = await buildRows(projectRows, finalRows, event);
  if (!data.length) throw new Error('A validação não encontrou furos válidos para exportar.');
  return { workbook: buildWorkbook(data, sources, event), event, rows: data.length, totalCharge: data.reduce((sum, row) => sum + (row['cargas realizadas'] ?? 0), 0) };
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!input.files.length) return;
  button.disabled = true; result.hidden = true; statusBox.classList.add('busy'); statusText.textContent = 'Validando e processando localmente...';
  try {
    const generated = await generateLocally([...input.files]);
    const filename = `Plano_Fogo_Realizado_PP${generated.event.planId}.xlsx`;
    const bytes = XLSX.write(generated.workbook, { bookType: 'xlsx', type: 'array' });
    const link = document.createElement('a');
    link.className = 'download'; link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    link.download = filename; link.textContent = 'Baixar plano realizado (.xlsx) →';
    result.className = 'result'; result.replaceChildren();
    const title = document.createElement('h3'); title.textContent = 'Plano gerado com sucesso'; result.append(title);
    const metrics = document.createElement('div'); metrics.className = 'metrics';
    [['Plano', generated.event.planId], ['Data do disparo', generated.event.date], ['Total de furos', generated.rows.toLocaleString('pt-BR')], ['Carga realizada', `${generated.totalCharge.toFixed(2)} kg`]].forEach(([label, value]) => { const metric = document.createElement('div'); metric.className = 'metric'; metric.innerHTML = `<small>${label}</small><strong>${value}</strong>`; metrics.append(metric); });
    result.append(metrics, link); statusText.textContent = 'Online';
  } catch (error) {
    result.className = 'result error'; result.replaceChildren(); const title = document.createElement('h3'); title.textContent = 'Não foi possível gerar o plano'; const message = document.createElement('p'); message.textContent = error.message || String(error); result.append(title, message); addLogDownload(result, makeClientLog(error)); statusText.textContent = 'Falha na validação local';
  } finally { result.hidden = false; button.disabled = false; statusBox.classList.remove('busy'); result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
});
