const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/charge.js', 'utf8'), context, { filename: 'public/charge.js' });
const distributeCharges = context.window.OpenBlastCharge.distributeCharges;
const redistributeZeroCharges = context.window.OpenBlastCharge.redistributeZeroCharges;

// Teto do passo entre as cargas dos furos de carga baixa (espelho de business.charge_minimum_step_kg).
const STEP = 5;

function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function distribute(values, target, options = {}) {
  return distributeCharges(values, target, { stepKg: STEP, ...options });
}

// Gerador determinístico (LCG) só para montar cenários de teste reproduzíveis.
function scenarioRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

// Regra: nenhum furo livre repete a carga de outro, nem a carga mínima, nem a maior carga preservada.
function assertDistinctFreeLoads(values, freeIndexes, minimumIndex, maximumIndexes) {
  const seen = new Map();
  freeIndexes.forEach(index => {
    const key = values[index].toFixed(6);
    assert.ok(!seen.has(key), `carga repetida ${key} nos furos ${seen.get(key)} e ${index}`);
    seen.set(key, index);
  });
  assert.ok(!seen.has(values[minimumIndex].toFixed(6)), 'furo livre repete a carga mínima');
  maximumIndexes.forEach(index => assert.ok(!seen.has(values[index].toFixed(6)), 'furo livre repete a maior carga preservada'));
}

const raised = distribute([5, 10, 15, 60], 100);
assert.equal(total(raised), 100);
assert.equal(raised[0], 5);
assert.equal(raised[3], 60);
assert.deepEqual(raised, distribute([5, 10, 15, 60], 100));
assert.ok(raised.slice(1, 3).every(value => value > 5 && value < 60));

const reduced = distribute([5, 20, 40, 60], 100);
assert.equal(total(reduced), 100);
assert.equal(reduced[0], 5);
assert.equal(reduced[3], 60);
assert.ok(reduced.slice(1, 3).every(value => value > 5 && value < 60));

const zeroAdjusted = distribute([5, 0.5, 19, 0.5, 60], 100, { minimumIndex: 0, maximumIndex: 4 });
assert.equal(total(zeroAdjusted), 100);
assert.equal(zeroAdjusted[0], 5);
assert.equal(zeroAdjusted[4], 60);
assert.ok(zeroAdjusted[1] > 5 && zeroAdjusted[3] > 5 && zeroAdjusted[1] !== zeroAdjusted[3]);

const manualMinimum = distribute([5, 10, 15, 60], 140, {
  minimumIndex: 1,
  minimumValue: 20,
  maximumIndex: 3,
  maximumValue: 60
});
assert.equal(total(manualMinimum), 140);
assert.equal(manualMinimum[1], 20);
assert.equal(manualMinimum[3], 60);
assert.ok([manualMinimum[0], manualMinimum[2]].every(value => value > 20 && value < 60));
assertDistinctFreeLoads(manualMinimum, [0, 2], 1, [3]);

// Alvo no limite inferior: sem folga, os intermediários teriam que repetir a carga mínima. Recusado com mensagem.
assert.throws(() => distribute([5, 10, 15, 60], 120, {
  minimumIndex: 1,
  minimumValue: 20,
  maximumIndex: 3,
  maximumValue: 60
}), /distintas/);

const tiedMaximums = distribute([5, 60, 10, 60], 180, {
  minimumIndex: 0,
  minimumValue: 20,
  maximumIndex: 1,
  maximumIndexes: [1, 3],
  maximumValue: 60
});
assert.equal(total(tiedMaximums), 180);
assert.equal(tiedMaximums[0], 20);
assert.equal(tiedMaximums[1], 60);
assert.equal(tiedMaximums[3], 60);
assert.ok(tiedMaximums[2] > 20 && tiedMaximums[2] < 60);

assert.throws(() => distribute([5, 60, 10, 60], 180, {
  minimumIndex: 1,
  minimumValue: 20,
  maximumIndex: 1,
  maximumIndexes: [1, 3],
  maximumValue: 60
}), /furos extremos distintos/);

assert.throws(() => distribute([5, 10, 60], 120, {
  minimumIndex: 1,
  minimumValue: 61,
  maximumIndex: 2,
  maximumValue: 60
}), /não pode ser maior que a maior carga/);
assert.throws(() => distribute([5, 10, 60], 70, {
  minimumIndex: 1,
  minimumValue: 10,
  maximumIndex: 2,
  maximumValue: 59
}), /alvo é impossível/);

assert.throws(() => distribute([5, 10, 60], 200), /alvo é impossível/);
assert.throws(() => distribute([5, 10, 60], 50), /alvo é impossível/);
assert.throws(() => distribute([5, 60], 70), /pelo menos três furos/);
assert.throws(() => distribute([5, NaN, 60], 70), /não é válida/);
assert.throws(() => distribute([5, 10, 60], 0), /maior que zero/);
assert.throws(() => distributeCharges([5, 10, 60], 100), /chargeMinimumStepKg/);
assert.throws(() => distributeCharges([5, 10, 60], 100, { stepKg: 0 }), /chargeMinimumStepKg/);
assert.throws(() => distribute([5, 10, 60], 100, { minimumIndex: 0, maximumIndex: 2, minimumValue: 5.1234567 }), /seis casas decimais/);

// Escada automática: furos de carga baixa (zerados ou abaixo do mínimo) ficam entre o mínimo e a próxima carga real
// do plano (25 kg aqui), em passo escolhido pelo sistema (teto de 5 kg), na ordem da carga original.
const stairNotes = [];
const stairCase = distribute([21, 0, 0, 0, 25, 30, 60], 205, {
  minimumIndex: 0,
  minimumValue: 21,
  maximumIndex: 6,
  maximumValue: 60,
  maximumIndexes: [6],
  notes: stairNotes
});
assert.deepEqual(stairCase, [21, 22, 23, 24, 25, 30, 60]);
assert.equal(stairNotes.length, 1);
assert.match(stairNotes[0], /abaixo da próxima carga real do plano \(25 kg\)/);

// Muitos furos abaixo do mínimo (caso do site): nenhum repete a carga, todos ficam acima do mínimo e só o escolhido
// fica exatamente nele. Com 60 furos baixos o passo de 0,6 kg não cabe abaixo do máximo, então é reduzido e avisado.
const lowValues = Array.from({ length: 60 }, (_, index) => (index % 3 === 0 ? 0 : 4 + (index % 11)));
const belowMinimum = [...lowValues, 21.5, 26.2, 33.7, 48.05218];
const minimumIndex = belowMinimum.length - 4;
const maximumIndex = belowMinimum.length - 1;
const notes = [];
const spreadCase = distribute(belowMinimum, 1480, {
  minimumIndex,
  minimumValue: 21,
  maximumIndex,
  maximumValue: 48.05218,
  maximumIndexes: [maximumIndex],
  notes
});
assert.equal(Math.round(total(spreadCase) * 1e6), 1480000000);
assert.equal(spreadCase[minimumIndex], 21);
assert.equal(spreadCase[maximumIndex], 48.05218);
assert.ok(spreadCase.every(value => value >= 21 && value <= 48.05218));
assert.equal(spreadCase.filter(value => value === 21).length, 1);
assert.ok(notes.some(note => /o passo entre eles foi ajustado para/.test(note)), 'o passo reduzido precisa aparecer como aviso');
assert.ok(notes.some(note => /também subiram/.test(note)), 'a elevação dos furos baixos precisa aparecer como aviso');
assertDistinctFreeLoads(spreadCase, belowMinimum.map((_, index) => index).filter(index => index !== minimumIndex && index !== maximumIndex), minimumIndex, [maximumIndex]);
assert.deepEqual(distribute(belowMinimum, 1480, {
  minimumIndex,
  minimumValue: 21,
  maximumIndex,
  maximumValue: 48.05218,
  maximumIndexes: [maximumIndex]
}), spreadCase, 'a distribuição deve ser determinística');

// Alvo alto: os demais furos não podem ficar colados no máximo preservado, e nenhum repete a carga.
const highCase = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  23.1, 25.4, 27.9, 31.2, 34.8, 37.6, 40.3, 42.1, 44.9, 46.2, 48.7, 50.3, 51.9, 52.8, 53.6, 54.5, 55.1, 55.8, 56.939, 21.16];
const highMinimumIndex = highCase.length - 1;
const highMaximumIndex = 48;
const high = distribute(highCase, 1665.44, {
  minimumIndex: highMinimumIndex,
  minimumValue: 21.16,
  maximumIndex: highMaximumIndex,
  maximumValue: 56.939,
  maximumIndexes: [highMaximumIndex]
});
assert.equal(Math.round(total(high) * 1e6), 1665440000);
assert.equal(high[highMinimumIndex], 21.16);
assert.equal(high[highMaximumIndex], 56.939);
assertDistinctFreeLoads(high, highCase.map((_, index) => index).filter(index => index !== highMinimumIndex && index !== highMaximumIndex), highMinimumIndex, [highMaximumIndex]);

// Caso do revisor: 100 furos livres perto do máximo (déficit pequeno) continuam distintos.
const nearTop = Array.from({ length: 100 }, (_, index) => 60 + (index % 7) * 0.5);
nearTop[0] = 21;
nearTop[1] = 100;
const nearTopTarget = total(nearTop) - 0.5;
const nearTopResult = distribute(nearTop, nearTopTarget, {
  minimumIndex: 0,
  minimumValue: 21,
  maximumIndex: 1,
  maximumValue: 100,
  maximumIndexes: [1]
});
assert.equal(Math.round(total(nearTopResult) * 1e6), Math.round(nearTopTarget * 1e6));
assertDistinctFreeLoads(nearTopResult, nearTop.map((_, index) => index).filter(index => index > 1), 0, [1]);

// Varredura determinística: em cenários aleatórios, nenhum furo livre repete outro, nem o mínimo, nem o máximo.
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
  let result;
  try {
    result = distribute(values, target, {
      minimumIndex,
      minimumValue: minimum,
      maximumIndex,
      maximumValue: 48.05218,
      maximumIndexes: [maximumIndex]
    });
  } catch (error) {
    assert.match(error.message, /distintas|impossível|muito perto|extremos/, `cenário ${scenario}: ${error.message}`);
    continue;
  }
  solvedScenarios += 1;
  assert.equal(Math.round(total(result) * 1e6), Math.round(target * 1e6), `cenário ${scenario}: total`);
  assert.equal(result[minimumIndex], minimum, `cenário ${scenario}: mínimo`);
  assert.equal(result[maximumIndex], 48.05218, `cenário ${scenario}: máximo`);
  assert.ok(result.every(value => value >= minimum && value <= 48.05218), `cenário ${scenario}: limites`);
  assertDistinctFreeLoads(result, free, minimumIndex, [maximumIndex]);
}
assert.ok(solvedScenarios > 200, 'a maioria dos cenários aleatórios precisa ser resolvida');

// ---- Cargas sem repetição (redistribuição padrão e bloco de carga-alvo) ----
// Caso do REG RAMPA F3 em cópia sintética (o teste não lê os arquivos reais): 1 furo zerado, menor carga positiva de
// 3 kg (4 furos), maior carga de 139 kg (1 furo), cargas de origem repetidas (23 kg x11, 8 kg x10...) e centavos.
const redistribute = (values, options = {}) => redistributeZeroCharges(values, {
  enabled: true, zeroChargeMinimum: 0.01, zeroChargeStepKg: 0.001, ...options
});
const unitsOf = value => Math.round(value * 1e6);
const sumUnits = values => values.reduce((sum, value) => sum + unitsOf(value ?? 0), 0);

// Regra: nenhum par de furos tem a mesma carga, salvo empate no máximo preservado.
function assertNoRepeats(values, maximum, label) {
  const seen = new Map();
  values.forEach((value, index) => {
    if (value === null || value === maximum) return;
    const key = unitsOf(value);
    assert.ok(!seen.has(key), `${label}: carga ${value} repetida nos furos ${seen.get(key)} e ${index}`);
    seen.set(key, index);
  });
}

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
assertNoRepeats(defaultRows, 139, 'padrão');
assert.equal(defaultRows[0], 0.01, 'padrão: o furo zerado recebe a carga mínima dos zerados');
assert.equal(defaultRows[planMinimumIndex], 3, 'padrão: a menor carga positiva fica preservada');
assert.equal(defaultRows[1], 139, 'padrão: a maior carga fica preservada');
assert.ok(defaultRows.every((value, index) => index === 0 || value >= 3 || value === 0), 'padrão: nenhum furo positivo abaixo da menor carga');
assert.ok(Math.max(...plan.map((value, index) => Math.abs(defaultRows[index] - value))) < 0.02, 'padrão: a alteração por furo é pequena');
assert.ok(defaultNotes.some(note => /carga repetida na entrada foram separados/.test(note)), 'padrão: a separação de repetições aparece como aviso');
assert.deepEqual(redistribute(plan), defaultRows, 'padrão: a redistribuição é determinística');

// Muitos zerados: escada de 0,01 kg a 0,069 kg, distinta e abaixo da menor carga positiva.
const manyZeros = [3, 139, ...Array.from({ length: 60 }, () => 0), ...Array.from({ length: 60 }, (_, index) => 5 + (index % 4) * 2)];
const zeroRows = redistribute(manyZeros);
assert.equal(sumUnits(zeroRows), sumUnits(manyZeros));
assertNoRepeats(zeroRows, 139, 'muitos zerados');
const zeroStair = zeroRows.slice(2, 62);
assert.equal(zeroStair[0], 0.01);
assert.ok(zeroStair.every((value, index) => value >= 0.01 && value < 3 && (index === 0 || value > zeroStair[index - 1])), 'escada crescente e abaixo da menor carga');

// Menor carga positiva pequena: a escada é reduzida (com aviso), mas continua distinta e abaixo do mínimo positivo.
const tightInput = [0.05, ...Array.from({ length: 60 }, () => 0), 40, 139, 60];
const tightNotes = [];
const tightRows = redistribute(tightInput, { notes: tightNotes });
assert.equal(sumUnits(tightRows), sumUnits(tightInput));
assertNoRepeats(tightRows, 139, 'escada reduzida');
assert.ok(tightRows.slice(1, 61).every(value => value >= 0.01 && value < 0.05), 'escada reduzida: zerados entre o mínimo dos zerados e a menor carga');
assert.ok(tightNotes.some(note => /foi reduzido/.test(note)), 'a redução do passo aparece como aviso');

// Recusas explícitas: mínimo dos zerados não menor que a menor carga positiva, escada que não cabe, passo ausente.
assert.throws(() => redistribute([0.01, 0, 5, 139]), /deve ser menor que a menor carga positiva/);
assert.throws(() => redistribute([0.010001, 0, 0, 5, 139]), /não cabem em escada/);
assert.throws(() => redistributeZeroCharges([5, 0, 6, 139], { enabled: true, zeroChargeMinimum: 0.01 }), /zeroChargeStepKg/);
assert.throws(() => redistribute([5, 0, 6.0000001, 139]), /seis casas decimais/);

// Furo de assinatura: mantém a entrada; o outro furo de 23 kg é separado dele.
const signatureInput = [5, 0, 23, 23, 139, 40];
const signatureRows = redistribute(signatureInput, { fixedIndexes: [2] });
assert.equal(signatureRows[2], 23, 'padrão: furo de assinatura mantém a entrada');
assert.notEqual(signatureRows[3], 23, 'padrão: o outro furo de 23 kg não repete o furo de assinatura');
assertNoRepeats(signatureRows, 139, 'padrão com furo de assinatura');
assert.equal(sumUnits(signatureRows), sumUnits(signatureInput));
// Furo de assinatura com a menor carga: ele fica no valor de entrada e os demais furos de 5 kg sobem acima dele.
const signatureMinimumRows = redistribute([5, 5, 5, 0, 23, 139], { fixedIndexes: [1] });
assert.equal(signatureMinimumRows[1], 5, 'padrão: furo de assinatura com a menor carga mantém a entrada');
assertNoRepeats(signatureMinimumRows, 139, 'padrão com assinatura na menor carga');
assert.equal(sumUnits(signatureMinimumRows), sumUnits([5, 5, 5, 0, 23, 139]));
assert.ok(signatureMinimumRows[0] > 5 && signatureMinimumRows[2] > 5, 'padrão: os outros furos de 5 kg sobem acima do mínimo');
// Poucos furos livres: separar a repetição exigiria mexer na menor ou na maior carga; a recusa é explícita.
assert.throws(() => redistribute([28.49, 28.49, 56.553]), /faltam furos livres/);

// Bloco de carga-alvo (entrada original, como em buildRows): mínimo 3 kg e mínimo 21 kg, total = soma da entrada.
const blockTarget = sumUnits(plan) / 1e6;
for (const minimum of [3, 21]) {
  const blockRows = distribute(plan, blockTarget, {
    minimumIndex: planMinimumIndex,
    minimumValue: minimum,
    maximumIndex: 1,
    maximumValue: 139,
    maximumIndexes: [1]
  });
  assert.equal(sumUnits(blockRows), sumUnits(plan), `bloco ${minimum}: total fechado exatamente`);
  assert.equal(blockRows[planMinimumIndex], minimum, `bloco ${minimum}: furo de menor carga exatamente no mínimo`);
  assert.equal(blockRows[1], 139, `bloco ${minimum}: maior carga preservada`);
  assertNoRepeats(blockRows, 139, `bloco ${minimum}`);
  assert.ok(blockRows.every(value => value >= minimum), `bloco ${minimum}: nenhum furo abaixo do mínimo`);
}

// Varredura determinística: cargas repetidas, zerados e furo de assinatura. Nos cenários que fecham, nada se repete.
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
  let rows;
  try {
    rows = redistribute(values, { fixedIndexes });
  } catch (error) {
    assert.match(error.message, /não cabem|Não há|não há carga|Não foi possível|mínimo dos furos zerados/, `cenário ${scenario}: ${error.message}`);
    continue;
  }
  sweptSolved += 1;
  assert.equal(sumUnits(rows), sumUnits(values), `cenário ${scenario}: total`);
  assertNoRepeats(rows, 139, `cenário ${scenario}`);
  fixedIndexes.forEach(index => assert.equal(rows[index], values[index], `cenário ${scenario}: furo de assinatura`));
  const minimumPositive = Math.min(...values.filter(value => value > 0));
  assert.ok(rows.every((value, index) => {
    if (fixedIndexes.includes(index)) return true;
    if (values[index] === 0) return value >= 0.01 && value < minimumPositive;
    return value >= minimumPositive;
  }), `cenário ${scenario}: limite inferior`);
  assert.ok(rows.every((value, index) => index === count - 1 || value < 139 || fixedIndexes.includes(index)), `cenário ${scenario}: limite superior`);
}
assert.ok(sweptSolved > 150, 'a maioria dos cenários de redistribuição padrão precisa fechar');

console.log('charge tests passed');
