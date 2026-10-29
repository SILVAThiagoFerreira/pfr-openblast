const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/plan-label.js', 'utf8'), context, { filename: 'public/plan-label.js' });
const label = context.window.OpenBlastPlanLabel;

// Usa a configuração real de public/config.js, para que o teste acompanhe o que o site publica.
const configContext = { window: {} };
vm.runInNewContext(fs.readFileSync('public/config.js', 'utf8'), configContext, { filename: 'public/config.js' });
const config = configContext.window.PFR_BROWSER_CONFIG.business;

const plain = value => JSON.parse(JSON.stringify(value));
const CRISTA_FILES = ['Crista_F3.pdf', 'Crista_F3.xlsx', 'configuração final.csv', 'projeto completo.csv'];

// Caso real do usuário: ID textual, sem HISTO, data e horário informados.
const userCase = plain(label.resolvePlanIdentity({
  typedRaw: 'REG CRISTA F3',
  manualPlanId: '',
  resolvedPlanId: '',
  fileNames: ['Crista_F3.pdf', 'Crista_F3.xlsx'],
  date: '27/10/2026',
  time: '12:00:56',
  config
}));
assert.deepEqual(userCase, { planId: 'REG CRISTA F3', source: 'typed', warnings: [] });
assert.equal(label.outputFileName(userCase.planId, config).fileName, 'Plano_Fogo_Realizado_REG_CRISTA_F3.xlsx');
assert.deepEqual(plain(label.outputFileName(userCase.planId, config)).warnings, []);

// O texto digitado é gravado como digitado (acentos e espaços); só o nome do arquivo é sanitizado.
assert.equal(label.resolvePlanIdentity({ typedRaw: '  Área Crista Nº 3  ', fileNames: [], date: '27/10/2026', time: '12:00:56', config }).planId, 'Área Crista Nº 3');
// "º" não tem decomposição: vira separador; o "N" é mantido.
assert.equal(label.outputFileName('Área Crista Nº 3', config).fileName, 'Plano_Fogo_Realizado_Area_Crista_N_3.xlsx');

// ID numérico digitado continua sendo o ID numérico, com ou sem prefixo.
assert.equal(label.resolvePlanIdentity({ typedRaw: 'Plano 440726', manualPlanId: '440726', date: '27/10/2026', time: '12:00:56', config }).planId, '440726');
assert.equal(label.resolvePlanIdentity({ typedRaw: 'PP0440726_D', manualPlanId: '440726', date: '27/10/2026', time: '12:00:56', config }).planId, '440726');
assert.equal(label.outputFileName('440726', config).fileName, 'Plano_Fogo_Realizado_PP440726.xlsx');
// Texto que contém um número de plano continua sendo um nome: o texto é o ID gravado.
assert.equal(label.resolvePlanIdentity({ typedRaw: 'REG 440726 CRISTA', manualPlanId: '440726', date: '27/10/2026', time: '12:00:56', config }).planId, 'REG 440726 CRISTA');

// Sem ID digitado: ID dos anexos/HISTO, sem aviso.
assert.deepEqual(plain(label.resolvePlanIdentity({ typedRaw: '', resolvedPlanId: '440826', fileNames: CRISTA_FILES, date: '27/10/2026', time: '12:00:56', config })),
  { planId: '440826', source: 'documents', warnings: [] });

// Sem ID digitado nem anexo: nome do PDF, com aviso visível.
const derived = plain(label.resolvePlanIdentity({ typedRaw: '', resolvedPlanId: '', fileNames: CRISTA_FILES, date: '27/10/2026', time: '12:00:56', config }));
assert.equal(derived.planId, 'Crista F3');
assert.equal(derived.source, 'file-name');
assert.equal(derived.warnings.length, 1);
assert.match(derived.warnings[0], /Crista_F3\.pdf/);
assert.equal(label.outputFileName(derived.planId, config).fileName, 'Plano_Fogo_Realizado_Crista_F3.xlsx');

// Nomes genéricos não viram ID: cai no ID gerado com a data e o horário do disparo.
const generated = plain(label.resolvePlanIdentity({
  typedRaw: '', resolvedPlanId: '', fileNames: ['Plano de Perfuração.pdf', 'projeto completo.csv', 'PP.pdf'],
  date: '27/10/2026', time: '12:00:56', config
}));
assert.equal(generated.planId, 'PFR_20261027_120056');
assert.equal(generated.source, 'generated');
assert.equal(generated.warnings.length, 1);
assert.match(generated.warnings[0], /PFR_20261027_120056/);
assert.equal(label.outputFileName(generated.planId, config).fileName, 'Plano_Fogo_Realizado_PFR_20261027_120056.xlsx');
assert.equal(label.resolvePlanIdentity({ typedRaw: '', fileNames: [], date: '27/10/2026', time: '12:00:56', config }).source, 'generated');

// Sem data ou horário do disparo, o ID gerado não é inventado.
assert.throws(() => label.resolvePlanIdentity({ typedRaw: '', fileNames: [], date: '', time: '', config }), /não foi possível gerar o ID/);

// Nome de arquivo: caracteres inválidos, acentos, tamanho máximo e nome vazio.
assert.equal(label.sanitizeFileStem('REG CRISTA F3', 60), 'REG_CRISTA_F3');
assert.equal(label.sanitizeFileStem('Ação Norte / Turno: 2 *', 60), 'Acao_Norte_Turno_2');
assert.equal(label.sanitizeFileStem('  PP 440726  ', 60), 'PP_440726');
assert.equal(label.sanitizeFileStem('x'.repeat(100), 60).length, 60);
assert.equal(label.sanitizeFileStem('???', 60), '');
const emptyName = plain(label.outputFileName('???', config));
assert.equal(emptyName.fileName, 'Plano_Fogo_Realizado.xlsx');
assert.equal(emptyName.warnings.length, 1);

// Configuração ausente ou inválida interrompe a identificação (sem valor padrão escondido).
assert.throws(() => label.resolvePlanIdentity({ typedRaw: 'X', date: '27/10/2026', time: '12:00:56', config: { ...config, planLabelMaxLength: 2 } }), /planLabelMaxLength/);
assert.throws(() => label.outputFileName('X', { ...config, outputNameTextTemplate: 'Sem_marcador.xlsx' }), /outputNameTextTemplate/);
assert.throws(() => label.outputFileName('X', { ...config, planLabelGenericNames: undefined }), /planLabelGenericNames/);

console.log('plan-label tests passed');
