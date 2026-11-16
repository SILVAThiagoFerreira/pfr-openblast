(function attachChargeModule(root) {
  'use strict';

  // Resolução interna de 1e-6 kg: as cargas saem com até seis casas decimais, como o alvo.
  const SCALE = 10 ** 6;
  // Espaçamento máximo entre as cargas mais altas e o máximo preservado: 0,01 kg (se o total permitir).
  const TOP_GAP_UNITS = 10000;
  // Separação entre cargas de origem iguais (acima do mínimo): 0,001 kg.
  const TIE_STEP_UNITS = 1000;

  function triangular(count) {
    return (count * (count + 1)) / 2;
  }

  function hasAtMostSixDecimals(value) {
    return Math.abs(value * SCALE - Math.round(value * SCALE)) < 1e-6;
  }

  // Converte kg em texto com vírgula decimal, sem zeros à direita (a partir de unidades internas de 1e-6 kg).
  function formatKg(units) {
    return (units / SCALE).toFixed(6).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  }

  // Redistribuição padrão (sem bloco de carga-alvo): nenhuma carga se repete na saída, salvo empate no máximo preservado.
  // Regras (SPEC.md, "Cargas sem repetição na redistribuição padrão"):
  // - Pinados, com o valor de entrada: o furo de menor carga positiva (o de assinatura, se ele tiver essa carga; senão o
  //   primeiro), todos os furos de maior carga (empates incluídos) e os furos de fixedIndexes (furo de assinatura). Eles
  //   não recebem nem financiam ajuste.
  // - Furos zerados (não fixos) formam uma escada a partir de zeroChargeMinimum, em passo zeroChargeStepKg, na ordem do
  //   número. O primeiro vale exatamente zeroChargeMinimum. O passo é reduzido (com aviso) se a escada não couber
  //   abaixo da menor carga positiva.
  // - Os demais furos positivos absorvem a diferença do total em proporção ao quanto estão acima da menor carga.
  //   Cargas de origem iguais são separadas por 0,001 kg; se sobrar repetição, um desempate de 1e-6 kg.
  // - O total de saída é exatamente o de entrada, e nenhum furo livre fica abaixo da menor carga positiva nem acima da maior.
  // options: { enabled, zeroChargeMinimum, zeroChargeStepKg, fixedIndexes, notes }. `notes` (opcional) recebe avisos.
  function redistributeZeroCharges(values, options = {}) {
    const { enabled = false, zeroChargeMinimum, zeroChargeStepKg, fixedIndexes = [], notes } = options;
    if (!enabled) return values.slice();
    if (!Array.isArray(values)) throw new Error('A redistribuição de cargas recebe a lista de cargas dos furos.');
    if (!Number.isFinite(zeroChargeMinimum) || zeroChargeMinimum <= 0 || !hasAtMostSixDecimals(zeroChargeMinimum)) {
      throw new Error('A carga mínima dos furos zerados (zeroChargeMinimum em config.js) deve ser um número maior que zero, com até seis casas decimais.');
    }
    if (!Number.isFinite(zeroChargeStepKg) || zeroChargeStepKg <= 0 || !hasAtMostSixDecimals(zeroChargeStepKg)) {
      throw new Error('O passo entre os furos zerados (zeroChargeStepKg em config.js) deve ser um número maior que zero, com até seis casas decimais.');
    }
    if (fixedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= values.length)) {
      throw new Error('O furo de assinatura não existe na lista de cargas: a redistribuição não consegue preservá-lo.');
    }
    const fixed = new Set(fixedIndexes);
    const units = values.map((value, index) => {
      if (value === null) return null;
      if (!Number.isFinite(value) || value < 0 || !hasAtMostSixDecimals(value)) {
        throw new Error(`A carga realizada do furo ${index + 1} não é válida para a redistribuição (use um número não negativo com até seis casas decimais).`);
      }
      return Math.round(value * SCALE);
    });
    const valid = values.map((_, index) => index).filter(index => units[index] !== null);
    const positive = valid.filter(index => units[index] > 0);
    if (!positive.length) {
      if (valid.some(index => units[index] === 0 && !fixed.has(index))) {
        throw new Error('Não há cargas positivas para redistribuir a carga zerada preservando os extremos.');
      }
      return values.slice();
    }
    const minUnits = Math.min(...positive.map(index => units[index]));
    const maxUnits = Math.max(...positive.map(index => units[index]));
    // Menor carga pinada: o furo de assinatura, se ele tiver a menor carga (já é pinado com o valor de entrada); senão,
    // o primeiro furo de menor carga. Os demais furos com a mesma carga mínima ficam livres e sobem.
    const minIndex = positive.find(index => units[index] === minUnits && fixed.has(index))
      ?? positive.find(index => units[index] === minUnits);
    const maxIndexes = positive.filter(index => units[index] === maxUnits);
    const pinned = new Set([minIndex, ...maxIndexes, ...fixed]);
    const zeroIndexes = valid.filter(index => units[index] === 0 && !fixed.has(index));
    const freeIndexes = positive.filter(index => !pinned.has(index));
    const minimumUnits = Math.round(zeroChargeMinimum * SCALE);
    const requestedStepUnits = Math.round(zeroChargeStepKg * SCALE);
    if (zeroIndexes.length && minimumUnits >= minUnits) {
      throw new Error(`A carga mínima dos furos zerados (${formatKg(minimumUnits)} kg) deve ser menor que a menor carga positiva do plano (${formatKg(minUnits)} kg).`);
    }
    let stepUnits = requestedStepUnits;
    let stepReduced = false;
    if (zeroIndexes.length > 1) {
      // A última carga da escada fica pelo menos 1e-6 kg abaixo da menor carga positiva.
      stepUnits = Math.min(requestedStepUnits, Math.floor((minUnits - minimumUnits - 1) / (zeroIndexes.length - 1)));
      if (stepUnits < 1) {
        throw new Error(`Os ${zeroIndexes.length} furos zerados não cabem em escada entre ${formatKg(minimumUnits)} kg e a menor carga positiva (${formatKg(minUnits)} kg).`);
      }
      stepReduced = stepUnits < requestedStepUnits;
    }
    const zeroUnits = new Map(zeroIndexes.map((index, position) => [index, minimumUnits + stepUnits * position]));
    const stairTotal = [...zeroUnits.values()].reduce((sum, value) => sum + value, 0);
    const totalUnits = valid.reduce((sum, index) => sum + units[index], 0);
    const pinnedTotal = [...pinned].reduce((sum, index) => sum + (units[index] ?? 0), 0);
    const freeTarget = totalUnits - pinnedTotal - stairTotal;
    const freeFloor = freeIndexes.length * minUnits;
    if (!freeIndexes.length && stairTotal > 0) {
      throw new Error('Não há furos intermediários para receber a carga dos furos zerados.');
    }
    if (freeTarget < freeFloor) {
      throw new Error('Não há carga suficiente acima da menor carga positiva para receber a escada dos furos zerados.');
    }
    const valueCounts = new Map();
    positive.forEach(index => valueCounts.set(units[index], (valueCounts.get(units[index]) || 0) + 1));
    const tiedFreeCount = freeIndexes.filter(index => valueCounts.get(units[index]) > 1).length;

    // Furos livres: cargas de origem iguais viram escada de 0,001 kg (base estritamente crescente) e o excesso
    // sobre a menor carga é reduzido na mesma proporção até o total fechar. Depois, desempate de 1e-6 kg.
    const ordered = strictlyIncreasing(freeIndexes.map(index => ({ index, base: units[index] })));
    const excessSum = ordered.reduce((sum, item) => sum + (item.base - minUnits), 0);
    const extra = freeTarget - freeFloor;
    if (extra < 0 || extra > excessSum) throw new Error('Falha interna ao redistribuir as cargas zeradas.');
    const scaled = new Map();
    if (excessSum === 0) {
      ordered.forEach(item => scaled.set(item.index, minUnits));
    } else if (ordered.length) {
      const factor = extra / excessSum;
      const exact = ordered.map(item => (item.base - minUnits) * factor);
      const floors = exact.map(value => Math.floor(value));
      const leftover = extra - floors.reduce((sum, value) => sum + value, 0);
      if (leftover < 0 || leftover > ordered.length) throw new Error('Falha interna ao arredondar a redistribuição das cargas zeradas.');
      ordered.map((_, position) => position)
        .sort((left, right) => ((exact[right] - floors[right]) - (exact[left] - floors[left])) || (left - right))
        .slice(0, leftover)
        .forEach(position => { floors[position] += 1; });
      ordered.forEach((item, position) => scaled.set(item.index, minUnits + floors[position]));
    }
    const bounds = new Map(ordered.map(item => [item.index, { lo: minUnits, hi: maxUnits - 1 }]));
    const movable = new Map(ordered.map(item => [item.index, scaled.get(item.index)]));
    if ([...movable.values()].some(value => value < minUnits || value > maxUnits - 1)) {
      throw new Error('Não há como redistribuir a carga dos zerados mantendo todas as cargas entre a menor e a maior carga.');
    }
    const pinnedValues = new Set([minUnits, maxUnits, ...zeroUnits.values(),
      ...[...fixed].filter(index => units[index] !== null).map(index => units[index])]);
    if (!breakLoadTies(movable, bounds, [...pinnedValues])) {
      throw new Error('Não foi possível manter todas as cargas distintas na redistribuição padrão: faltam furos livres para separar as repetições sem alterar a menor ou a maior carga.');
    }

    const result = values.map((value, index) => {
      if (pinned.has(index)) return value;
      if (zeroUnits.has(index)) return zeroUnits.get(index) / SCALE;
      if (movable.has(index)) return movable.get(index) / SCALE;
      return value;
    });
    const outputUnits = result.map(value => (value === null ? null : Math.round(value * SCALE)));
    if (outputUnits.reduce((sum, unit) => sum + (unit ?? 0), 0) !== totalUnits) {
      throw new Error('A redistribuição não fechou exatamente no total de entrada.');
    }
    const outputCounts = new Map();
    outputUnits.forEach(unit => { if (unit !== null) outputCounts.set(unit, (outputCounts.get(unit) || 0) + 1); });
    if ([...outputCounts].some(([unit, count]) => count > 1 && unit !== maxUnits)) {
      throw new Error('Não foi possível manter todas as cargas distintas na redistribuição padrão: faltam furos livres para separar as repetições sem alterar a menor ou a maior carga.');
    }
    if (notes) {
      if (stepReduced) {
        notes.push(`Os ${zeroIndexes.length} furos zerados ficam abaixo da menor carga positiva do plano (${formatKg(minUnits)} kg); o passo entre eles foi reduzido de ${formatKg(requestedStepUnits)} kg para ${formatKg(stepUnits)} kg.`);
      }
      if (tiedFreeCount > 0) {
        notes.push(`${tiedFreeCount} furos com carga repetida na entrada foram separados (passo de ${formatKg(TIE_STEP_UNITS)} kg entre cargas iguais); o total continua igual.`);
      }
    }
    return result;
  }

  // Desempate: se duas cargas livres repetirem um valor (ou um valor fixo), uma delas anda 1e-6 kg para um lado e
  // outra anda para o lado oposto, mantendo o total e os limites. Retorna false se não houver ajuste possível.
  function breakLoadTies(unitsByIndex, bounds, pinnedUnits) {
    for (let attempt = 0; attempt < 10 * unitsByIndex.size + 100; attempt += 1) {
      const holders = new Map();
      const addHolder = (units, owner) => holders.set(units, [...(holders.get(units) || []), owner]);
      unitsByIndex.forEach((units, index) => addHolder(units, index));
      pinnedUnits.forEach(units => addHolder(units, -1));
      const repeated = [...holders.entries()].find(([, owners]) => owners.length > 1);
      if (!repeated) return true;
      const [units, owners] = repeated;
      const mover = owners.filter(owner => owner >= 0).pop();
      if (mover === undefined) return false;
      const others = [...unitsByIndex.keys()].filter(index => index !== mover);
      if (units + 1 <= bounds.get(mover).hi && !holders.has(units + 1)) {
        const donor = others.find(index => unitsByIndex.get(index) - 1 >= bounds.get(index).lo
          && !holders.has(unitsByIndex.get(index) - 1));
        if (donor !== undefined) {
          unitsByIndex.set(mover, units + 1);
          unitsByIndex.set(donor, unitsByIndex.get(donor) - 1);
          continue;
        }
      }
      if (units - 1 >= bounds.get(mover).lo && !holders.has(units - 1)) {
        const donor = others.find(index => unitsByIndex.get(index) + 1 <= bounds.get(index).hi
          && !holders.has(unitsByIndex.get(index) + 1));
        if (donor !== undefined) {
          unitsByIndex.set(mover, units - 1);
          unitsByIndex.set(donor, unitsByIndex.get(donor) + 1);
          continue;
        }
      }
      return false;
    }
    return false;
  }

  // Distribui `totalUnits` entre `entries` (ordenados pela carga, já com valores de base estritamente crescentes).
  // Cada furo fica entre um piso (lo) e um teto (hi) escalonados, distintos entre si e dentro de (mínimo, máximo).
  // A escala do excesso acima do mínimo é ajustada até o total fechar. Retorna null se não houver solução distinta.
  function scaleGroup(entries, minimumUnits, maximumUnits, totalUnits) {
    const count = entries.length;
    if (!count) return { units: [], lo: [], hi: [] };
    const topGap = Math.min(TOP_GAP_UNITS, Math.floor((count * maximumUnits - totalUnits) / triangular(count)));
    if (topGap < 1) return null;
    const lo = entries.map((_, position) => minimumUnits + (position + 1));
    const hi = entries.map((_, position) => maximumUnits - topGap * (count - position));
    if (lo.some((value, position) => value >= hi[position])) return null;
    const excess = entries.map(entry => entry.base - minimumUnits);
    const valuesAt = scale => entries.map((_, position) => Math.min(hi[position], Math.max(lo[position], minimumUnits + scale * excess[position])));
    const sumAt = scale => valuesAt(scale).reduce((sum, value) => sum + value, 0);
    if (sumAt(0) > totalUnits) return null;
    let scaleLow = 0;
    let scaleHigh = Math.max(...excess.map((value, position) => (hi[position] - minimumUnits) / value));
    if (sumAt(scaleHigh) < totalUnits) return null;
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const middle = (scaleLow + scaleHigh) / 2;
      if (sumAt(middle) < totalUnits) scaleLow = middle; else scaleHigh = middle;
    }
    const real = valuesAt(scaleHigh);
    const units = real.map(value => Math.floor(value));
    const leftover = totalUnits - units.reduce((sum, value) => sum + value, 0);
    const candidates = real
      .map((value, position) => ({ position, fraction: value - units[position] }))
      .filter(item => units[item.position] < hi[item.position])
      .sort((left, right) => (right.fraction - left.fraction) || (left.position - right.position));
    if (leftover < 0 || leftover > candidates.length) throw new Error('Falha interna ao arredondar a distribuição de cargas.');
    for (let step = 0; step < leftover; step += 1) units[candidates[step].position] += 1;
    return { units, lo, hi };
  }

  // Ordena os furos pela carga de base e torna as bases estritamente crescentes. Cargas iguais de origem são
  // separadas por 0,001 kg (TIE_STEP_UNITS), para que a escala e o arredondamento não as façam voltar a repetir.
  function strictlyIncreasing(items) {
    const sorted = items.slice().sort((left, right) => (left.base - right.base) || (left.index - right.index));
    sorted.forEach((item, position) => {
      if (position > 0 && item.base <= sorted[position - 1].base) item.base = sorted[position - 1].base + TIE_STEP_UNITS;
    });
    return sorted;
  }

  // Fecha o total em `target` mantendo a carga mínima no furo escolhido e a(s) maior(es) carga(s) preservadas.
  // Nenhum furo livre repete a carga de outro, nem a carga mínima, nem a maior carga preservada.
  // options.minimumIndex / minimumValue: furo de menor carga e o mínimo informado (recebe exatamente esse valor).
  // options.stepKg (obrigatório, > 0): passo entre as cargas dos furos de carga baixa (padrão do site: 0,6 kg).
  // options.fixedIndexes (furo de assinatura): mantêm o valor de entrada exato; o total-alvo inclui a carga fixa.
  // options.notes (opcional): lista onde são registrados avisos da distribuição (ex.: passo reduzido).
  //
  // Regra:
  // - Furos de carga baixa (igual ou abaixo do mínimo, inclusive zerados) ficam em escada: mínimo + passo, + 2 passos…
  //   na ordem da carga original. Se o total não couber na escada, todos os furos livres são reescalados.
  // - Os demais furos livres dividem o restante proporcionalmente ao quanto estão acima do mínimo, com valores
  //   distintos entre um piso e um teto escalonados (logo abaixo do máximo preservado).
  // - Só é recusado o alvo que não permite cargas distintas (muito perto do mínimo ou do máximo possível).
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
    const stepKg = options.stepKg;
    if (!Number.isFinite(stepKg) || stepKg <= 0) {
      throw new Error('O passo de carga entre furos (chargeMinimumStepKg em config.js) deve ser um número maior que zero.');
    }

    const adjustable = charges.map((_, index) => index).filter(index => index !== minimumIndex && !maximumIndexes.includes(index) && !fixed.has(index));
    if (!adjustable.length) {
      throw new Error('Não há furos intermediários disponíveis para distribuir a carga-alvo.');
    }
    [minimum, maximum, ...fixedIndexes.map(index => charges[index])].forEach(value => {
      if (!hasAtMostSixDecimals(value)) {
        throw new Error('A carga mínima, a maior carga preservada e as cargas fixas devem ter no máximo seis casas decimais.');
      }
    });

    const scale = SCALE;
    const minimumUnits = Math.round(minimum * scale);
    const maximumUnits = Math.round(maximum * scale);
    const targetUnits = Math.round(target * scale);
    const fixedUnits = fixedIndexes.map(index => Math.round(charges[index] * scale));
    const preservedMaximumCount = maximumIndexes.filter(index => !fixed.has(index)).length;
    const freeCount = adjustable.length;
    const freeTargetUnits = targetUnits - minimumUnits - preservedMaximumCount * maximumUnits - fixedUnits.reduce((sum, value) => sum + value, 0);
    const plainLower = freeCount * minimumUnits;
    const plainUpper = freeCount * maximumUnits;
    if (freeTargetUnits < plainLower || freeTargetUnits > plainUpper) {
      const lower = (minimumUnits + preservedMaximumCount * maximumUnits + fixedUnits.reduce((sum, value) => sum + value, 0) + plainLower) / scale;
      const upper = (minimumUnits + preservedMaximumCount * maximumUnits + fixedUnits.reduce((sum, value) => sum + value, 0) + plainUpper) / scale;
      throw new Error(`O alvo é impossível mantendo a menor e a maior carga. Para estes furos, use um total entre ${lower.toFixed(2)} kg e ${upper.toFixed(2)} kg.`);
    }
    if (maximumUnits === minimumUnits) {
      throw new Error('A carga mínima não pode ser igual à maior carga preservada: os demais furos teriam que repetir esse valor.');
    }
    if (freeTargetUnits < plainLower + triangular(freeCount) || freeTargetUnits > plainUpper - triangular(freeCount)) {
      throw new Error('O alvo está tão perto do menor ou do maior valor possível que não há como manter todas as cargas distintas. Ajuste o total.');
    }

    // Furos de carga baixa: escada de passo `stepKg` acima do mínimo, na ordem da carga original (depois do número).
    const lowIndexes = adjustable
      .filter(index => charges[index] <= minimum)
      .sort((left, right) => (charges[left] - charges[right]) || (left - right));
    const aboveIndexes = adjustable.filter(index => charges[index] > minimum);
    // Passo automático: os furos de carga baixa ficam entre o mínimo e a próxima carga real do plano (a menor carga
    // original acima do mínimo, sem contar o máximo preservado). Assim continuam abaixo dos demais furos. O passo é o
    // maior que cabe nesse espaço, limitado pelo teto `stepKg`.
    const nextRealUnits = Math.min(maximumUnits, ...adjustable
      .concat(fixedIndexes)
      .filter(index => index !== minimumIndex && !maximumIndexes.includes(index) && charges[index] > minimum)
      .map(index => Math.round(charges[index] * scale)));
    const roomUnits = nextRealUnits - minimumUnits;
    const requestedStepUnits = Math.round(stepKg * scale);
    const fitStepUnits = Math.floor(roomUnits / (lowIndexes.length + 1));
    const boundStepUnits = Math.floor((maximumUnits - minimumUnits - 1) / (lowIndexes.length + 1));
    const stepUnits = Math.max(1, Math.min(requestedStepUnits, fitStepUnits, boundStepUnits));
    if (lowIndexes.length && stepUnits < requestedStepUnits && options.notes) {
      options.notes.push(`Os ${lowIndexes.length} furos de carga baixa ficam abaixo da próxima carga real do plano (${formatStep(nextRealUnits)} kg); o passo entre eles foi ajustado para ${formatStep(stepUnits)} kg (teto de ${formatStep(requestedStepUnits)} kg).`);
    }
    if (stepUnits * (lowIndexes.length + 1) >= maximumUnits - minimumUnits) {
      throw new Error('A faixa entre a carga mínima e a maior carga preservada é pequena demais para os furos de carga baixa.');
    }
    const staircaseUnitsByIndex = new Map(lowIndexes.map((index, position) => [index, minimumUnits + stepUnits * (position + 1)]));
    const staircaseTotal = [...staircaseUnitsByIndex.values()].reduce((sum, value) => sum + value, 0);
    // Carga de base de cada furo livre: escada (furo de carga baixa) ou a própria carga (acima do mínimo).
    const baseUnits = index => (staircaseUnitsByIndex.has(index)
      ? staircaseUnitsByIndex.get(index)
      : Math.max(minimumUnits + 1, Math.round(charges[index] * scale)));

    // Modo 1: escada fixa (passo exato); os demais furos livres dividem o restante do total.
    // Modo 2 (só se o modo 1 não couber): todos os furos livres entram na escala, e a escada também é reescalada.
    let plan = null;
    if (aboveIndexes.length) {
      const ordered = strictlyIncreasing(aboveIndexes.map(index => ({ index, base: baseUnits(index) })));
      const solved = scaleGroup(ordered, minimumUnits, maximumUnits, freeTargetUnits - staircaseTotal);
      if (solved) plan = { ordered, solved, staircaseKept: true };
    } else if (freeTargetUnits === staircaseTotal) {
      plan = { ordered: [], solved: { units: [], lo: [], hi: [] }, staircaseKept: true };
    }
    if (!plan) {
      if (lowIndexes.length && options.notes) {
        options.notes.push('O total não coube só com os demais furos: os furos de carga baixa também subiram na mesma proporção.');
      }
      const ordered = strictlyIncreasing(adjustable.map(index => ({ index, base: baseUnits(index) })));
      const solved = scaleGroup(ordered, minimumUnits, maximumUnits, freeTargetUnits);
      if (!solved) {
        throw new Error('Não há como distribuir o total com cargas distintas entre os furos. Ajuste o total.');
      }
      plan = { ordered, solved, staircaseKept: false };
    }

    const finalUnits = new Map();
    const bounds = new Map();
    plan.ordered.forEach((item, position) => {
      finalUnits.set(item.index, plan.solved.units[position]);
      bounds.set(item.index, { lo: plan.solved.lo[position], hi: plan.solved.hi[position] });
    });
    const isFixedStep = index => plan.staircaseKept && staircaseUnitsByIndex.has(index);
    if (plan.staircaseKept) {
      staircaseUnitsByIndex.forEach((units, index) => finalUnits.set(index, units));
    }

    // Desempate entre os furos que podem se mover. Escada fixa e furo de assinatura são valores pinados.
    const pinnedUnits = [...fixedUnits];
    if (plan.staircaseKept) pinnedUnits.push(...staircaseUnitsByIndex.values());
    const movable = new Map([...finalUnits].filter(([index]) => !isFixedStep(index)));
    const movableBounds = new Map([...bounds].filter(([index]) => movable.has(index)));
    if (!breakLoadTies(movable, movableBounds, pinnedUnits)) {
      throw new Error('Não foi possível manter todas as cargas distintas com este total. Ajuste o total.');
    }
    movable.forEach((units, index) => finalUnits.set(index, units));

    const result = charges.map((value, index) => {
      if (index === minimumIndex) return minimum;
      if (fixed.has(index)) return charges[index];
      if (maximumIndexes.includes(index)) return maximum;
      return finalUnits.get(index) / scale;
    });
    const resultUnits = result.reduce((sum, value) => sum + Math.round(value * scale), 0);
    if (resultUnits !== targetUnits) {
      throw new Error('A distribuição não fechou exatamente no total informado. Tente um alvo com até seis casas decimais.');
    }
    const freeValues = adjustable.map(index => Math.round(result[index] * scale));
    if (new Set(freeValues).size !== freeValues.length) {
      throw new Error('Não foi possível manter todas as cargas distintas com este total. Ajuste o total.');
    }
    return result;
  }

  function formatStep(units) {
    return formatKg(units);
  }

  root.OpenBlastCharge = { distributeCharges, redistributeZeroCharges };
})(typeof window !== 'undefined' ? window : globalThis);
