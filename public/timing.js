(function exposeTiming(global) {
  function normalize(value) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.round(number);
  }

  function firstAvailable(start, forbidden, chosen) {
    let value = Math.max(0, Math.round(start));
    while (forbidden.has(value) || chosen.includes(value)) value += 1;
    return value;
  }

  function uniqueSequence(lower, upper, count, forbidden) {
    if (count <= 0) return [];
    const chosen = [];
    const availableInterior = lower !== null && upper !== null && upper > lower
      ? Math.max(0, upper - lower - 1 - [...forbidden].filter(value => value > lower && value < upper).length)
      : 0;

    if (lower !== null && upper !== null && upper > lower && availableInterior >= count) {
      let previous = lower;
      for (let index = 1; index <= count; index += 1) {
        const remaining = count - index;
        let value = Math.max(previous + 1, Math.floor(lower + ((upper - lower) * index) / (count + 1)));
        const maxValue = upper - remaining - 1;
        while (value <= maxValue && (forbidden.has(value) || chosen.includes(value))) value += 1;
        if (value > maxValue) break;
        chosen.push(value);
        previous = value;
      }
      if (chosen.length === count) return chosen;
    }

    if (upper !== null && lower === null) {
      let value = upper - 1;
      while (chosen.length < count && value >= 0) {
        if (!forbidden.has(value)) chosen.unshift(value);
        value -= 1;
      }
      if (chosen.length === count) return chosen;
      chosen.length = 0;
    }

    let value = firstAvailable(lower !== null ? lower + 1 : (upper !== null ? upper + 1 : 1), forbidden, chosen);
    while (chosen.length < count) {
      chosen.push(value);
      value = firstAvailable(value + 1, forbidden, chosen);
    }
    return chosen;
  }

  function fillMissingTimes(values) {
    const result = values.map(normalize);
    const forbidden = new Set();
    let imputed = 0;

    for (let index = 0; index < result.length; index += 1) {
      const value = result[index];
      if (value === null || forbidden.has(value)) {
        result[index] = null;
        continue;
      }
      forbidden.add(value);
    }

    let start = 0;
    while (start < result.length) {
      if (result[start] !== null) {
        start += 1;
        continue;
      }
      let end = start;
      while (end < result.length && result[end] === null) end += 1;
      const left = start > 0 ? result[start - 1] : null;
      const right = end < result.length ? result[end] : null;
      const filled = uniqueSequence(left, right, end - start, forbidden);
      filled.forEach((value, offset) => {
        result[start + offset] = value;
        forbidden.add(value);
        imputed += 1;
      });
      start = end;
    }

    return { values: result, imputed };
  }

  global.OpenBlastTiming = { fillMissingTimes };
})(window);
