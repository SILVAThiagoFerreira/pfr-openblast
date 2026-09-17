const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/charge.js', 'utf8'), context, { filename: 'public/charge.js' });
const distributeCharges = context.window.OpenBlastCharge.distributeCharges;

function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

const raised = distributeCharges([5, 10, 15, 60], 100);
assert.equal(total(raised), 100);
assert.equal(raised[0], 5);
assert.equal(raised[3], 60);
assert.deepEqual(raised, distributeCharges([5, 10, 15, 60], 100));
assert.ok(raised.slice(1, 3).every(value => value >= 5 && value <= 60));

const reduced = distributeCharges([5, 20, 40, 60], 100);
assert.equal(total(reduced), 100);
assert.equal(reduced[0], 5);
assert.equal(reduced[3], 60);
assert.ok(reduced.slice(1, 3).every(value => value >= 5 && value <= 60));

const unchanged = distributeCharges([5, 10, 15, 60], 90);
assert.deepEqual(unchanged, [5, 10, 15, 60]);

const zeroAdjusted = distributeCharges([5, 0.5, 19, 0.5, 60], 100, { minimumIndex: 0, maximumIndex: 4 });
assert.equal(total(zeroAdjusted), 100);
assert.equal(zeroAdjusted[0], 5);
assert.equal(zeroAdjusted[4], 60);
assert.ok(zeroAdjusted[1] >= 0.5 && zeroAdjusted[3] >= 0.5);

const manualMinimum = distributeCharges([5, 10, 15, 60], 140, {
  minimumIndex: 1,
  minimumValue: 20,
  maximumIndex: 3,
  maximumValue: 60
});
assert.equal(total(manualMinimum), 140);
assert.equal(manualMinimum[1], 20);
assert.equal(manualMinimum[3], 60);
assert.ok(manualMinimum.slice(0, 3).every(value => value >= 20 && value <= 60));

const manualMinimumAtLowerBound = distributeCharges([5, 10, 15, 60], 120, {
  minimumIndex: 1,
  minimumValue: 20,
  maximumIndex: 3,
  maximumValue: 60
});
assert.deepEqual(manualMinimumAtLowerBound, [20, 20, 20, 60]);

const tiedMaximums = distributeCharges([5, 60, 10, 60], 180, {
  minimumIndex: 0,
  minimumValue: 20,
  maximumIndex: 1,
  maximumIndexes: [1, 3],
  maximumValue: 60
});
assert.equal(total(tiedMaximums), 180);
assert.deepEqual(tiedMaximums, [20, 60, 40, 60]);

assert.throws(() => distributeCharges([5, 60, 10, 60], 180, {
  minimumIndex: 1,
  minimumValue: 20,
  maximumIndex: 1,
  maximumIndexes: [1, 3],
  maximumValue: 60
}), /furos extremos distintos/);

assert.throws(() => distributeCharges([5, 10, 60], 120, {
  minimumIndex: 1,
  minimumValue: 61,
  maximumIndex: 2,
  maximumValue: 60
}), /não pode ser maior que a maior carga/);
assert.throws(() => distributeCharges([5, 10, 60], 70, {
  minimumIndex: 1,
  minimumValue: 10,
  maximumIndex: 2,
  maximumValue: 59
}), /alvo é impossível/);

assert.throws(() => distributeCharges([5, 10, 60], 200), /alvo é impossível/);
assert.throws(() => distributeCharges([5, 10, 60], 50), /alvo é impossível/);
assert.throws(() => distributeCharges([5, 60], 70), /pelo menos três furos/);
assert.throws(() => distributeCharges([5, NaN, 60], 70), /não é válida/);
assert.throws(() => distributeCharges([5, 10, 60], 0), /maior que zero/);

console.log('charge tests passed');
