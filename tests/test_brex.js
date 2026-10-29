const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/plan-id.js', 'utf8'), context, { filename: 'public/plan-id.js' });
vm.runInNewContext(fs.readFileSync('public/brex.js', 'utf8'), context, { filename: 'public/brex.js' });
const brex = context.window.OpenBlastBrex;
// Arrays criados dentro do vm têm outro realm; a cópia JSON permite comparar com literais.
const plain = value => JSON.parse(JSON.stringify(value));

// Amostra real reduzida: cabeçalho completo do BREX de 27/10/2026 (BMO 312) com 3 detonadores.
const fixture = fs.readFileSync(path.join('tests', 'fixtures', 'BMO312_20261027.brex'), 'utf8');
const parsed = brex.parseBrex(fixture, 'BMO312_20261027.brex');
assert.equal(parsed.detonations.length, 1);
assert.equal(parsed.warnings.length, 0);
const [shot] = parsed.detonations;
assert.equal(shot.bmoSerial, '312');
assert.equal(shot.displayName, 'REG_41__');
assert.equal(shot.planIds.length, 0);
assert.equal(shot.eventNumber, '3221793113124');
assert.equal(shot.detonators, 204);
assert.equal(shot.date, '2026-10-27');
assert.equal(shot.time, '15:00:56');
assert.equal(brex.parseBrex('﻿' + fixture, 'bom.brex').detonations[0].time, '15:00:56');

// O BMO grava 15:00:56; com o ajuste padrão de -3 h o horário local é 12:00.
const local = brex.adjustDetonation(shot, -3);
assert.deepEqual(
  { date: local.date, time: local.time, dateIso: local.dateIso },
  { date: '27/10/2026', time: '12:00:56', dateIso: '2026-10-27' }
);
assert.equal(brex.adjustDetonation(shot, 0).time, '15:00:56');
assert.equal(brex.adjustDetonation(shot, 12).date, '28/10/2026');
assert.equal(brex.adjustDetonation(shot, 12).time, '03:00:56');

// Sem correspondência com o ID digitado: o rótulo do evento é o ID digitado.
const unmatched = brex.rankDetonations(parsed.detonations, { query: 'CRISTA F3', fireDateIso: '2026-10-27', offsetHours: -3 });
assert.equal(unmatched[0].score, 0);
assert.equal(unmatched[0].sameDate, true);
assert.equal(brex.eventLabel(shot, 'CRISTA F3'), 'CRISTA F3');
assert.equal(brex.eventLabel(shot, ''), 'REG_41__');
// Nome do BMO combina com o texto digitado sem acento, caixa, espaço ou pontuação.
assert.equal(brex.rankDetonations(parsed.detonations, { query: 'reg 41', offsetHours: -3 })[0].score, 100);
assert.equal(brex.rankDetonations(parsed.detonations, { query: 'Reg-41', offsetHours: -3 })[0].score, 100);

// Ajuste: inteiro de horas dentro dos limites; o restante é recusado.
assert.equal(brex.parseOffsetHours('-3', -12, 14), -3);
assert.equal(brex.parseOffsetHours('+2', -12, 14), 2);
for (const bad of ['', 'abc', '2.5', '-13', '15', '--1']) {
  assert.throws(() => brex.parseOffsetHours(bad, -12, 14), /Ajuste de horário inválido/, `ajuste ${bad} deve ser recusado`);
}

function brexWith(blocks) {
  const data = blocks.map(block => [
    `<DATA DBD_SN="${block.serial}">`,
    `<DISPLAYED_NAME>${block.name}</DISPLAYED_NAME>`,
    '<SUMMARY_UNIT><CHRONO>',
    `<FIRING_DATE>${block.date}</FIRING_DATE>`,
    `<FIRING_TIME_START>${block.time}</FIRING_TIME_START>`,
    '</CHRONO></SUMMARY_UNIT>',
    '</DATA>'
  ].join('')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<DB_BLASTREPORT_EXCHANGE>\n${data}\n</DB_BLASTREPORT_EXCHANGE>`;
}

// Ordem: ID combinando primeiro; depois disparos na data informada; depois cronológica.
const mixed = brex.parseBrex(brexWith([
  { serial: '312', name: 'PP440826', date: '2026/10/27', time: '15:00:00' },
  { serial: '344', name: 'PP440626', date: '2026/10/26', time: '15:10:00' },
  { serial: '328', name: 'PP590926', date: '2026/10/27', time: '14:00:00' },
  { serial: '352', name: '', date: '2026/10/27', time: '11:00:00' }
]), 'mix.brex');
const ranked = brex.rankDetonations(mixed.detonations, { query: 'PP440726', fireDateIso: '2026-10-27', offsetHours: -3 });
assert.deepEqual(plain(ranked.map(entry => entry.detonation.bmoSerial)), ['312', '344', '352', '328']);
assert.deepEqual(plain(ranked.map(entry => entry.score)), [90, 90, 0, 0]);
// Nome igual ao ID digitado (após normalização) pontua 100 e vem na frente do mesmo plano em outro mês.
const exact = brex.rankDetonations(mixed.detonations, { query: 'pp 440626', fireDateIso: '2026-10-27', offsetHours: -3 });
assert.equal(exact[0].detonation.bmoSerial, '344');
assert.equal(exact[0].score, 100);
assert.deepEqual(plain(ranked.map(entry => entry.sameDate)), [true, false, true, true]);
assert.deepEqual(plain(ranked.map(entry => entry.adjusted.time)), ['12:00:00', '12:10:00', '08:00:00', '11:00:00']);
assert.equal(brex.eventLabel(mixed.detonations[0], 'PP440726'), 'Plano 440826');
assert.equal(brex.eventLabel(mixed.detonations[2], 'CRISTA F3'), 'Plano 590926');
assert.equal(brex.eventLabel(mixed.detonations[3], 'CRISTA F3'), 'CRISTA F3');
assert.equal(brex.eventLabel(mixed.detonations[3], ''), 'BMO 352');
assert.deepEqual(plain(brex.parseBrex(brexWith([{ serial: '1', name: '490926_B', date: '2026/09/09', time: '15:00:00' }]), 'a.brex').detonations[0].planIds), ['490926']);
assert.equal(brex.parseBrex(brexWith([{ serial: '1', name: 'REG &amp; 41', date: '2026/10/27', time: '15:00:00' }]), 'a.brex').detonations[0].displayName, 'REG & 41');

// Bloco sem horário de disparo é avisado e ignorado; sem nenhum disparo, a importação falha.
const withEmptyBlock = brex.parseBrex(
  '<DB_BLASTREPORT_EXCHANGE><DATA DBD_SN="312"><DISPLAYED_NAME>A</DISPLAYED_NAME></DATA>'
  + '<DATA DBD_SN="344"><SUMMARY_UNIT><CHRONO><FIRING_DATE>2026/10/27</FIRING_DATE><FIRING_TIME_START>15:00:00</FIRING_TIME_START></CHRONO></SUMMARY_UNIT></DATA></DB_BLASTREPORT_EXCHANGE>',
  'mix2.brex'
);
assert.equal(withEmptyBlock.detonations.length, 1);
assert.equal(withEmptyBlock.warnings.length, 1);
assert.match(withEmptyBlock.warnings[0], /sem horário de disparo/);

assert.throws(() => brex.parseBrex('', 'vazio.brex'), /está vazio/);
assert.throws(() => brex.parseBrex('<outro><x/></outro>', 'x.brex'), /esperado <DB_BLASTREPORT_EXCHANGE>/);
assert.throws(() => brex.parseBrex('<DB_BLASTREPORT_EXCHANGE><DATA></DB_BLASTREPORT_EXCHANGE>', 'x.brex'), /sem abertura correspondente/);
assert.throws(() => brex.parseBrex('<DB_BLASTREPORT_EXCHANGE><DATA DBD_SN="1">', 'x.brex'), /não foi fechada/);
assert.throws(() => brex.parseBrex('texto solto', 'x.brex'), /fora do elemento raiz/);
assert.throws(() => brex.parseBrex(brexWith([{ serial: '312', name: 'X', date: '2026/13/40', time: '15:00:00' }]), 'x.brex'), /data ou horário de disparo inválido/);
assert.throws(() => brex.parseBrex(brexWith([]), 'x.brex'), /nenhum disparo/);

console.log('brex tests passed');
