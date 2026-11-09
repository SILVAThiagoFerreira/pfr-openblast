(function attachSignatureHole(root) {
  'use strict';
  // Furo de assinatura: validação do ID e do tempo de detonação do furo. Módulo puro (sem DOM).
  // Regras em SPEC.md, seção "Furo de assinatura"; espelho em src/pfr/validation.py (validate_signature_hole).

  function coded(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  // ID digitado ou configurado: somente dígitos, como o Number do Config Final. Retorna o número.
  function parseHoleId(raw) {
    const text = String(raw ?? '').trim();
    if (!text) {
      throw coded('SIGNATURE_HOLE_INVALID', 'Informe o ID do furo de assinatura ou desmarque "Plano teve furo de assinatura?".');
    }
    if (!/^\d+$/.test(text)) {
      throw coded('SIGNATURE_HOLE_INVALID', `O ID do furo de assinatura deve ser o número do furo, como aparece no Config Final (ex.: 245). Valor informado: "${text}".`);
    }
    return Number(text);
  }

  // Posição do furo em `numbers` (Number já convertido). Ausente ou repetido bloqueia com mensagem explícita.
  function findHoleIndex(numbers, holeId) {
    const indexes = [];
    numbers.forEach((number, index) => {
      if (number === holeId) indexes.push(index);
    });
    if (!indexes.length) {
      throw coded(
        'SIGNATURE_HOLE_NOT_FOUND',
        `O furo de assinatura ${holeId} não foi encontrado no plano realizado (Config Final). ` +
        'Confira o ID; um furo marcado como eliminated só entra no plano quando business.include_eliminated está ativo.'
      );
    }
    if (indexes.length > 1) {
      throw coded('SIGNATURE_HOLE_DUPLICATED', `O ID do furo de assinatura ${holeId} aparece mais de uma vez no Config Final.`);
    }
    return indexes[0];
  }

  // O tempo do furo de assinatura é preservado, então não pode ser imputado: precisa ser inteiro,
  // não negativo e único depois do arredondamento. `rawTimes` tem números ou null.
  function validateTime(rawTimes, index, holeId) {
    const raw = rawTimes[index];
    const message = `O furo de assinatura ${holeId} não tem tempo de detonação válido na entrada ` +
      '(vazio, negativo, não inteiro ou repetido em outro furo). Como o tempo deve ser preservado como veio da entrada, corrija o Config Final.';
    if (raw === null || raw === undefined || !Number.isInteger(raw) || raw < 0) {
      throw coded('SIGNATURE_HOLE_TIME', message);
    }
    const sameTime = rawTimes.filter(value => value !== null && value !== undefined && value >= 0 && Math.round(value) === raw).length;
    if (sameTime !== 1) {
      throw coded('SIGNATURE_HOLE_TIME', message);
    }
  }

  root.OpenBlastSignatureHole = { parseHoleId, findHoleIndex, validateTime };
})(typeof window !== 'undefined' ? window : globalThis);
