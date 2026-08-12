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
assert.deepEqual(JSON.parse(JSON.stringify(planId.extractPlanIds('BP: 440826'))), ['BP: 440826']);
assert.equal(planId.parseManualPlanId('PP0440726_D'), '440726');
assert.equal(planId.parseManualPlanId('440726'), '440726');
assert.equal(planId.parseManualPlanId('Plano 440726'), '440726');
assert.equal(planId.parseManualPlanId('Plano de produção'), '');
assert.equal(planId.normalizeFireTime('12:30'), '12:30:00');
assert.equal(planId.normalizeFireTime('12:30:45'), '12:30:45');
assert.equal(planId.normalizeFireTime('25:30'), '');

const history = `[BlastingPlan]2026/07/16-12:29:07;84;+34.3\nPP290726\n-\n[Fire]2026/07/16-12:32:49;83;+33.5\n`;
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(history, ['290426']))), {
  planId: '290726', date: '16/07/2026', time: '12:32:49'
});
assert.throws(() => planId.resolvePlanAndFire(
  `${history}[BlastingPlan]2026/07/16-13:29:07;84;+34.3\nPP290726\n-\n[Fire]2026/07/16-13:32:49;83;+33.5\n`,
  ['290426']
), /múltiplos blocos/);

const startProcedureHistory = `[StartProcedure] 2026/07/16-11:00:00;84;+34.3\nPP400726\n-\n[Fire] 2026/07/16-11:02:00;83;+33.5\n[Fire] 2026/07/16-11:03:00;83;+33.5\n[StartProcedure] 2026/07/16-12:00:00;84;+34.3\nPP290726\n-\n[Fire] 2026/07/16-12:32:49;83;+33.5\n[Fire] 2026/07/16-12:40:00;83;+33.5\n`;
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(startProcedureHistory, ['290426']))), {
  planId: '290726', date: '16/07/2026', time: '12:32:49'
});

const crossMonthHistory = `[StartProcedure] 2026/08/04-15:00:00;84;+34.3\nBP:440826\n-\n[Fire] 2026/08/04-15:29:45;83;+33.5\n`;
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(crossMonthHistory, ['440726']))), {
  planId: '440826', date: '04/08/2026', time: '15:29:45'
});
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(crossMonthHistory, ['440726'], { force: true, manualPlanId: '440726' }))), {
  planId: '440726', date: '04/08/2026', time: '15:29:45', forced: true, histoPlanId: '440826'
});

const dbdHistory = `[HistoryStart] 2026/08/04-10:19:50\n-\n[BlastPlan] 14:52:32\n PU588;012604;117037236398154;227\n-\n[StartProcedure] 15:02:51;56;33.6°C\n-\n[Fire] 15:05:22;56;32.3°C\n-\n[FireDone] 15:05:53;56;32.4°C\nResult: OK\n`;
assert.equal(planId.parseHistoryEvents(dbdHistory).filter(event => event[1] === 'Fire').length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(dbdHistory, ['440726']))), {
  planId: '440726', date: '04/08/2026', time: '15:05:22'
});

const missingFireHistory = `[HistoryStart] 2026/08/04-14:00:00\n-\n[BlastPlan] 14:52:32\n`;
assert.throws(() => planId.resolvePlanAndFire(missingFireHistory, ['440726']), error => error.code === 'MISSING_FIRE_TIME');
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(missingFireHistory, ['440726'], { manualFireTime: '11:30' }))), {
  planId: '440726', date: '04/08/2026', time: '11:30:00', timeSource: 'manual'
});
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(missingFireHistory, ['440726'], { force: true }))), {
  planId: '440726', date: '04/08/2026', time: '12:00:00', forced: true, timeSource: 'force-default'
});
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(dbdHistory, ['440726'], { force: true }))), {
  planId: '440726', date: '04/08/2026', time: '15:05:22', forced: true
});

const unrelatedHistory = `[StartProcedure] 2026/09/04-15:00:00;84;+34.3\nBP:991026\n-\n[Fire] 2026/09/04-15:29:45;83;+33.5\n`;
assert.deepEqual(JSON.parse(JSON.stringify(planId.resolvePlanAndFire(unrelatedHistory, ['440726'], { force: true, manualPlanId: '440726' }))), {
  planId: '440726', date: '04/09/2026', time: '15:29:45', forced: true, histoPlanId: '991026'
});
assert.throws(() => planId.resolvePlanAndFire(crossMonthHistory, ['440726', '550726'], { force: true }), /ID manual/);

console.log('plan-id tests passed');
