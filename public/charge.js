(function attachChargeModule(root) {
  'use strict';

  function decimalPlaces(value) {
    const text = String(value).toLowerCase();
    if (text.includes('e')) {
      const [coefficient, exponentText] = text.split('e');
      return Math.max(0, (coefficient.split('.')[1] || '').length - Number(exponentText));
    }
    return (text.split('.')[1] || '').length;
  }

  function rebalanceUnits(units, adjustable, delta, lowerBound, upperBound) {
    const result = units.slice();
    let remaining = Math.abs(delta);
    const direction = delta > 0 ? 1 : -1;
    while (remaining > 0) {
      const candidates = adjustable.filter(index => direction > 0
        ? result[index] < upperBound
        : result[index] > lowerBound);
      if (!candidates.length) throw new Error('Não foi possível distribuir o alvo dentro dos limites das cargas extremas.');
      const weights = candidates.map(index => Math.max(result[index], 1));
      const weightTotal = weights.reduce((sum, value) => sum + value, 0);
      let consumed = 0;
      candidates.forEach((index, position) => {
        const capacity = direction > 0 ? upperBound - result[index] : result[index] - lowerBound;
        const proposal = Math.min(capacity, Math.floor((remaining * weights[position]) / weightTotal));
        if (proposal > 0) {
          result[index] += direction * proposal;
          consumed += proposal;
        }
      });
      if (consumed === 0) {
        const index = candidates[0];
        result[index] += direction;
        consumed = 1;
      }
      remaining -= consumed;
    }
    return result;
  }

  // Redistribui a carga zerada (furos com carga 0) preservando o total e o menor e o maior valor.
  // options: { enabled, zeroChargeMinimum, chargeTarget, fixedIndexes }. Furos em fixedIndexes (furo de
  // assinatura) mantêm o valor de entrada: não recebem a carga mínima e não são usados para financiá-la.
  function redistributeZeroCharges(values, options = {}) {
    const { enabled = false, zeroChargeMinimum, chargeTarget, fixedIndexes = [] } = options;
    const fixed = new Set(fixedIndexes);
    const result = values.slice();
    const zeroIndexes = result.map((value, index) => (value === 0 && !fixed.has(index) ? index : -1)).filter(index => index >= 0);
    if (!enabled || !zeroIndexes.length) return result;
    const validIndexes = result.map((value, index) => (value !== null && value !== 0 ? index : -1)).filter(index => index >= 0);
    if (validIndexes.length < 3) throw new Error('Não há furos suficientes para redistribuir a carga zerada preservando os extremos.');
    const minIndex = validIndexes.reduce((best, index) => (result[index] < result[best] ? index : best), validIndexes[0]);
    const maxValue = Math.max(...validIndexes.map(index => result[index]));
    const maxIndexes = validIndexes.filter(index => result[index] === maxValue);
    const adjustable = validIndexes.filter(index => index !== minIndex && !maxIndexes.includes(index) && !fixed.has(index));
    const zeroAllocation = zeroChargeMinimum * zeroIndexes.length;
    const adjustableTotal = adjustable.reduce((sum, index) => sum + result[index], 0);
    if (!adjustableTotal || zeroAllocation >= chargeTarget) throw new Error('Não foi possível redistribuir a carga mantendo os extremos.');
    zeroIndexes.forEach(index => { result[index] = zeroChargeMinimum; });
    adjustable.forEach(index => { result[index] -= (result[index] / adjustableTotal) * zeroAllocation; });
    const remainder = Math.round((values.reduce((sum, value) => sum + (value ?? 0), 0) - result.reduce((sum, value) => sum + (value ?? 0), 0)) * 1000) / 1000;
    result[adjustable[0]] = Math.round((result[adjustable[0]] + remainder) * 1000) / 1000;
    if (maxIndexes.some(index => result[index] !== values[index])) throw new Error('A redistribuição alterou indevidamente a maior carga original.');
    return result;
  }

  // Fecha o total em `target` mantendo o menor e a(s) maior(es) carga(s) preservadas.
  // options.fixedIndexes (furo de assinatura): mantêm o valor de entrada exato; o total-alvo inclui a carga
  // fixa e os demais furos intermediários absorvem a diferença.
  function distributeCharges(values, target, options = {}) {
    if (!Array.isArray(values) || values.length < 3) {
      throw new Error('São necessários pelo menos três furos para distribuir uma carga-alvo preservando os extremos.');
    }
    if (!Number.isFinite(target) || target <= 0) {
      throw new Error('O total de carga realizada deve ser um número maior que zero.');
    }

    const charges = values.map((value, index) => {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`A carga realizada do furo ${index + 1} não é válida para a distribuição.`);
      }
      return value;
    });
    const defaultMinimum = Math.min(...charges);
    const defaultMaximum = Math.max(...charges);
    const minimumIndex = Number.isInteger(options.minimumIndex) ? options.minimumIndex : charges.indexOf(defaultMinimum);
    const maximumIndex = Number.isInteger(options.maximumIndex)
      ? options.maximumIndex
      : charges.findIndex((value, index) => index !== minimumIndex && value === defaultMaximum);
    if (minimumIndex < 0 || minimumIndex >= charges.length || maximumIndex < 0 || maximumIndex >= charges.length || minimumIndex === maximumIndex) {
      throw new Error('Não foi possível identificar furos extremos distintos para distribuir a carga.');
    }
    const maximumIndexes = Array.isArray(options.maximumIndexes)
      ? [...new Set(options.maximumIndexes)]
      : [maximumIndex];
    if (!maximumIndexes.length || maximumIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= charges.length)
      || !maximumIndexes.includes(maximumIndex) || maximumIndexes.includes(minimumIndex)) {
      throw new Error('Não foi possível identificar furos extremos distintos para distribuir a carga.');
    }
    const fixedIndexes = Array.isArray(options.fixedIndexes) ? [...new Set(options.fixedIndexes)] : [];
    if (fixedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= charges.length || index === minimumIndex)) {
      throw new Error('O furo de assinatura não pode ser o furo de menor carga: a carga dele é preservada como veio da entrada.');
    }
    const fixed = new Set(fixedIndexes);
    const hasExplicitMinimum = Number.isFinite(options.minimumValue);
    const minimum = hasExplicitMinimum ? options.minimumValue : charges[minimumIndex];
    const maximum = Number.isFinite(options.maximumValue) ? options.maximumValue : charges[maximumIndex];
    if (!Number.isFinite(minimum) || minimum < 0 || (hasExplicitMinimum && minimum === 0)) {
      throw new Error('A carga mínima por furo deve ser um número maior que zero.');
    }
    if (!Number.isFinite(maximum) || maximum < 0) {
      throw new Error('A maior carga preservada deve ser um número maior ou igual a zero.');
    }
    if (minimum > maximum) {
      throw new Error('A carga mínima informada não pode ser maior que a maior carga preservada da planilha.');
    }

    const adjustable = charges.map((_, index) => index).filter(index => index !== minimumIndex && !maximumIndexes.includes(index) && !fixed.has(index));
    if (!adjustable.length) {
      throw new Error('Não há furos intermediários disponíveis para distribuir a carga-alvo.');
    }

    const precision = Math.max(2, decimalPlaces(target), decimalPlaces(minimum), decimalPlaces(maximum), ...charges.map(decimalPlaces));
    const scale = 10 ** Math.min(6, precision);
    const minimumUnits = Math.round(minimum * scale);
    const maximumUnits = Math.round(maximum * scale);
    const targetUnits = Math.round(target * scale);
    const fixedUnits = fixedIndexes.reduce((sum, index) => sum + Math.round(charges[index] * scale), 0);
    const preservedMaximumCount = maximumIndexes.filter(index => !fixed.has(index)).length;
    const lowerBound = minimumUnits + preservedMaximumCount * maximumUnits + fixedUnits + adjustable.length * minimumUnits;
    const upperBound = minimumUnits + preservedMaximumCount * maximumUnits + fixedUnits + adjustable.length * maximumUnits;
    if (targetUnits < lowerBound || targetUnits > upperBound) {
      const lower = lowerBound / scale;
      const upper = upperBound / scale;
      throw new Error(`O alvo é impossível mantendo a menor e a maior carga. Para estes furos, use um total entre ${lower.toFixed(2)} kg e ${upper.toFixed(2)} kg.`);
    }

    const initialUnits = charges.map((value, index) => {
      if (index === minimumIndex) return minimumUnits;
      if (fixed.has(index)) return Math.round(value * scale);
      if (maximumIndexes.includes(index)) return maximumUnits;
      return Math.max(minimumUnits, Math.min(maximumUnits, Math.round(value * scale)));
    });
    // Furos fixos voltam ao valor de entrada exato (sem passar pela escala de unidades).
    const toKg = units => units.map((value, index) => (fixed.has(index) ? charges[index] : value / scale));
    const currentUnits = initialUnits.reduce((sum, value) => sum + value, 0);
    if (targetUnits === currentUnits) return toKg(initialUnits);

    const adjustedUnits = rebalanceUnits(
      initialUnits,
      adjustable,
      targetUnits - currentUnits,
      minimumUnits,
      maximumUnits,
    );
    const result = toKg(adjustedUnits);
    const resultTotal = result.reduce((sum, value) => sum + value, 0);
    if (Math.round(resultTotal * scale) !== targetUnits) {
      throw new Error('A distribuição não fechou exatamente no total informado. Tente um alvo com até seis casas decimais.');
    }
    return result;
  }

  root.OpenBlastCharge = { distributeCharges, redistributeZeroCharges };
})(typeof window !== 'undefined' ? window : globalThis);
