(function attachChargeModule(root) {
  'use strict';

  // Resolução interna de 1e-6 kg: as cargas saem com até seis casas decimais, como o alvo.
  const SCALE = 10 ** 6;
  // Passo da redução automática da diferença mínima (0,01 kg), usado só se o teto não couber.
  const CENT_UNITS = 10000;
  // Iterações da bisseção que acerta a escala do excesso acima do mínimo.
  const BISECTION_STEPS = 200;

  function hasAtMostSixDecimals(value) {
    return Math.abs(value * SCALE - Math.round(value * SCALE)) < 1e-6;
  }

  // Converte unidades internas (1e-6 kg) em texto com vírgula decimal, sem zeros à direita.
  function formatKg(units) {
    return (units / SCALE).toFixed(6).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  }

  function validateWindow(windowSize, windowMinGapKg) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new Error('A janela de furos vizinhos (chargeWindowSize em config.js) deve ser um número inteiro maior que zero.');
    }
    if (!Number.isFinite(windowMinGapKg) || windowMinGapKg <= 0 || !hasAtMostSixDecimals(windowMinGapKg)) {
      throw new Error('A diferença mínima entre furos vizinhos (chargeWindowMinGapKg em config.js) deve ser um número maior que zero, com até seis casas decimais.');
    }
  }

  // Regra da janela (SPEC.md, "Janela de furos vizinhos"): dois furos a até `windowSize` posições um do outro, na ordem do
  // número, não podem ficar com cargas a menos de `gapOf(i, j)` uma da outra. Fora da janela, cargas iguais são permitidas.
  // Pares de dois furos fixos (menor carga, maior carga preservada ou assinatura) não entram: eles mantêm a carga da
  // entrada e a conta é avisada em `notes` (countPinnedConflicts).
  function findWindowViolation(units, windowSize, gapOf, pinned) {
    const count = units.length;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j <= Math.min(count - 1, i + windowSize); j += 1) {
        if (pinned[i] && pinned[j]) continue;
        if (Math.abs(units[i] - units[j]) < gapOf(i, j)) return [i, j];
      }
    }
    return null;
  }

  // Quantos pares de furos fixos (ambos pinados) a até windowSize posições estão a menos de `gap` um do outro.
  function countPinnedConflicts(units, pinned, windowSize, gap) {
    const count = units.length;
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j <= Math.min(count - 1, i + windowSize); j += 1) {
        if (pinned[i] && pinned[j] && Math.abs(units[i] - units[j]) < gap) total += 1;
      }
    }
    return total;
  }

  function pinnedConflictNote(total, windowSize, gapUnitsMax) {
    const pairs = total === 1 ? '1 par de furos fixos' : `${total} pares de furos fixos`;
    return `${pairs} (menor carga, maior carga preservada ou assinatura) ficam a até ${windowSize} posições com diferença menor que ${formatKg(gapUnitsMax)} kg; eles não podem ser ajustados e foram mantidos como vieram da entrada.`;
  }

  // Escala o excesso de cada valor acima de minUnits até somar totalUnits, com cada valor entre minUnits e maxUnits − 1.
  // Retorna as cargas em unidades inteiras, ou null se o total não cabe nesses limites.
  function scaleToTotal(baseUnits, minUnits, maxUnits, totalUnits) {
    const count = baseUnits.length;
    const upper = maxUnits - 1;
    if (!count) return totalUnits === 0 ? [] : null;
    if (count * minUnits > totalUnits || count * upper < totalUnits) return null;
    const excess = baseUnits.map(value => Math.max(0, value - minUnits));
    const positive = excess.filter(value => value > 0);
    if (!positive.length) return count * minUnits === totalUnits ? excess.map(() => minUnits) : null;
    const valuesAt = scale => excess.map(value => Math.min(upper, Math.max(minUnits, minUnits + scale * value)));
    const sumAt = scale => valuesAt(scale).reduce((sum, value) => sum + value, 0);
    let scaleLow = 0;
    let scaleHigh = (upper - minUnits) / Math.min(...positive);
    if (sumAt(scaleHigh) < totalUnits) return null;
    for (let iteration = 0; iteration < BISECTION_STEPS; iteration += 1) {
      const middle = (scaleLow + scaleHigh) / 2;
      if (sumAt(middle) < totalUnits) scaleLow = middle; else scaleHigh = middle;
    }
    const real = valuesAt(scaleHigh);
    const units = real.map(value => Math.floor(value));
    const leftover = totalUnits - units.reduce((sum, value) => sum + value, 0);
    const candidates = real
      .map((value, position) => ({ position, fraction: value - units[position] }))
      .filter(item => units[item.position] < upper)
      .sort((left, right) => (right.fraction - left.fraction) || (left.position - right.position));
    if (leftover < 0 || leftover > candidates.length) throw new Error('Falha interna ao arredondar a distribuição de cargas.');
    for (let step = 0; step < leftover; step += 1) units[candidates[step].position] += 1;
    return units;
  }

  // Ajusta `units` (in place) até não haver violação: cada furo livre se move o mínimo necessário e a variação
  // é compensada por outro furo livre (mesmo valor, sinal oposto). Cada ajuste deixa os dois furos sem violação, então o
  // número de violações cai a cada passo. Retorna false se não houver ajuste possível.
  function repairWindow(units, lo, hi, pinned, windowSize, gapOf) {
    const count = units.length;
    const neighborsOf = index => {
      const list = [];
      for (let p = Math.max(0, index - windowSize); p <= Math.min(count - 1, index + windowSize); p += 1) {
        if (p !== index) list.push(p);
      }
      return list;
    };
    const isClear = index => neighborsOf(index).every(p => Math.abs(units[index] - units[p]) >= gapOf(index, p));
    const moveOff = mover => {
      const current = units[mover];
      const neighbors = neighborsOf(mover);
      const points = new Set([lo[mover], hi[mover]]);
      neighbors.forEach(p => {
        points.add(units[p] + gapOf(mover, p));
        points.add(units[p] - gapOf(mover, p));
      });
      const candidates = [...points]
        .filter(x => x >= lo[mover] && x <= hi[mover] && x !== current)
        .filter(x => neighbors.every(p => Math.abs(x - units[p]) >= gapOf(mover, p)))
        .sort((a, b) => (Math.abs(a - current) - Math.abs(b - current)) || (a - b));
      for (const x of candidates) {
        const delta = x - current;
        for (let k = 1; k < count; k += 1) {
          for (const donor of [mover - k, mover + k]) {
            if (donor < 0 || donor >= count || pinned[donor]) continue;
            const before = units[donor];
            const target = before - delta;
            if (target < lo[donor] || target > hi[donor]) continue;
            units[mover] = x;
            units[donor] = target;
            if (isClear(mover) && isClear(donor)) return true;
            units[mover] = current;
            units[donor] = before;
          }
        }
      }
      return false;
    };
    const guardLimit = count * windowSize * 4 + 100;
    for (let guard = 0; guard < guardLimit; guard += 1) {
      const pair = findWindowViolation(units, windowSize, gapOf, pinned);
      if (!pair) return true;
      const movers = [pair[1], pair[0]].filter(index => !pinned[index]);
      if (!movers.some(mover => moveOff(mover))) return false;
    }
    return false;
  }

  // Busca a maior diferença mínima entre o teto (gapUnitsMax) e 0,01 kg para a qual a janela tem solução. `attempt(gap)`
  // devolve o resultado ou null. Retorna { result, gapUnits } ou null se nem 0,01 kg couber.
  function largestFeasibleGap(gapUnitsMax, attempt) {
    const first = attempt(gapUnitsMax);
    if (first) return { result: first, gapUnits: gapUnitsMax };
    const maxSteps = Math.floor((gapUnitsMax - 1) / CENT_UNITS);
    let chosen = maxSteps >= 1 ? attempt(CENT_UNITS) : null;
    if (!chosen) return null;
    let low = 1;
    let high = maxSteps + 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      const next = attempt(middle * CENT_UNITS);
      if (next) { low = middle; chosen = next; } else { high = middle; }
    }
    return { result: chosen, gapUnits: low * CENT_UNITS };
  }

  // Redistribuição padrão (sem bloco de carga-alvo), SPEC.md, "Janela de furos vizinhos":
  // - Pinados, com o valor de entrada: o furo de menor carga positiva (o de assinatura, se ele tiver essa carga; senão o
  //   primeiro), todos os furos de maior carga e os furos de fixedIndexes (furo de assinatura).
  // - Furos zerados (não fixos) começam em uma escada cíclica: zeroChargeMinimum, +g, +2g… (g = diferença mínima entre
  //   zerados), com W+1 níveis que se repetem. Assim dois zerados a até W posições nunca ficam com a mesma carga.
  // - Os demais furos positivos absorvem a diferença do total em proporção ao quanto estão acima da menor carga.
  // - Depois, nenhum furo fica a menos de windowMinGapKg de um vizinho a até windowSize posições; se isso não couber, a
  //   diferença desce em passos de 0,01 kg até caber (com aviso). O total é exato.
  // options: { enabled, zeroChargeMinimum, fixedIndexes, windowSize, windowMinGapKg, notes }. `notes` (opcional) recebe avisos.
  function redistributeZeroCharges(values, options = {}) {
    const { enabled = false, zeroChargeMinimum, fixedIndexes = [], windowSize, windowMinGapKg, notes } = options;
    if (!enabled) return values.slice();
    if (!Array.isArray(values)) throw new Error('A redistribuição de cargas recebe a lista de cargas dos furos.');
    if (!Number.isFinite(zeroChargeMinimum) || zeroChargeMinimum <= 0 || !hasAtMostSixDecimals(zeroChargeMinimum)) {
      throw new Error('A carga mínima dos furos zerados (zeroChargeMinimum em config.js) deve ser um número maior que zero, com até seis casas decimais.');
    }
    validateWindow(windowSize, windowMinGapKg);
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
    // Menor carga pinada: o furo de assinatura, se ele tiver a menor carga; senão, o primeiro furo de menor carga.
    const minIndex = positive.find(index => units[index] === minUnits && fixed.has(index))
      ?? positive.find(index => units[index] === minUnits);
    const maxIndexes = positive.filter(index => units[index] === maxUnits);
    const pinned = new Set([minIndex, ...maxIndexes, ...fixed]);
    const zeroIndexes = valid.filter(index => units[index] === 0 && !fixed.has(index));
    const freeIndexes = positive.filter(index => !pinned.has(index));
    const minimumUnits = Math.round(zeroChargeMinimum * SCALE);
    const gapUnitsMax = Math.round(windowMinGapKg * SCALE);
    if (zeroIndexes.length && minimumUnits >= minUnits) {
      throw new Error(`A carga mínima dos furos zerados (${formatKg(minimumUnits)} kg) deve ser menor que a menor carga positiva do plano (${formatKg(minUnits)} kg).`);
    }
    if (zeroIndexes.length && !freeIndexes.length) {
      throw new Error('Não há furos intermediários para receber a carga dos furos zerados.');
    }
    // Entre dois zerados, a escada cíclica usa W+1 níveis abaixo da menor carga positiva (zero, +g, … +W·g).
    const zeroRoomUnits = zeroIndexes.length > 1 ? Math.floor((minUnits - 1 - minimumUnits) / windowSize) : Infinity;
    if (zeroIndexes.length > 1 && zeroRoomUnits < 1) {
      throw new Error(`Os ${zeroIndexes.length} furos zerados não cabem com ${windowSize} furos vizinhos distintos entre ${formatKg(minimumUnits)} kg e a menor carga positiva (${formatKg(minUnits)} kg).`);
    }
    const totalUnits = valid.reduce((sum, index) => sum + units[index], 0);
    const pinnedTotal = [...pinned].reduce((sum, index) => sum + (units[index] ?? 0), 0);

    // Base de cada furo para uma diferença mínima `gap` (a escada dos zerados depende dela).
    const buildBase = gap => {
      const zeroGap = Math.min(gap, zeroRoomUnits);
      const zeroLevels = zeroIndexes.map((_, position) => minimumUnits + (position % (windowSize + 1)) * zeroGap);
      const zeroTotal = zeroLevels.reduce((sum, value) => sum + value, 0);
      const scaledFree = scaleToTotal(freeIndexes.map(index => units[index]), minUnits, maxUnits, totalUnits - pinnedTotal - zeroTotal);
      if (!scaledFree) return null;
      const baseUnits = new Map();
      valid.forEach(index => { if (pinned.has(index)) baseUnits.set(index, units[index]); });
      zeroIndexes.forEach((index, position) => baseUnits.set(index, zeroLevels[position]));
      freeIndexes.forEach((index, position) => baseUnits.set(index, scaledFree[position]));
      return { zeroGap, baseUnits };
    };
    const runWindow = gap => {
      const built = buildBase(gap);
      if (!built) return null;
      const seqBase = valid.map(index => built.baseUnits.get(index));
      const pinnedFlags = valid.map(index => pinned.has(index));
      const zeroLike = seqBase.map(value => value < minUnits);
      const lo = seqBase.map((value, position) => (pinnedFlags[position] ? value : (zeroLike[position] ? minimumUnits : minUnits)));
      const hi = seqBase.map((value, position) => (pinnedFlags[position] ? value : (zeroLike[position] ? minUnits - 1 : maxUnits - 1)));
      const gapOf = (a, b) => (zeroLike[a] && zeroLike[b] ? built.zeroGap : gap);
      const seq = seqBase.slice();
      if (!repairWindow(seq, lo, hi, pinnedFlags, windowSize, gapOf)) return null;
      if (findWindowViolation(seq, windowSize, gapOf, pinnedFlags)) throw new Error('Falha interna: a janela de furos vizinhos ficou violada após a redistribuição.');
      return { seq, seqBase, pinnedFlags, zeroGapUnits: built.zeroGap };
    };
    const found = largestFeasibleGap(gapUnitsMax, runWindow);
    if (!found) {
      const probe = buildBase(CENT_UNITS);
      if (!probe) {
        const zeroTotal = zeroIndexes.reduce((sum, _, position) => sum + minimumUnits + (position % (windowSize + 1)) * Math.min(CENT_UNITS, zeroRoomUnits), 0);
        if (totalUnits - pinnedTotal - zeroTotal < freeIndexes.length * minUnits) {
          throw new Error('Não há carga suficiente acima da menor carga positiva para receber a escada dos furos zerados.');
        }
        throw new Error('Não há espaço abaixo da maior carga para receber a carga dos furos zerados sem repetir a maior carga.');
      }
      throw new Error(`Não há como manter cargas distintas entre furos vizinhos (até ${windowSize} posições) com estes furos e este total, sem alterar a menor ou a maior carga.`);
    }
    const { result: { seq, seqBase, pinnedFlags, zeroGapUnits }, gapUnits } = found;
    const changed = seq.filter((value, position) => value !== seqBase[position]).length;
    const pinnedConflicts = countPinnedConflicts(seqBase, pinnedFlags, windowSize, gapUnitsMax);

    const outputByIndex = new Map(valid.map((index, position) => [index, seq[position]]));
    const result = values.map((value, index) => {
      if (!outputByIndex.has(index) || pinned.has(index)) return value;
      return outputByIndex.get(index) / SCALE;
    });
    const outputUnits = result.map(value => (value === null ? null : Math.round(value * SCALE)));
    if (outputUnits.reduce((sum, unit) => sum + (unit ?? 0), 0) !== totalUnits) {
      throw new Error('A redistribuição não fechou exatamente no total de entrada.');
    }
    if (notes) {
      if (zeroGapUnits < gapUnits) {
        notes.push(`Os ${zeroIndexes.length} furos zerados ficam em uma faixa curta (abaixo de ${formatKg(minUnits)} kg): a diferença mínima entre eles foi reduzida para ${formatKg(zeroGapUnits)} kg.`);
      }
      if (gapUnits < gapUnitsMax) {
        notes.push(`A diferença mínima entre furos vizinhos ficou em ${formatKg(gapUnits)} kg (e não ${formatKg(gapUnitsMax)} kg): com uma diferença maior, estes furos fixos e zerados não cabem na janela de ${windowSize} posições.`);
      }
      if (pinnedConflicts > 0) {
        notes.push(pinnedConflictNote(pinnedConflicts, windowSize, gapUnitsMax));
      }
      if (changed > 0) {
        notes.push(`${changed === 1 ? '1 furo teve' : `${changed} furos tiveram`} a carga ajustada para manter ${formatKg(gapUnits)} kg de diferença entre furos vizinhos (até ${windowSize} posições antes ou depois); o total continua igual.`);
      }
    }
    return result;
  }

  // Carga-alvo (com bloco ativo). Os furos de carga baixa (igual ou abaixo do mínimo) ficam em escada de passo automático
  // acima do mínimo; os demais furos livres dividem o restante proporcionalmente ao quanto estão acima do mínimo. Depois,
  // a regra da janela (windowSize, windowMinGapKg) é aplicada, com o mesmo recuo de 0,01 kg se o teto não couber, e o total
  // fecha exatamente em `target`.
  // options.minimumIndex / minimumValue: furo de menor carga e o mínimo informado (recebe exatamente esse valor).
  // options.maximumIndex / maximumIndexes / maximumValue: furo(s) de maior carga, preservados.
  // options.fixedIndexes (furo de assinatura): mantêm o valor de entrada exato; o total-alvo inclui a carga fixa.
  // options.stepKg (obrigatório, > 0): teto do passo entre as cargas de carga baixa (chargeMinimumStepKg em config.js).
  // options.notes (opcional): lista onde são registrados avisos da distribuição.
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
    validateWindow(options.windowSize, options.windowMinGapKg);

    const adjustable = charges.map((_, index) => index).filter(index => index !== minimumIndex && !maximumIndexes.includes(index) && !fixed.has(index));
    if (!adjustable.length) {
      throw new Error('Não há furos intermediários disponíveis para distribuir a carga-alvo.');
    }
    [minimum, maximum, ...fixedIndexes.map(index => charges[index])].forEach(value => {
      if (!hasAtMostSixDecimals(value)) {
        throw new Error('A carga mínima, a maior carga preservada e as cargas fixas devem ter no máximo seis casas decimais.');
      }
    });

    const minimumUnits = Math.round(minimum * SCALE);
    const maximumUnits = Math.round(maximum * SCALE);
    const targetUnits = Math.round(target * SCALE);
    const fixedUnits = fixedIndexes.map(index => Math.round(charges[index] * SCALE));
    const fixedSum = fixedUnits.reduce((sum, value) => sum + value, 0);
    const preservedMaximumCount = maximumIndexes.filter(index => !fixed.has(index)).length;
    const freeCount = adjustable.length;
    const freeTargetUnits = targetUnits - minimumUnits - preservedMaximumCount * maximumUnits - fixedSum;
    const plainLower = freeCount * minimumUnits;
    const plainUpper = freeCount * (maximumUnits - 1);
    if (freeTargetUnits < plainLower || freeTargetUnits > plainUpper) {
      const lower = (minimumUnits + preservedMaximumCount * maximumUnits + fixedSum + plainLower) / SCALE;
      const upper = (minimumUnits + preservedMaximumCount * maximumUnits + fixedSum + plainUpper) / SCALE;
      throw new Error(`O alvo é impossível mantendo a menor e a maior carga. Para estes furos, use um total entre ${lower.toFixed(2)} kg e ${upper.toFixed(2)} kg.`);
    }
    if (maximumUnits === minimumUnits) {
      throw new Error('A carga mínima não pode ser igual à maior carga preservada: os demais furos teriam que repetir esse valor.');
    }

    // Furos de carga baixa: escada de passo automático acima do mínimo, na ordem da carga original (depois do número).
    const lowIndexes = adjustable
      .filter(index => charges[index] <= minimum)
      .sort((left, right) => (charges[left] - charges[right]) || (left - right));
    const aboveIndexes = adjustable.filter(index => charges[index] > minimum);
    // Passo automático: os furos de carga baixa ficam entre o mínimo e a próxima carga real do plano (a menor carga
    // original acima do mínimo, sem contar o máximo preservado). O passo é o maior que cabe nesse espaço, até o teto.
    const nextRealUnits = Math.min(maximumUnits, ...adjustable
      .concat(fixedIndexes)
      .filter(index => index !== minimumIndex && !maximumIndexes.includes(index) && charges[index] > minimum)
      .map(index => Math.round(charges[index] * SCALE)));
    const roomUnits = nextRealUnits - minimumUnits;
    const requestedStepUnits = Math.round(stepKg * SCALE);
    const fitStepUnits = Math.floor(roomUnits / (lowIndexes.length + 1));
    const boundStepUnits = Math.floor((maximumUnits - minimumUnits - 1) / (lowIndexes.length + 1));
    const stepUnits = Math.max(1, Math.min(requestedStepUnits, fitStepUnits, boundStepUnits));
    if (lowIndexes.length && stepUnits < requestedStepUnits && options.notes) {
      options.notes.push(`Os ${lowIndexes.length} furos de carga baixa ficam abaixo da próxima carga real do plano (${formatKg(nextRealUnits)} kg); o passo entre eles foi ajustado para ${formatKg(stepUnits)} kg (teto de ${formatKg(requestedStepUnits)} kg).`);
    }
    if (stepUnits * (lowIndexes.length + 1) >= maximumUnits - minimumUnits) {
      throw new Error('A faixa entre a carga mínima e a maior carga preservada é pequena demais para os furos de carga baixa.');
    }
    const staircaseUnitsByIndex = new Map(lowIndexes.map((index, position) => [index, minimumUnits + stepUnits * (position + 1)]));
    const staircaseTotal = [...staircaseUnitsByIndex.values()].reduce((sum, value) => sum + value, 0);
    const baseUnits = index => (staircaseUnitsByIndex.has(index)
      ? staircaseUnitsByIndex.get(index)
      : Math.max(minimumUnits + 1, Math.round(charges[index] * SCALE)));

    // Modo 1: escada fixa como base; os demais furos livres absorvem o restante do total.
    // Modo 2 (só se o modo 1 não couber): todos os furos livres entram na escala, inclusive a escada.
    const finalUnits = new Map();
    let staircaseKept = false;
    if (aboveIndexes.length) {
      const solved = scaleToTotal(aboveIndexes.map(index => baseUnits(index)), minimumUnits, maximumUnits, freeTargetUnits - staircaseTotal);
      if (solved) {
        aboveIndexes.forEach((index, position) => finalUnits.set(index, solved[position]));
        staircaseKept = true;
      }
    } else if (freeTargetUnits === staircaseTotal) {
      staircaseKept = true;
    }
    if (staircaseKept) {
      staircaseUnitsByIndex.forEach((units, index) => finalUnits.set(index, units));
    } else {
      if (lowIndexes.length && options.notes) {
        options.notes.push('O total não coube só com os demais furos: os furos de carga baixa também subiram na mesma proporção.');
      }
      const solved = scaleToTotal(adjustable.map(index => baseUnits(index)), minimumUnits, maximumUnits, freeTargetUnits);
      if (!solved) {
        throw new Error('Não há como distribuir o total entre os furos mantendo a menor e a maior carga. Ajuste o total.');
      }
      adjustable.forEach((index, position) => finalUnits.set(index, solved[position]));
    }

    // Sequência completa (todos os furos, na ordem do número): fixos e extremos pinados; os demais são livres.
    const count = charges.length;
    const seqBase = new Array(count);
    const lo = new Array(count);
    const hi = new Array(count);
    const pinnedFlags = new Array(count);
    for (let index = 0; index < count; index += 1) {
      if (index === minimumIndex) {
        seqBase[index] = minimumUnits; lo[index] = minimumUnits; hi[index] = minimumUnits; pinnedFlags[index] = true;
      } else if (fixed.has(index)) {
        seqBase[index] = Math.round(charges[index] * SCALE); lo[index] = seqBase[index]; hi[index] = seqBase[index]; pinnedFlags[index] = true;
      } else if (maximumIndexes.includes(index)) {
        seqBase[index] = maximumUnits; lo[index] = maximumUnits; hi[index] = maximumUnits; pinnedFlags[index] = true;
      } else {
        seqBase[index] = finalUnits.get(index); lo[index] = minimumUnits; hi[index] = maximumUnits - 1; pinnedFlags[index] = false;
      }
    }
    const gapUnitsMax = Math.round(options.windowMinGapKg * SCALE);
    const runWindow = gap => {
      const gapOf = () => gap;
      const seq = seqBase.slice();
      if (!repairWindow(seq, lo, hi, pinnedFlags, options.windowSize, gapOf)) return null;
      if (findWindowViolation(seq, options.windowSize, gapOf, pinnedFlags)) throw new Error('Falha interna: a janela de furos vizinhos ficou violada após a distribuição.');
      return { seq };
    };
    const found = largestFeasibleGap(gapUnitsMax, runWindow);
    if (!found) {
      throw new Error(`Não há como manter cargas distintas entre furos vizinhos (até ${options.windowSize} posições) com este total. Ajuste o total.`);
    }
    const { result: { seq }, gapUnits } = found;
    const changed = seq.filter((value, index) => value !== seqBase[index] && !pinnedFlags[index]).length;
    const pinnedConflicts = countPinnedConflicts(seqBase, pinnedFlags, options.windowSize, gapUnitsMax);

    const result = charges.map((value, index) => {
      if (index === minimumIndex) return minimum;
      if (fixed.has(index)) return charges[index];
      if (maximumIndexes.includes(index)) return maximum;
      return seq[index] / SCALE;
    });
    const resultUnits = result.reduce((sum, value) => sum + Math.round(value * SCALE), 0);
    if (resultUnits !== targetUnits) {
      throw new Error('A distribuição não fechou exatamente no total informado. Tente um alvo com até seis casas decimais.');
    }
    if (options.notes) {
      if (gapUnits < gapUnitsMax) {
        options.notes.push(`A diferença mínima entre furos vizinhos ficou em ${formatKg(gapUnits)} kg (e não ${formatKg(gapUnitsMax)} kg): com uma diferença maior, estes furos fixos não cabem na janela de ${options.windowSize} posições.`);
      }
      if (pinnedConflicts > 0) {
        options.notes.push(pinnedConflictNote(pinnedConflicts, options.windowSize, gapUnitsMax));
      }
      if (changed > 0) {
        options.notes.push(`${changed === 1 ? '1 furo teve' : `${changed} furos tiveram`} a carga ajustada para manter ${formatKg(gapUnits)} kg de diferença entre furos vizinhos (até ${options.windowSize} posições antes ou depois); o total continua igual.`);
      }
    }
    return result;
  }

  root.OpenBlastCharge = { distributeCharges, redistributeZeroCharges };
})(typeof window !== 'undefined' ? window : globalThis);
