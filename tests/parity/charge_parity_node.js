// Executa public/charge.js (a referência do site) sobre casos de teste em JSON e imprime os resultados em JSON.
// Usado por tests/test_charge_parity.py para garantir que a CLI Python produz exatamente os mesmos valores.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'charge.js'), 'utf8'), context, { filename: 'public/charge.js' });
const { distributeCharges, redistributeZeroCharges } = context.window.OpenBlastCharge;

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const results = cases.map(testCase => {
  const notes = [];
  try {
    if (testCase.mode === 'zero') {
      const out = redistributeZeroCharges(testCase.values, {
        enabled: true,
        zeroChargeMinimum: testCase.zeroMinimum,
        fixedIndexes: testCase.fixedIndexes,
        windowSize: testCase.windowSize,
        windowMinGapKg: testCase.windowMinGapKg,
        notes
      });
      return { ok: true, out: out.map(value => (value === null ? null : value)), notes };
    }
    const out = distributeCharges(testCase.values, testCase.target, {
      stepKg: testCase.stepKg,
      minimumIndex: testCase.minimumIndex,
      minimumValue: testCase.minimumValue,
      maximumIndex: testCase.maximumIndex,
      maximumValue: testCase.maximumValue,
      maximumIndexes: testCase.maximumIndexes,
      fixedIndexes: testCase.fixedIndexes,
      windowSize: testCase.windowSize,
      windowMinGapKg: testCase.windowMinGapKg,
      notes
    });
    return { ok: true, out, notes };
  } catch (error) {
    return { ok: false, error: String(error.message) };
  }
});
process.stdout.write(JSON.stringify(results));
