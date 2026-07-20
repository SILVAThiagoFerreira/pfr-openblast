const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/plan-id.js', 'utf8'), context, { filename: 'public/plan-id.js' });
const planId = context.window.OpenBlastPlanId;

assert.deepEqual(JSON.parse(JSON.stringify(planId.parsePlanId('PP0290426'))), {
  normalized: '290426',
  plan: '29',
  month: '04',
  year: '26',
  comparableKey: '29:26'
});
assert.equal(planId.planIdsMatch('PP0290426', 'PP290726'), true);
assert.equal(planId.planIdsMatch('PP290726', 'PP290726'), true);
assert.equal(planId.planIdsMatch('PP0290426', 'PP400726'), false);
assert.equal(planId.planIdsMatch('PP0290426', 'PP290727'), false);
assert.deepEqual(JSON.parse(JSON.stringify(planId.extractPlanIds('PP290726_D _ TEMPORIZAÇÃO 2 _ PP400726'))), ['PP290726_D', 'PP400726']);

const history = `[BlastingPlan]2026/07/16-12:29:07;84;+34.3\nPP290726\n-\n[Fire]2026/07/16-12:32:49;83;+33.5\n`;
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(history, ['290426']))), {
  planId: '290726', date: '16/07/2026', time: '12:32:49'
});
assert.throws(() => planId.resolvePlanAndFire(
  `${history}[BlastingPlan]2026/07/16-13:29:07;84;+34.3\nPP290726\n-\n[Fire]2026/07/16-13:32:49;83;+33.5\n`,
  ['290426']
), /múltiplos blocos/);

console.log('plan-id tests passed');
