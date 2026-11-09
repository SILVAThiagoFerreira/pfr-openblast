const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Furo de assinatura (SPEC.md, "Furo de assinatura"): o furo indicado mantém os valores de entrada e
// os demais furos seguem as regras atuais. Cobre validação do ID/tempo, carga, tampão e cota.
function loadModule(file, extra = {}) {
  const context = { window: {}, ...extra };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.window;
}

const signature = loadModule('public/signature-hole.js').OpenBlastSignatureHole;
const { distributeCharges, redistributeZeroCharges } = loadModule('public/charge.js').OpenBlastCharge;
const { applyVariation } = loadModule('public/stemming.js', { crypto: globalThis.crypto, TextEncoder }).OpenBlastStemming;
const elevation = loadModule('public/elevation.js').OpenBlastElevation;
const configWindow = loadModule('public/config.js').PFR_BROWSER_CONFIG;

const total = values => values.reduce((sum, value) => sum + value, 0);
const near = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `esperado ${expected}, obtido ${actual}`
);
const throwsCode = (fn, code, pattern) => {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught, `esperado erro ${code}`);
  assert.equal(caught.code, code);
  if (pattern) assert.match(caught.message, pattern);
};

// 1) ID do furo: somente dígitos; vazio, texto ou decimal são recusados com mensagem explícita.
assert.equal(signature.parseHoleId('245'), 245);
assert.equal(signature.parseHoleId(' 0245 '), 245);
throwsCode(() => signature.parseHoleId(''), 'SIGNATURE_HOLE_INVALID', /Informe o ID do furo de assinatura/);
throwsCode(() => signature.parseHoleId('abc'), 'SIGNATURE_HOLE_INVALID', /deve ser o número do furo/);
throwsCode(() => signature.parseHoleId('12.5'), 'SIGNATURE_HOLE_INVALID');
throwsCode(() => signature.parseHoleId('-1'), 'SIGNATURE_HOLE_INVALID');

// 2) ID ausente do plano ou repetido bloqueia (não é ignorado em silêncio).
assert.equal(signature.findHoleIndex([10, 20, 30], 20), 1);
throwsCode(() => signature.findHoleIndex([10, 20, 30], 99), 'SIGNATURE_HOLE_NOT_FOUND', /99 não foi encontrado no plano realizado/);
throwsCode(() => signature.findHoleIndex([10, 20, 20], 20), 'SIGNATURE_HOLE_DUPLICATED', /aparece mais de uma vez/);

// 3) Tempo do furo de assinatura: não pode ser imputado; precisa ser inteiro, não negativo e único.
assert.doesNotThrow(() => signature.validateTime([1000, 1100, 1200], 1, 2));
throwsCode(() => signature.validateTime([1000, null, 1200], 1, 2), 'SIGNATURE_HOLE_TIME', /tempo de detonação válido/);
throwsCode(() => signature.validateTime([1000, -1, 1200], 1, 2), 'SIGNATURE_HOLE_TIME');
throwsCode(() => signature.validateTime([1000, 1000, 1200], 1, 2), 'SIGNATURE_HOLE_TIME');
throwsCode(() => signature.validateTime([1000, 1000.4, 1200], 1, 2), 'SIGNATURE_HOLE_TIME');
throwsCode(() => signature.validateTime([1000.4, 1000], 0, 2), 'SIGNATURE_HOLE_TIME');

// 4) Carga: o furo de assinatura mantém a carga de entrada; o total fecha no alvo com os demais furos.
const holeCharges = [5, 40, 10, 12, 60];
const withHole = distributeCharges(holeCharges, 150, {
  minimumIndex: 0, minimumValue: 5, maximumIndex: 4, maximumValue: 60, maximumIndexes: [4], fixedIndexes: [1]
});
assert.equal(withHole[1], 40, 'furo de assinatura mantém a carga exata');
assert.equal(withHole[0], 5, 'furo de menor carga recebe o mínimo');
assert.equal(withHole[4], 60, 'maior carga preservada');
near(total(withHole), 150, 1e-9);
assert.ok(withHole[2] >= 5 && withHole[2] <= 60 && withHole[3] >= 5 && withHole[3] <= 60, 'demais furos ajustados dentro dos limites');
assert.notDeepEqual([withHole[2], withHole[3]], [10, 12], 'demais furos são ajustados');

// Sem furo de assinatura, a distribuição é idêntica à atual (fixedIndexes vazio).
const baseOptions = { minimumIndex: 0, minimumValue: 5, maximumIndex: 4, maximumValue: 60, maximumIndexes: [4] };
assert.deepEqual(
  distributeCharges(holeCharges, 150, { ...baseOptions, fixedIndexes: [] }),
  distributeCharges(holeCharges, 150, baseOptions),
);
assert.deepEqual(distributeCharges([5, 10, 15, 60], 100), distributeCharges([5, 10, 15, 60], 100, { fixedIndexes: [] }));

throwsCode(() => distributeCharges(holeCharges, 150, { ...baseOptions, fixedIndexes: [0] }), undefined, /furo de assinatura não pode ser o furo de menor carga/);
// Sem furo intermediário livre (o único é o de assinatura), o fechamento é recusado com mensagem explícita.
assert.throws(() => distributeCharges([5, 40, 60], 300, { minimumIndex: 0, maximumIndex: 2, fixedIndexes: [1] }), /Não há furos intermediários/);
assert.throws(() => distributeCharges([5, 40, 10, 60], 400, { minimumIndex: 0, maximumIndex: 3, fixedIndexes: [1] }), /alvo é impossível/);

// 5) Carga zerada: o furo de assinatura não recebe a carga mínima e não financia a redistribuição.
const zeroOptions = { enabled: true, zeroChargeMinimum: 0.5, chargeTarget: 100 };
const zeroRedistributed = redistributeZeroCharges([5, 0, 20, 10, 60], { ...zeroOptions, fixedIndexes: [2] });
assert.equal(zeroRedistributed[2], 20, 'furo de assinatura mantém a carga exata');
assert.equal(zeroRedistributed[0], 5);
assert.equal(zeroRedistributed[4], 60);
assert.equal(zeroRedistributed[1], 0.5, 'o outro furo zerado recebe a carga mínima');
near(total(zeroRedistributed), 95, 1e-9);
const zeroOnHole = redistributeZeroCharges([5, 0, 20, 0, 60], { ...zeroOptions, fixedIndexes: [3] });
assert.equal(zeroOnHole[3], 0, 'furo de assinatura com carga zero continua zero');
assert.equal(zeroOnHole[1], 0.5);
assert.deepEqual(redistributeZeroCharges([5, 0, 20, 10, 60], { ...zeroOptions, enabled: false }), [5, 0, 20, 10, 60]);

// 6) Tampão realizado: o furo de assinatura mantém o tampão de entrada (sem variação nem arredondamento).
(async () => {
  const values = [3.0, 3.04, 3.0, 3.1];
  const numbers = [10, 11, 12, 13];
  const varied = await applyVariation(values, numbers, '1234567', { enabled: true, maxDelta: 0.12, preservedIndexes: [1] });
  assert.equal(varied[1], 3.04, 'tampão do furo de assinatura preservado exatamente');
  for (const index of [0, 2, 3]) {
    assert.ok(varied[index] >= 2.88 && varied[index] <= 3.22, `tampão ${index} dentro da variação`);
    near(varied[index] * 10, Math.round(varied[index] * 10), 1e-9);
  }
  const again = await applyVariation(values, numbers, '1234567', { enabled: true, maxDelta: 0.12, preservedIndexes: [1] });
  assert.deepEqual(varied, again, 'variação determinística');
  assert.deepEqual(await applyVariation(values, numbers, '1234567', { enabled: false }), values);

  // 7) Cota: Z e Z_Toe do furo de assinatura vêm do Config Final, mesmo fora da faixa; sem consulta ao plano.
  const business = configWindow.business;
  const config = {
    minM: business.elevationPlausibleMinM,
    maxM: business.elevationPlausibleMaxM,
    matchToleranceM: business.elevationDesignMatchToleranceM,
  };
  const design = [
    { number: 171, x: 748776.29, y: 8930000.78, z: 287.63 },
    { number: 172, x: 748774.81, y: 8929998.76, z: 287.5 },
  ];
  const holes = [
    { number: 171, x: 748776.29, y: 8930000.78, z: 748775.62, zToe: 748767.506, length: 8.4, angle: 15, preserved: true },
    { number: 172, x: 748774.81, y: 8929998.76, z: 748774.81, zToe: 748766.81, length: 8.0, angle: 0, preserved: false },
  ];
  const resolved = elevation.resolveElevations(holes, design, config);
  const preservedHole = resolved.byNumber.get(171);
  assert.equal(preservedHole.zCrest, 748775.62, 'Z do furo de assinatura como veio');
  assert.equal(preservedHole.zToe, 748767.506, 'Z_Toe do furo de assinatura como veio');
  assert.equal(preservedHole.crestSource, 'signature');
  near(resolved.byNumber.get(172).zCrest, 287.5);
  assert.equal(resolved.byNumber.get(172).crestSource, 'design', 'demais furos seguem a regra de cota');
  assert.match(resolved.warnings.join('\n'), /Furo de assinatura 171: Z \(crest\) = 748775,62 mantido como veio do Config Final/);
  assert.doesNotMatch(resolved.warnings.join('\n'), /Sem cota \(Z\) válida para 1 furo/);

  const blankHole = elevation.resolveElevations(
    [{ number: 5, x: 1, y: 2, z: null, zToe: null, length: 10, angle: 0, preserved: true }],
    [],
    config
  );
  assert.equal(blankHole.byNumber.get(5).zCrest, null);
  assert.equal(blankHole.byNumber.get(5).zToe, null);
  assert.match(blankHole.warnings.join('\n'), /Furo de assinatura 5: sem Z no Config Final/);

  console.log('signature hole tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
