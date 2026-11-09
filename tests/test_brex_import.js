const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor() { this.value = ''; this.hidden = false; this.dataset = {}; this.listeners = {}; this.children = []; this.classList = { toggle() {} }; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  dispatch(name) { for (const fn of this.listeners[name] || []) fn(); }
  setAttribute() {}
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  querySelectorAll() { return this.children.flatMap(item => item.children || []); }
  focus() {}
}
const elements = new Map();
const document = {
  querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
  createElement() { return new Element(); }
};
const detonation = { id: '1', planIds: [], displayName: 'Teste', bmoSerial: 1, fileName: 'teste.brex' };
const window = {
  PFR_BROWSER_CONFIG: { business: { brexOffsetHours: -3, brexOffsetMinHours: -12, brexOffsetMaxHours: 14 } },
  OpenBlastBrex: {
    parseBrex: () => ({ fileName: 'teste.brex', warnings: [], detonations: [detonation] }),
    parseOffsetHours: value => Number(value),
    rankDetonations: (_, { offsetHours }) => [{ detonation, adjusted: offsetHours === -3 ? { dateIso: '2026-10-26', date: '26/10/2026', time: '23:30:00' } : { dateIso: '2026-10-27', date: '27/10/2026', time: '02:30:00' }, score: 0 }],
    eventLabel: () => 'Teste'
  }
};
vm.runInNewContext(fs.readFileSync('public/brex-import.js', 'utf8'), { window, document, TextDecoder });
(async () => {
  await window.OpenBlastBrexImport.importFiles([{ name: 'teste.brex', arrayBuffer: async () => new TextEncoder().encode('xml').buffer }]);
  const date = elements.get('#manual-fire-date'), time = elements.get('#manual-fire-time'), offset = elements.get('#brex-offset-hours');
  elements.get('#brex-list').children[0].children[0].dispatch('click');
  assert.equal(date.value, '2026-10-26');
  assert.equal(time.value, '23:30:00');
  offset.value = '0'; offset.dispatch('input');
  assert.equal(date.value, '2026-10-27');
  assert.equal(time.value, '02:30:00');
  date.value = '2026-10-20'; date.dispatch('input');
  time.value = '10:00:00'; time.dispatch('input');
  offset.value = '-3'; offset.dispatch('input');
  assert.equal(date.value, '2026-10-20');
  assert.equal(time.value, '10:00:00');
  elements.get('#brex-list').children[0].children[0].dispatch('click');
  assert.equal(date.value, '2026-10-26');
  assert.equal(time.value, '23:30:00');
  console.log('BREX date selection and user edits: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
