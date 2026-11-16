const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/charge.js', 'utf8'), context, { filename: 'public/charge.js' });
const distributeCharges = context.window.OpenBlastCharge.distributeCharges;
const redistributeZeroCharges = context.window.OpenBlastCharge.redistributeZeroCharges;

// Espelhos de config.js: teto do passo da carga-alvo, janela de furos vizinhos e diferença mínima dentro dela.
const STEP = 5;
const WINDOW = 3;
const GAP = 0.6;
const REDUCED_MARKERS = ['ficou em', 'faixa curta'];
const PINNED_MARKER = 'mantidos como vieram da entrada';

function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function unitsOf(value) {
  return Math.round(value * 1e6);
}

function sumUnits(values) {
  return values.reduce((sum, value) => sum + unitsOf(value ?? 0), 0);
}

function distribute(values, target, options = {}) {
  return distributeCharges(values, target, { stepKg: STEP, windowSize: WINDOW, windowMinGapKg: GAP, ...options });
}

function redistribute(values, options = {}) {
  return redistributeZeroCharges(values, {
    enabled: true, zeroChargeMinimum: 0.01, windowSize: WINDOW, windowMinGapKg: GAP, ...options
  });
}

// Gerador determinístico (LCG) só para montar cenários de teste reproduzíveis.
function scenarioRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

// Regra da janela: dois furos a até WINDOW posições não ficam a menos de GAP um do outro. Só dois furos fixos
// (valores `fixedValues`: menor e maior cargas preservadas) ficam de fora, porque mantêm a entrada e são avisados.
// Se o aviso de diferença reduzida aparecer, o mínimo passa a ser 0,01 kg.
function assertWindowRule(values, { notes = [], fixedValues = [], label = 'cenário' } = {}) {
  const reduced = notes.some(note => REDUCED_MARKERS.some(marker => note.includes(marker)));
  const pinnedNoted = notes.some(note => note.includes(PINNED_MARKER));
  const floor = reduced ? 0.01 : GAP;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j <= Math.min(values.length - 1, i + WINDOW); j += 1) {
      if (values[i] === null || values[j] === null) continue;
      if (pinnedNoted && fixedValues.includes(values[i]) && fixedValues.includes(values[j])) continue;
      const gap = Math.abs(values[i] - values[j]);
      assert.ok(gap >= floor - 1e-9, `${label}: furos ${i + 1} e ${j + 1} com ${values[i]} e ${values[j]} (diferença ${gap.toFixed(6)})`);
    }
  }
}

// ---- Carga-alvo (bloco ativo) ----
const raised = distribute([5, 10, 15, 60], 100);
assert.equal(sumUnits(raised), 100000000);
assert.equal(raised[0], 5);
assert.equal(raised[3], 60);
assert.deepEqual(raised, distribute([5, 10, 15, 60], 100), 'a distribuição deve ser determinística');
assertWindowRule(raised, { fixedValues: [5, 60], label: 'subida simples' });

const reduced = distribute([5, 20, 40, 60], 100);
assert.equal(sumUnits(reduced), 100000000);
assert.equal(reduced[0], 5);
assert.equal(reduced[3], 60);
assertWindowRule(reduced, { fixedValues: [5, 60], label: 'redução' });

const zeroAdjusted = distribute([5, 0.5, 19, 0.5, 60], 100, { minimumIndex: 0, maximumIndex: 4 });
assert.equal(sumUnits(zeroAdjusted), 100000000);
assert.equal(zeroAdjusted[0], 5);
assert.equal(zeroAdjusted[4], 60);
assert.ok(zeroAdjusted[1] > 5 && zeroAdjusted[3] > 5, 'os furos de carga baixa sobem acima do mínimo');
assertWindowRule(zeroAdjusted, { fixedValues: [5, 60], label: 'zerados no bloco' });

const manualMinimum = distribute([5, 10, 15, 60], 140, {
  minimumIndex: 1, minimumValue: 20, maximumIndex: 3, maximumValue: 60
});
assert.equal(sumUnits(manualMinimum), 140000000);
assert.equal(manualMinimum[1], 20);
assert.equal(manualMinimum[3], 60);
assert.ok([manualMinimum[0], manualMinimum[2]].every(value => value > 20 && value < 60));
assertWindowRule(manualMinimum, { fixedValues: [20, 60], label: 'mínimo informado' });

// Escada automática: furos de carga baixa (zerados ou abaixo do mínimo) ficam entre o mínimo e a próxima carga real
// do plano (25 kg aqui), na ordem da carga original. Com 1 kg entre eles, a regra da janela já é atendida.
const stairNotes = [];
const stairCase = distribute([21, 0, 0, 0, 25, 30, 60], 205, {
  minimumIndex: 0, minimumValue: 21, maximumIndex: 6, maximumValue: 60, maximumIndexes: [6], notes: stairNotes
});
assert.deepEqual(stairCase, [21, 22, 23, 24, 25, 30, 60]);
assert.equal(stairNotes.length, 1);
assert.match(stairNotes[0], /abaixo da próxima carga real do plano \(25 kg\)/);

// Muitos furos abaixo do mínimo: nenhum vizinho a até 3 posições fica a menos de 0,6 kg de outro (ou aparece aviso).
const lowValues = Array.from({ length: 60 }, (_, index) => (index % 3 === 0 ? 0 : 4 + (index % 11)));
const belowMinimum = [...lowValues, 21.5, 26.2, 33.7, 48.05218];
const minimumIndex = belowMinimum.length - 4;
const maximumIndex = belowMinimum.length - 1;
const spreadNotes = [];
const spreadCase = distribute(belowMinimum, 1480, {
  minimumIndex, minimumValue: 21, maximumIndex, maximumValue: 48.05218, maximumIndexes: [maximumIndex], notes: spreadNotes
});
assert.equal(sumUnits(spreadCase), 1480000000);
assert.equal(spreadCase[minimumIndex], 21);
assert.equal(spreadCase[maximumIndex], 48.05218);
assert.ok(spreadCase.every(value => value >= 21 && value <= 48.05218), 'nenhum furo fora dos extremos');
assert.ok(spreadNotes.some(note => /também subiram/.test(note)), 'a elevação dos furos baixos precisa aparecer como aviso');
assertWindowRule(spreadCase, { notes: spreadNotes, fixedValues: [21, 48.05218], label: 'muitos furos baixos' });
assert.deepEqual(distribute(belowMinimum, 1480, {
  minimumIndex, minimumValue: 21, maximumIndex, maximumValue: 48.05218, maximumIndexes: [maximumIndex]
}), spreadCase, 'a distribuição deve ser determinística');

// Alvo alto: os demais furos não ficam colados no máximo preservado nem repetem carga dentro da janela.
const highCase = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  23.1, 25.4, 27.9, 31.2, 34.8, 37.6, 40.3, 42.1, 44.9, 46.2, 48.7, 50.3, 51.9, 52.8, 53.6, 54.5, 55.1, 55.8, 56.939, 21.16];
const highMinimumIndex = highCase.length - 1;
const highMaximumIndex = 48;
const highNotes = [];
const high = distribute(highCase, 1665.44, {
  minimumIndex: highMinimumIndex, minimumValue: 21.16, maximumIndex: highMaximumIndex, maximumValue: 56.939,
  maximumIndexes: [highMaximumIndex], notes: highNotes
});
assert.equal(sumUnits(high), 1665440000);
assert.equal(high[highMinimumIndex], 21.16);
assert.equal(high[highMaximumIndex], 56.939);
assertWindowRule(high, { notes: highNotes, fixedValues: [21.16, 56.939], label: 'alvo alto' });

// Furos livres quase todos no máximo (déficit pequeno): continuam dentro da regra da janela.
const nearTop = Array.from({ length: 100 }, (_, index) => 60 + (index % 7) * 0.5);
nearTop[0] = 21;
nearTop[1] = 100;
const nearTopTarget = total(nearTop) - 0.5;
const nearTopNotes = [];
const nearTopResult = distribute(nearTop, nearTopTarget, {
  minimumIndex: 0, minimumValue: 21, maximumIndex: 1, maximumValue: 100, maximumIndexes: [1], notes: nearTopNotes
});
assert.equal(sumUnits(nearTopResult), unitsOf(nearTopTarget));
assertWindowRule(nearTopResult, { notes: nearTopNotes, fixedValues: [21, 100], label: 'quase todo no máximo' });

// Recusas explícitas (com mensagem), sem alterar silenciosamente.
assert.throws(() => distribute([5, 10, 15, 60], 120, { minimumIndex: 1, minimumValue: 20, maximumIndex: 3, maximumValue: 60 }), /impossível|distintas/);
assert.throws(() => distribute([5, 60, 10, 60], 180, {
  minimumIndex: 1, minimumValue: 20, maximumIndex: 1, maximumIndexes: [1, 3], maximumValue: 60
}), /furos extremos distintos/);
assert.throws(() => distribute([5, 10, 60], 120, { minimumIndex: 1, minimumValue: 61, maximumIndex: 2, maximumValue: 60 }), /não pode ser maior que a maior carga/);
assert.throws(() => distribute([5, 10, 60], 70, { minimumIndex: 1, minimumValue: 10, maximumIndex: 2, maximumValue: 59 }), /alvo é impossível/);
assert.throws(() => distribute([5, 10, 60], 200), /alvo é impossível/);
assert.throws(() => distribute([5, 10, 60], 50), /alvo é impossível/);
assert.throws(() => distribute([5, 60], 70), /pelo menos três furos/);
assert.throws(() => distribute([5, NaN, 60], 70), /não é válida/);
assert.throws(() => distribute([5, 10, 60], 0), /maior que zero/);
assert.throws(() => distributeCharges([5, 10, 60], 100, { windowSize: 3, windowMinGapKg: 0.6 }), /chargeMinimumStepKg/);
assert.throws(() => distributeCharges([5, 10, 60], 100, { stepKg: 5, windowSize: 0, windowMinGapKg: 0.6 }), /chargeWindowSize/);
assert.throws(() => distributeCharges([5, 10, 60], 100, { stepKg: 5, windowSize: 3 }), /chargeWindowMinGapKg/);
assert.throws(() => distribute([5, 10, 60], 100, { minimumIndex: 0, maximumIndex: 2, minimumValue: 5.1234567 }), /seis casas decimais/);

// Varredura determinística (carga-alvo): em cenários aleatórios, o total fecha e nenhum furo vizinho repete carga.
const random = scenarioRandom(20260916);
let solvedScenarios = 0;
for (let scenario = 0; scenario < 300; scenario += 1) {
  const count = 12 + Math.floor(random() * 180);
  const values = Array.from({ length: count }, () => {
    const draw = random();
    if (draw < 0.35) return 0;
    if (draw < 0.5) return Math.round((2 + random() * 18) * 100) / 100;
    return Math.round((21.5 + random() * 26) * 1000) / 1000;
  });
  const maximumIndex = Math.floor(random() * count);
  values[maximumIndex] = 48.05218;
  const minimumIndex = (maximumIndex + 1 + Math.floor(random() * (count - 1))) % count;
  const minimum = Math.round((21 + random() * 3) * 100) / 100;
  values[minimumIndex] = minimum;
  const free = values.map((_, index) => index).filter(index => index !== minimumIndex && index !== maximumIndex);
  const lower = minimum + 48.05218 + free.length * minimum;
  const upper = minimum + 48.05218 + free.length * 48.05218;
  const target = Math.round((lower + (upper - lower) * (0.05 + random() * 0.45)) * 1000) / 1000;
  const notes = [];
  let result;
  try {
    result = distribute(values, target, {
      minimumIndex, minimumValue: minimum, maximumIndex, maximumValue: 48.05218, maximumIndexes: [maximumIndex], notes
    });
  } catch (error) {
    assert.match(error.message, /impossível|distintas|muito perto|extremos|Ajuste o total|pequena demais/, `cenário ${scenario}: ${error.message}`);
    continue;
  }
  solvedScenarios += 1;
  assert.equal(sumUnits(result), unitsOf(target), `cenário ${scenario}: total`);
  assert.equal(result[minimumIndex], minimum, `cenário ${scenario}: mínimo`);
  assert.equal(result[maximumIndex], 48.05218, `cenário ${scenario}: máximo`);
  assert.ok(result.every(value => value >= minimum && value <= 48.05218), `cenário ${scenario}: limites`);
  assertWindowRule(result, { notes, fixedValues: [minimum, 48.05218], label: `cenário ${scenario}` });
}
assert.ok(solvedScenarios > 200, `a maioria dos cenários de carga-alvo precisa fechar (${solvedScenarios}/300)`);

// ---- Redistribuição padrão (sem bloco de carga-alvo) ----
// Cópia sintética do REG RAMPA F3 (o teste não lê os arquivos reais): 1 furo zerado, menor carga positiva de 3 kg
// (4 furos), maior carga de 139 kg (1 furo), cargas de origem repetidas e centavos.
function syntheticPlan() {
  const repeated = [[23, 11], [8, 10], [25, 8], [5, 7], [10, 7], [30, 6], [3, 4], [21, 5], [12.5, 3]];
  const values = [0, 139];
  repeated.forEach(([value, count]) => { for (let copy = 0; copy < count; copy += 1) values.push(value); });
  const random = scenarioRandom(20261116);
  while (values.length < 320) values.push(Math.round((3.5 + random() * 40) * 1000) / 1000);
  return values;
}

const plan = syntheticPlan();
const planMinimumIndex = plan.indexOf(3);
const defaultNotes = [];
const defaultRows = redistribute(plan, { notes: defaultNotes });
assert.equal(sumUnits(defaultRows), sumUnits(plan), 'padrão: total de saída igual ao de entrada, exatamente');
assertWindowRule(defaultRows, { notes: defaultNotes, fixedValues: [3, 139], label: 'padrão' });
assert.equal(defaultRows[0], 0.01, 'padrão: o furo zerado recebe a carga mínima dos zerados');
assert.equal(defaultRows[planMinimumIndex], 3, 'padrão: a menor carga positiva fica preservada');
assert.equal(defaultRows[1], 139, 'padrão: a maior carga fica preservada');
assert.ok(defaultRows.every((value, index) => index === 0 || value >= 3 || value === 0), 'padrão: nenhum furo positivo abaixo da menor carga');
assert.ok(defaultNotes.some(note => /ajustada para manter 0,6 kg/.test(note)), 'padrão: o ajuste pela janela aparece como aviso');
assert.deepEqual(redistribute(plan), defaultRows, 'padrão: a redistribuição é determinística');

// Muitos zerados: escada cíclica de 0,6 kg (0,01; 0,61; 1,21; 1,81), sem dois zerados iguais a até 3 posições.
const manyZeros = [3, 139, ...Array.from({ length: 60 }, () => 0), ...Array.from({ length: 60 }, (_, index) => 5 + (index % 4) * 2)];
const zeroNotes = [];
const zeroRows = redistribute(manyZeros, { notes: zeroNotes });
assert.equal(sumUnits(zeroRows), sumUnits(manyZeros));
assertWindowRule(zeroRows, { notes: zeroNotes, fixedValues: [3, 139], label: 'muitos zerados' });
const zeroLevels = zeroRows.slice(2, 62);
assert.deepEqual([...new Set(zeroLevels)].sort((a, b) => a - b), [0.01, 0.61, 1.21, 1.81]);
assert.ok(zeroLevels.every((value, index) => index < 4 || value === zeroLevels[index - 4]), 'a escada se repete a cada 4 zerados');

// Menor carga positiva muito pequena: a diferença entre zerados e o mínimo cai (com aviso), e a janela continua valendo.
const tightInput = [0.05, ...Array.from({ length: 8 }, () => 0), 40, 139, 60];
const tightNotes = [];
const tightRows = redistribute(tightInput, { notes: tightNotes });
assert.equal(sumUnits(tightRows), sumUnits(tightInput));
assertWindowRule(tightRows, { notes: tightNotes, fixedValues: [0.05, 139], label: 'faixa curta' });
assert.ok(tightRows.slice(1, 9).every(value => value >= 0.01 && value < 0.05), 'zerados ficam entre o mínimo dos zerados e a menor carga');
assert.ok(tightNotes.some(note => /ficou em 0,01 kg/.test(note)), 'a redução da diferença aparece como aviso');

// Recusas explícitas.
assert.throws(() => redistribute([0.01, 0, 5, 139]), /deve ser menor que a menor carga positiva/);
assert.throws(() => redistribute([5, 0, 5, 0, 5, 139]), /suficiente acima da menor carga positiva/);
assert.throws(() => redistribute([28.49, 28.49, 56.553]), /Não há como manter cargas distintas/);
assert.throws(() => redistribute([5, 0, 6.0000001, 139]), /seis casas decimais/);
assert.throws(() => redistributeZeroCharges([5, 0, 6, 139], { enabled: true, zeroChargeMinimum: 0.01 }), /windowSize|chargeWindowSize/);

// Furos de carga fixa a até 3 posições (duas cargas máximas iguais): mantidos como vieram, com aviso, sem recusa.
const uniformNotes = [];
assert.deepEqual(redistribute([10, 10, 10], { notes: uniformNotes }), [10, 10, 10]);
assert.ok(uniformNotes.some(note => note.includes(PINNED_MARKER)), 'o aviso de furos fixos precisa aparecer');

// Furo de assinatura: mantém a entrada; o furo de 23 kg vizinho dele é separado.
const signatureInput = [5, 0, 23, 23, 139, 40];
const signatureNotes = [];
const signatureRows = redistribute(signatureInput, { fixedIndexes: [2], notes: signatureNotes });
assert.equal(signatureRows[2], 23, 'padrão: furo de assinatura mantém a entrada');
assert.ok(Math.abs(signatureRows[3] - 23) >= GAP - 1e-9, 'padrão: o furo vizinho ao de assinatura fica a 0,6 kg dele');
assert.equal(sumUnits(signatureRows), sumUnits(signatureInput));
assertWindowRule(signatureRows, { notes: signatureNotes, fixedValues: [139], label: 'assinatura' });
// Furo de assinatura com a menor carga: ele mantém a entrada e os demais furos de 5 kg sobem acima dele.
const signatureMinimumRows = redistribute([5, 5, 5, 0, 23, 139], { fixedIndexes: [1] });
assert.equal(signatureMinimumRows[1], 5, 'padrão: furo de assinatura com a menor carga mantém a entrada');
assert.equal(sumUnits(signatureMinimumRows), sumUnits([5, 5, 5, 0, 23, 139]));
assert.ok(signatureMinimumRows[0] > 5 && signatureMinimumRows[2] > 5, 'padrão: os outros furos de 5 kg sobem acima do mínimo');
assertWindowRule(signatureMinimumRows, { fixedValues: [5, 139], label: 'assinatura na menor carga' });

// Bloco de carga-alvo (entrada original, como em buildRows): mínimo informado de 3 kg e de 21 kg, total = soma da entrada.
const blockTarget = sumUnits(plan) / 1e6;
for (const minimum of [3, 21]) {
  const blockNotes = [];
  const blockRows = distribute(plan, blockTarget, {
    minimumIndex: planMinimumIndex, minimumValue: minimum, maximumIndex: 1, maximumValue: 139, maximumIndexes: [1], notes: blockNotes
  });
  assert.equal(sumUnits(blockRows), sumUnits(plan), `bloco ${minimum}: total fechado exatamente`);
  assert.equal(blockRows[planMinimumIndex], minimum, `bloco ${minimum}: furo de menor carga exatamente no mínimo`);
  assert.equal(blockRows[1], 139, `bloco ${minimum}: maior carga preservada`);
  assert.ok(blockRows.every(value => value >= minimum), `bloco ${minimum}: nenhum furo abaixo do mínimo`);
  assertWindowRule(blockRows, { notes: blockNotes, fixedValues: [minimum, 139], label: `bloco ${minimum}` });
}

// Varredura determinística da redistribuição padrão: zerados, cargas repetidas e furo de assinatura.
const sweep = scenarioRandom(20261117);
let sweptSolved = 0;
for (let scenario = 0; scenario < 200; scenario += 1) {
  const count = 4 + Math.floor(sweep() * 150);
  const values = Array.from({ length: count }, () => {
    const draw = sweep();
    if (draw < 0.2) return 0;
    if (draw < 0.6) return [5, 8, 8.5, 12, 21, 23][Math.floor(sweep() * 6)];
    return Math.round((1 + sweep() * 60) * 1000) / 1000;
  });
  values[count - 1] = 139;
  values[count - 2] = 2;
  const candidates = values.map((value, index) => index).filter(index => values[index] > 0 && index < count - 2);
  const fixedIndexes = sweep() < 0.3 && candidates.length ? [candidates[Math.floor(sweep() * candidates.length)]] : [];
  const notes = [];
  let rows;
  try {
    rows = redistribute(values, { fixedIndexes, notes });
  } catch (error) {
    assert.match(error.message, /não cabem|Não há|não há|Não foi possível|Não há como manter|mínimo dos furos zerados|pequena demais/, `cenário ${scenario}: ${error.message}`);
    continue;
  }
  sweptSolved += 1;
  assert.equal(sumUnits(rows), sumUnits(values), `cenário ${scenario}: total`);
  fixedIndexes.forEach(index => assert.equal(rows[index], values[index], `cenário ${scenario}: furo de assinatura`));
  const minimumPositive = Math.min(...values.filter(value => value > 0));
  assert.ok(rows.every((value, index) => {
    if (fixedIndexes.includes(index)) return true;
    if (values[index] === 0) return value >= 0.01 && value < minimumPositive;
    return value >= minimumPositive;
  }), `cenário ${scenario}: limite inferior`);
  assert.ok(rows.every((value, index) => index === count - 1 || value < 139 || fixedIndexes.includes(index)), `cenário ${scenario}: limite superior`);
  assertWindowRule(rows, { notes, fixedValues: [minimumPositive, 139, ...fixedIndexes.map(index => values[index])], label: `cenário ${scenario}` });
}
assert.ok(sweptSolved > 150, `a maioria dos cenários de redistribuição padrão precisa fechar (${sweptSolved}/200)`);

console.log('charge tests passed');
