(function attachStemming(root) {
  'use strict';
  // Tampão realizado: variação determinística simulada (SPEC.md, "Simulação de teste"). Módulo puro (sem DOM).
  // Espelho em src/pfr/processing.py (_apply_stemming_variation).

  async function sha256(bytes) {
    if (globalThis.crypto?.subtle) return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return new Uint8Array([hash >>> 24, hash >>> 16, hash >>> 8, hash, hash >>> 16, hash >>> 8, hash >>> 24, hash]);
  }

  // options: { enabled, maxDelta, preservedIndexes }. Furos em preservedIndexes (furo de assinatura)
  // mantêm o tampão de entrada exato, sem variação e sem arredondamento de uma casa.
  async function applyVariation(values, numbers, planId, options = {}) {
    const { enabled = false, maxDelta = 0.12, preservedIndexes = [] } = options;
    if (!enabled) return values;
    const preserved = new Set(preservedIndexes);
    const result = values.slice();
    const encoder = new TextEncoder();
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === null || numbers[index] === null || preserved.has(index)) continue;
      const digest = await sha256(encoder.encode(`${planId}:${Math.trunc(numbers[index])}:stemming`));
      const magnitude = (((digest[0] * 0x1000000) + (digest[1] * 0x10000) + (digest[2] * 0x100) + digest[3]) / 0xFFFFFFFF) * maxDelta;
      const sign = digest[4] % 2 ? 1 : -1;
      result[index] = Math.max(0, Math.round((result[index] + sign * magnitude) * 100) / 100);
    }
    return result.map((value, index) => (value === null || preserved.has(index) ? value : Math.round(value * 10) / 10));
  }

  root.OpenBlastStemming = { applyVariation };
})(typeof window !== 'undefined' ? window : globalThis);
