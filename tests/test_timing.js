const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/timing.js', 'utf8'), context, { filename: 'public/timing.js' });
const fillMissingTimes = context.window.OpenBlastTiming.fillMissingTimes;

function assertUnique(values) {
  assert.equal(values.every(value => Number.isInteger(value) && value >= 0), true);
  assert.equal(new Set(values).size, values.length);
}

assert.deepEqual(fillMissingTimes([1000, -1, -5, 1300]).values, [1000, 1100, 1200, 1300]);
assert.deepEqual(fillMissingTimes([1000, 1000, 1300]).values, [1000, 1150, 1300]);
assert.deepEqual(fillMissingTimes([10067, -1, -1]).values, [10067, 10068, 10069]);
assert.deepEqual(fillMissingTimes([-1, -1, 1000]).values, [998, 999, 1000]);
assert.deepEqual(fillMissingTimes([0, -1, 5]).values, [0, 2, 5]);
assertUnique(fillMissingTimes([1000, 1000, 1000]).values);
assertUnique(fillMissingTimes([null, '', 'invalido', Infinity]).values);

console.log('timing tests passed');
