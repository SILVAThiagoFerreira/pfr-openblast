const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/table-headers.js', 'utf8'), context, { filename: 'public/table-headers.js' });
const headers = context.window.OpenBlastTableHeaders;

const plain = value => JSON.parse(JSON.stringify(value));
const knownColumns = ['Number', 'UTM_X', 'Length_m', 'Total_Charge_kg', 'Angle_deg', 'Z_Toe', 'Length', 'InputedCharge'];
const aliases = { 'Angle (º)': 'Angle_deg', 'Total_Charge (Kg)': 'Total_Charge_kg' };

// Cabeçalhos com caixa, espaços e acentos diferentes são reconhecidos e avisados.
const variant = plain(headers.canonicalizeTable([
  { ' number ': 1, 'utm_x': 2, 'length M': 3, 'z toe': 4, 'Angle (º)': 5, 'Total_Charge (Kg)': 6, 'Foo': 7 }
], { knownColumns, aliases }));
assert.deepEqual(Object.keys(variant.rows[0]).sort(), ['Angle_deg', 'Foo', 'Length_m', 'Number', 'Total_Charge_kg', 'UTM_X', 'Z_Toe'].sort());
assert.equal(variant.rows[0].Number, 1);
assert.equal(variant.rows[0].Z_Toe, 4);
assert.equal(variant.rows[0].Angle_deg, 5);
assert.equal(variant.rows[0].Foo, 7);
// Aliases explícitos não geram aviso; variações de caixa, espaço e acento geram (cabeçalho já sem espaços laterais).
const renamedPairs = variant.renamed.map(change => `${change.from}->${change.to}`).sort();
assert.deepEqual(renamedPairs, ['length M->Length_m', 'number->Number', 'utm_x->UTM_X', 'z toe->Z_Toe']);
assert.equal(variant.renamed.some(change => /Angle|Total_Charge/.test(change.from)), false);

// Coluna com o nome exato tem prioridade sobre a variação de mesmo nome.
const exactFirst = plain(headers.canonicalizeTable([{ Number: 1, number: 2 }], { knownColumns, aliases: {} }));
assert.deepEqual(exactFirst.rows[0], { Number: 1, number: 2 });
assert.deepEqual(exactFirst.renamed, []);

// Variação de caixa casa com uma única coluna (Length), e não com Length_m.
const caseOnly = plain(headers.canonicalizeTable([{ length: 1 }], { knownColumns, aliases: {} }));
assert.deepEqual(caseOnly.rows[0], { Length: 1 });
// Variação que casa com mais de uma coluna conhecida não é adivinhada.
const ambiguousPair = plain(headers.canonicalizeTable([{ 'a b': 1 }], { knownColumns: ['A_B', 'AB'], aliases: {} }));
assert.deepEqual(ambiguousPair.rows[0], { 'a b': 1 });
assert.deepEqual(ambiguousPair.renamed, []);

// Cabeçalhos desconhecidos continuam como estavam.
const unknown = plain(headers.canonicalizeTable([{ Comentario: 'x', 'Coluna livre': 2 }], { knownColumns, aliases }));
assert.deepEqual(unknown.rows[0], { Comentario: 'x', 'Coluna livre': 2 });
assert.deepEqual(unknown.renamed, []);

console.log('table-headers tests passed');
