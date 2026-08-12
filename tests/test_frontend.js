const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicRoot = path.resolve('public');
const docsRoot = path.resolve('docs');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(publicRoot, 'timezone.js'), 'utf8'), context, { filename: 'public/timezone.js' });
const timezone = context.window.OpenBlastTimezone;

assert.equal(timezone.parseOffset('-03:00'), -180);
assert.equal(timezone.formatOffset(-180), '-03:00');
assert.deepEqual(JSON.parse(JSON.stringify(timezone.convertEvent({ date: '16/07/2026', time: '02:30:00' }, '-03:00'))), {
  date: '15/07/2026',
  time: '23:30:00',
  timezoneOffset: '-03:00'
});
assert.deepEqual(JSON.parse(JSON.stringify(timezone.convertEvent({ date: '16/07/2026', time: '12:30:00', planId: '290726' }, 'none'))), {
  date: '16/07/2026',
  time: '12:30:00',
  planId: '290726',
  timezoneOffset: null
});
assert.deepEqual(JSON.parse(JSON.stringify(timezone.convertEvent({ date: '04/08/2026', time: '12:00:00', timeSource: 'force-default' }, '-03:00'))), {
  date: '04/08/2026',
  time: '12:00:00',
  timeSource: 'force-default',
  timezoneOffset: null
});

for (const root of [publicRoot, docsRoot]) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(html, /accept="[^"]*\.log/);
  assert.match(html, /id="timezone-offset"/);
  assert.match(html, /value="-03:00"/);
  assert.match(html, /id="plan-identity"/);
  assert.match(html, /for="plan-identity"[^>]*>ID \/ nome do plano de fogo em trabalho/);
  assert.match(html, /id="manual-fire-time"/);
  assert.match(html, /for="manual-fire-time"[^>]*>Horário local do desmonte/);
  assert.match(html, /id="manual-fire-time-error"/);
  assert.match(html, /id="force-submit"[^>]*>Forçar execução/);
  assert.match(html, /force-execution\.css/);
  assert.match(html, /\.\/modelos\/modelo-pre-corte-sem-furos\.xlsx/);
  assert.match(html, /\.\/modelos\/modelo-producao\.xls/);
  assert.match(app, /\.(?:txt|log)/);
  assert.match(app, /Historial da DRB/);
  assert.equal(fs.existsSync(path.join(root, 'modelos', 'modelo-pre-corte-sem-furos.xlsx')), true);
  assert.equal(fs.existsSync(path.join(root, 'modelos', 'modelo-producao.xls')), true);
  assert.equal(fs.existsSync(path.join(root, 'force-execution.css')), true);
  assert.match(app, /parseManualPlanId/);
  assert.match(app, /manualFireTime/);
  assert.match(app, /12:00:00/);
  assert.match(app, /MISSING_FIRE_TIME/);
  assert.match(app, /runGeneration\(true\)/);
}

for (const file of ['index.html', 'app.js', 'plan-id.js', 'force-execution.css']) {
  assert.equal(fs.readFileSync(path.join(publicRoot, file), 'utf8'), fs.readFileSync(path.join(docsRoot, file), 'utf8'), `${file} must stay in sync`);
}

console.log('frontend tests passed');
