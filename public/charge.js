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

    const adjustable = charges.map((_, index) => index).filter(index => index !== minimumIndex && !maximumIndexes.includes(index));
    if (!adjustable.length) {
      throw new Error('Não há furos intermediários disponíveis para distribuir a carga-alvo.');
    }

    const precision = Math.max(2, decimalPlaces(target), decimalPlaces(minimum), decimalPlaces(maximum), ...charges.map(decimalPlaces));
    const scale = 10 ** Math.min(6, precision);
    const minimumUnits = Math.round(minimum * scale);
    const maximumUnits = Math.round(maximum * scale);
    const targetUnits = Math.round(target * scale);
    const lowerBound = minimumUnits + maximumIndexes.length * maximumUnits + adjustable.length * minimumUnits;
    const upperBound = minimumUnits + maximumIndexes.length * maximumUnits + adjustable.length * maximumUnits;
    if (targetUnits < lowerBound || targetUnits > upperBound) {
      const lower = lowerBound / scale;
      const upper = upperBound / scale;
      throw new Error(`O alvo é impossível mantendo a menor e a maior carga. Para estes furos, use um total entre ${lower.toFixed(2)} kg e ${upper.toFixed(2)} kg.`);
    }

    const initialUnits = charges.map((value, index) => {
      if (index === minimumIndex) return minimumUnits;
      if (maximumIndexes.includes(index)) return maximumUnits;
      return Math.max(minimumUnits, Math.min(maximumUnits, Math.round(value * scale)));
    });
    const currentUnits = initialUnits.reduce((sum, value) => sum + value, 0);
    if (targetUnits === currentUnits) return initialUnits.map(value => value / scale);

    const adjustedUnits = rebalanceUnits(
      initialUnits,
      adjustable,
      targetUnits - currentUnits,
      minimumUnits,
      maximumUnits,
    );
    const result = adjustedUnits.map(value => value / scale);
    const resultTotal = result.reduce((sum, value) => sum + value, 0);
    if (Math.round(resultTotal * scale) !== targetUnits) {
      throw new Error('A distribuição não fechou exatamente no total informado. Tente um alvo com até seis casas decimais.');
    }
    return result;
  }

  root.OpenBlastCharge = { distributeCharges };
})(typeof window !== 'undefined' ? window : globalThis);
