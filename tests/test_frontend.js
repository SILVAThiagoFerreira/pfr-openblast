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
  assert.match(html, /obrigatório sem o Historial da DRB/);
  assert.match(html, /id="force-submit"[^>]*>Forçar execução/);
  assert.match(html, /id="charge-target-input"/);
  assert.match(html, /id="charge-minimum-input"/);
  assert.match(html, /for="charge-minimum-input"[^>]*>Carga mínima por furo/);
  assert.match(html, /id="charge-minimum-hole-id"/);
  assert.match(html, /for="charge-minimum-hole-id"[^>]*>ID do furo de menor carga/);
  assert.match(html, /id="charge-minimum-suggestion"/);
  assert.match(html, /Máximo preservado/);
  assert.match(html, /force-execution\.css/);
  const expectedModels = [
    {
      href: './modelos/Plano%20de%20Fogo%20-%20PC.xls',
      download: 'Plano de Fogo - PC.xls',
      filename: 'Plano de Fogo - PC.xls',
    },
    {
      href: './modelos/Plano%20de%20Fogo%20Realizado%20-%20PP.xlsx',
      download: 'Plano de Fogo Realizado - PP.xlsx',
      filename: 'Plano de Fogo Realizado - PP.xlsx',
    },
    {
      href: './modelos/Plano%20Realizado%20-%20REG%20.xls',
      download: 'Plano Realizado - REG .xls',
      filename: 'Plano Realizado - REG .xls',
    },
  ];
  for (const model of expectedModels) {
    assert.ok(html.includes(`href="${model.href}" download="${model.download}"`), `${model.download} link must preserve the source filename`);
    assert.equal(fs.existsSync(path.join(root, 'modelos', model.filename)), true, `${model.filename} must exist`);
  }
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'modelos')).sort(),
    expectedModels.map((model) => model.filename).sort(),
    'only the three authoritative model files should be published',
  );
  assert.match(app, /\.(?:txt|log)/);
  assert.match(app, /Historial da DRB/);
  assert.equal(fs.existsSync(path.join(root, 'force-execution.css')), true);
  assert.match(app, /parseManualPlanId/);
  assert.match(app, /manualFireTime/);
  assert.match(app, /12:00:00/);
  assert.match(app, /MISSING_FIRE_TIME/);
  assert.match(app, /allowMissingHistory/);
  assert.match(app, /historySource === 'missing'/);
  assert.match(app, /dateSource === 'browser'/);
  assert.match(app, /data local do navegador/);
  assert.match(app, /runGeneration\(true\)/);
  assert.match(app, /Anexe os arquivos do plano para continuar/);
  assert.match(app, /maximumIndexes/);
  assert.match(app, /chargeMetadata/);
  assert.match(app, /não pode pertencer a um furo de maior carga original/);
  assert.match(app, /includeEliminated/);
  assert.match(app, /refreshChargeMinimumSuggestion/);
  assert.match(app, /Furos no Config Final/);
}

for (const file of ['index.html', 'app.js', 'config.js', 'plan-id.js', 'force-execution.css', 'styles.css', 'charge.js']) {
  assert.equal(fs.readFileSync(path.join(publicRoot, file), 'utf8'), fs.readFileSync(path.join(docsRoot, file), 'utf8'), `${file} must stay in sync`);
}

console.log('frontend tests passed');
