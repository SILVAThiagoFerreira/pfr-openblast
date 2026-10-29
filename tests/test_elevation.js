const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Regressão do Z de saída (cenário REG CRISTA F3, 27/10/2026). O Config Final desse export
// traz em "Z" valores com a ordem de grandeza de X (748775,62 para o furo 171), não cota.
// A cota vem do Plano de Perfuração (Z Collar), conferindo X/Y pelo mesmo Number.
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/elevation.js', 'utf8'), context, { filename: 'public/elevation.js' });
const elevation = context.window.OpenBlastElevation;

// Usa os limites reais publicados em public/config.js.
const configContext = { window: {} };
vm.runInNewContext(fs.readFileSync('public/config.js', 'utf8'), configContext, { filename: 'public/config.js' });
const business = configContext.window.PFR_BROWSER_CONFIG.business;
const config = {
  minM: business.elevationPlausibleMinM,
  maxM: business.elevationPlausibleMaxM,
  matchToleranceM: business.elevationDesignMatchToleranceM,
};
assert.equal(config.minM, -500);
assert.equal(config.maxM, 5000);
assert.equal(config.matchToleranceM, 0.5);

const near = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `esperado ${expected}, obtido ${actual}`
);

// Valores copiados de "configuração final.csv" e "Crista_F3.xlsx" (aba PROJETO PERFURAÇÃO).
const scenarioHoles = [
  { number: 171, x: 748776.29, y: 8930000.78, z: 748775.62, zToe: 748767.506, length: 8.4, angle: 15 },
  { number: 172, x: 748774.81, y: 8929998.76, z: 748774.81, zToe: 748766.81, length: 8.0, angle: 0 },
  { number: 175, x: 748777.78, y: 8929998.76, z: 748777.78, zToe: 748769.28, length: 8.5, angle: 0 },
  { number: 326, x: 748897.33, y: 8930052.64, z: 748897.33, zToe: 748885.33, length: 12.0, angle: 0 },
  { number: 1000, x: 748899.67, y: 8930052.599, z: 748899.67, zToe: 748887.47, length: 12.2, angle: 0 },
  { number: 1002, x: 748890.676, y: 8930040.858, z: 748890.676, zToe: 748878.876, length: 11.8, angle: 0 },
];
const scenarioDesign = [
  { number: 171, x: 748776.29, y: 8930000.78, z: 287.63 },
  { number: 172, x: 748774.81, y: 8929998.76, z: 287.5 },
  { number: 175, x: 748777.78, y: 8929998.76, z: 287.81 },
  { number: 326, x: 748897.33, y: 8930052.64, z: 292.27 },
];

// 1) Caso real: Z do Config Final é coordenada; cota e toe vêm do plano e da geometria realizada.
const scenario = elevation.resolveElevations(scenarioHoles, scenarioDesign, config);
const h171 = scenario.byNumber.get(171);
assert.equal(h171.crestSource, 'design');
near(h171.zCrest, 287.63);
assert.equal(h171.toeSource, 'computed');
near(h171.zToe, 287.63 - 8.4 * Math.cos((15 * Math.PI) / 180), 1e-6);
near(h171.zToe, 279.516223, 1e-6);
near(scenario.byNumber.get(172).zCrest, 287.5);
near(scenario.byNumber.get(172).zToe, 279.5, 1e-9);
near(scenario.byNumber.get(175).zCrest, 287.81);
near(scenario.byNumber.get(326).zCrest, 292.27);
near(scenario.byNumber.get(326).zToe, 280.27, 1e-9);
// Furos fora do plano não recebem a coordenada X como cota.
assert.equal(scenario.byNumber.get(1000).zCrest, null);
assert.equal(scenario.byNumber.get(1000).zToe, null);
assert.equal(scenario.byNumber.get(1002).zCrest, null);
assert.equal(scenario.counts.design, 4);
assert.equal(scenario.counts.final, 0);
assert.equal(scenario.counts.toeComputed, 4);
// Nenhum Z de saída pode ter magnitude de coordenada (748.xxx).
for (const value of scenario.byNumber.values()) {
  if (value.zCrest !== null) assert.ok(value.zCrest < 1000, 'Z (crest) não pode ser coordenada');
}
const warnings = scenario.warnings.join('\n');
assert.match(warnings, /Config Final: o Z de 6 furo\(s\) não é cota/);
assert.match(warnings, /Z \(crest\) de 4 furo\(s\) obtido do Plano de Perfuração \(Z Collar\)/);
assert.match(warnings, /Sem cota \(Z\) válida para 2 furo\(s\): 1000 \(não consta no plano de perfuração\); 1002 \(não consta no plano de perfuração\)/);
assert.match(warnings, /Z \(toe\) de 4 furo\(s\) calculado/);

// 2) Cota válida no Config Final: é usada tal como vem, sem consultar o plano.
const finalValid = elevation.resolveElevations(
  [{ number: 197, x: 748000, y: 8930000, z: 209.759, zToe: 199.259, length: 10.5, angle: 0 }],
  [],
  config
);
assert.equal(finalValid.byNumber.get(197).crestSource, 'final');
near(finalValid.byNumber.get(197).zCrest, 209.759);
assert.equal(finalValid.byNumber.get(197).toeSource, 'final');
near(finalValid.byNumber.get(197).zToe, 199.259);
assert.equal(finalValid.warnings.length, 0);

// 3) Z válido, Z_Toe inválido: o toe é calculado pela geometria, sem usar o Z_Toe do Config Final.
const toeInvalid = elevation.resolveElevations(
  [{ number: 5, x: 1, y: 2, z: 100, zToe: 748000, length: 10, angle: 0 }],
  [],
  config
);
assert.equal(toeInvalid.byNumber.get(5).toeSource, 'computed');
near(toeInvalid.byNumber.get(5).zToe, 90);

// 4) X/Y fora da tolerância: o furo não recebe a cota do plano.
const mismatch = elevation.resolveElevations(
  [
    { number: 171, x: 748776.29, y: 8930000.78, z: 748775.62, zToe: 748767.506, length: 8.4, angle: 15 },
    { number: 175, x: 748779.78, y: 8929998.76, z: 748777.78, zToe: 748769.28, length: 8.5, angle: 0 },
  ],
  scenarioDesign.filter(row => [171, 175].includes(row.number)),
  config
);
assert.equal(mismatch.byNumber.get(175).zCrest, null);
assert.equal(mismatch.byNumber.get(175).zToe, null);
assert.match(mismatch.warnings.join('\n'), /Sem cota \(Z\) válida para 1 furo\(s\): 175 \(X\/Y diverge do plano em 2 m\)/);
near(mismatch.byNumber.get(171).zCrest, 287.63);

// 5) Sem nenhuma cota válida: erro explícito, não coluna vazia em silêncio.
assert.throws(
  () => elevation.resolveElevations(scenarioHoles.slice(0, 2), [], config),
  /Não há cota \(Z\) válida para nenhum furo\. O Z do Config Final não é cota \(faixa de -500 a 5000 m\)/
);

// 6) Sem comprimento ou inclinação, Z (toe) fica vazio e é contado como ausente.
const noGeometry = elevation.resolveElevations(
  [{ number: 9, x: 1, y: 2, z: 300, zToe: null, length: null, angle: 0 }],
  [],
  config
);
assert.equal(noGeometry.byNumber.get(9).zCrest, 300);
assert.equal(noGeometry.byNumber.get(9).zToe, null);
assert.equal(noGeometry.counts.toeMissing, 1);

console.log('elevation tests passed');
