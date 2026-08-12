(() => {
  // O ID pode aparecer no nome dos anexos como PP440726 ou no HISTO novo
  // como BP:440826. O mês faz parte do código, mas não da identidade lógica
  // do plano: o projeto pode ser criado em um mês e disparado no seguinte.
  const PLAN_ID_PATTERN = /\bPP(?:[\s._/-]*\d){6,8}(?:[_-][A-Z])?\b|\bBP\s*:\s*(?:PP\s*)?\d{6,8}\b/gi;

  function digitsOnly(value) {
    return String(value ?? '').replace(/[^0-9]/g, '');
  }

  function normalizePlanId(value) {
    const digits = digitsOnly(value);
    return digits ? digits.replace(/^0+(?=\d)/, '') : '';
  }

  function parsePlanId(value) {
    const digits = digitsOnly(value);
    if (!/^\d{6,8}$/.test(digits)) return null;
    const month = digits.slice(-4, -2);
    const year = digits.slice(-2);
    const plan = normalizePlanId(digits.slice(0, -4));
    return {
      normalized: normalizePlanId(digits),
      plan,
      month,
      year,
      comparableKey: /^(0[1-9]|1[0-2])$/.test(month) && plan ? `${plan}:${year}` : null
    };
  }

  function parseManualPlanId(value) {
    const source = String(value ?? '').trim();
    const embedded = extractPlanIds(source);
    const candidate = embedded[0] || (/^\d{6,8}$/.test(source) ? source : '');
    return parsePlanId(candidate)?.normalized || '';
  }

  function planIdsMatch(left, right) {
    const leftParts = parsePlanId(left);
    const rightParts = parsePlanId(right);
    if (leftParts?.comparableKey && rightParts?.comparableKey) {
      return leftParts.comparableKey === rightParts.comparableKey;
    }
    return normalizePlanId(left) === normalizePlanId(right);
  }

  function planIdsMatchSameMonth(left, right) {
    const leftParts = parsePlanId(left);
    const rightParts = parsePlanId(right);
    return Boolean(leftParts?.comparableKey && rightParts?.comparableKey
      && leftParts.comparableKey === rightParts.comparableKey
      && leftParts.month === rightParts.month);
  }

  function extractPlanIds(value) {
    return [...String(value ?? '').matchAll(PLAN_ID_PATTERN)].map(match => match[0]);
  }

  function formatDate(date) {
    const [year, month, day] = date.split('/');
    return `${day}/${month}/${year}`;
  }

  function historyBlocks(text, events) {
    const source = String(text ?? '');
    return events
      .map((event, index) => {
        if (!['BlastingPlan', 'StartProcedure'].includes(event[1])) return null;
        const nextBlock = events.slice(index + 1).find(item => item[1] !== 'Fire');
        const end = nextBlock ? nextBlock.index : source.length;
        const fire = events.slice(index + 1).find(item => item[1] === 'Fire' && item.index < end);
        return {
          event,
          text: source.slice(event.index, end),
          fire,
          planIds: extractPlanIds(source.slice(event.index, end)).map(normalizePlanId).filter(Boolean)
        };
      })
      .filter(Boolean);
  }

  function extractPlanAndFire(text) {
    const eventRegex = /\[(BlastingPlan|StartProcedure|Fire)\][ \t]*(\d{4}\/\d{2}\/\d{2})-(\d{2}:\d{2}:\d{2})/g;
    const events = [...String(text ?? '').matchAll(eventRegex)];
    const block = historyBlocks(text, events).find(item => item.planIds.length && item.fire);
    if (block) {
      const planId = block.planIds[block.planIds.length - 1];
      return { planId, date: formatDate(block.fire[2]), time: block.fire[3] };
    }
    const plans = extractPlanIds(text).map(normalizePlanId);
    const planId = [...new Set(plans)].pop();
    if (!planId) throw new Error('Não foi possível identificar o plano no HISTO.');
    const fires = events.filter(event => event[1] === 'Fire');
    if (!fires.length) throw new Error('Não foi encontrado nenhum evento [Fire] válido no HISTO.');
    const fire = fires[fires.length - 1];
    return { planId, date: formatDate(fire[2]), time: fire[3] };
  }

  function normalizeHints(hints, manualPlanId) {
    const values = Array.isArray(hints) ? hints : [hints];
    const normalized = values
      .flatMap(value => {
        const manual = parseManualPlanId(value);
        return manual || normalizePlanId(value);
      })
      .filter(value => parsePlanId(value));
    if (manualPlanId) normalized.unshift(manualPlanId);
    return new Set(normalized);
  }

  function forcedPlanAndFire(text, events, blocks, normalizedHints, manualPlanId) {
    const fires = events.filter(event => event[1] === 'Fire');
    if (!fires.length) throw new Error('Não foi encontrado nenhum evento [Fire] válido no HISTO.');

    const hintValues = [...normalizedHints];
    const hintFamilies = new Set(hintValues.map(value => parsePlanId(value)?.comparableKey || value));
    if (!manualPlanId && hintFamilies.size > 1) {
      throw new Error(`Forçar execução exige um ID manual quando os anexos têm planos diferentes (${hintValues.join(', ')}).`);
    }
    const requestedPlanId = manualPlanId || hintValues[0] || '';
    const compatibleBlocks = requestedPlanId
      ? blocks.filter(block => block.fire && block.planIds.some(planId => planIdsMatch(requestedPlanId, planId)))
      : [];
    const candidateBlocks = compatibleBlocks.length ? compatibleBlocks : blocks.filter(block => block.fire);
    const block = candidateBlocks[candidateBlocks.length - 1];
    const fire = block?.fire || fires[fires.length - 1];
    const histoPlanId = block?.planIds?.[block.planIds.length - 1]
      || [...new Set(extractPlanIds(text).map(normalizePlanId).filter(Boolean))].pop()
      || '';
    const planId = requestedPlanId || histoPlanId;
    if (!planId) throw new Error('Informe o ID numérico do plano ou envie um anexo com o ID do plano antes de forçar a execução.');

    const event = { planId, date: formatDate(fire[2]), time: fire[3], forced: true };
    if (histoPlanId && histoPlanId !== planId) event.histoPlanId = histoPlanId;
    return event;
  }

  function resolvePlanAndFire(text, hints, options = {}) {
    const manualPlanId = parseManualPlanId(options.manualPlanId || options.manualIdentity);
    const normalizedHints = normalizeHints(hints, manualPlanId);
    if (options.force && !manualPlanId) {
      const hintFamilies = new Set([...normalizedHints].map(value => parsePlanId(value)?.comparableKey || value));
      if (hintFamilies.size > 1) {
        throw new Error(`Forçar execução exige um ID manual quando os anexos têm planos diferentes (${[...normalizedHints].join(', ')}).`);
      }
    }
    const source = String(text ?? '');
    const eventRegex = /\[(BlastingPlan|StartProcedure|Fire)\][ \t]*(\d{4}\/\d{2}\/\d{2})-(\d{2}:\d{2}:\d{2})/g;
    const events = [...source.matchAll(eventRegex)];
    const matches = historyBlocks(source, events).flatMap(block => {
      const match = block.planIds.map(planId => ({
        planId,
        hint: [...normalizedHints].find(sourceId => planIdsMatch(sourceId, planId))
      })).find(item => item.hint);
      return match && block.fire
        ? [{ ...match, date: formatDate(block.fire[2]), time: block.fire[3], fireIndex: block.fire.index }]
        : [];
    });
    const uniqueMatches = [...new Map(matches.map(match => [`${match.planId}|${match.fireIndex}`, match])).values()];
    const sameMonthMatches = uniqueMatches.filter(match => planIdsMatchSameMonth(match.hint, match.planId));
    const viableMatches = sameMonthMatches.length ? sameMonthMatches : uniqueMatches;
    if (viableMatches.length > 1) {
      throw new Error(`Foram encontrados múltiplos blocos [BlastingPlan] compatíveis com os anexos (${[...normalizedHints].join(', ')}): ${viableMatches.map(match => match.planId).join(', ')}.`);
    }
    if (viableMatches.length === 1) {
      const { planId, date, time } = viableMatches[0];
      const event = { planId: manualPlanId || planId, date, time };
      if (options.force) event.forced = true;
      if (manualPlanId && manualPlanId !== planId) event.histoPlanId = planId;
      return event;
    }
    const histoPlanIds = [...new Set(extractPlanIds(text).map(normalizePlanId).filter(Boolean))];
    const fires = events.filter(event => event[1] === 'Fire');
    if (!histoPlanIds.length && normalizedHints.size && fires.length) {
      if (options.force) return forcedPlanAndFire(text, events, historyBlocks(text, events), normalizedHints, manualPlanId);
      const planId = [...normalizedHints][0];
      const fire = fires[fires.length - 1];
      return { planId, date: formatDate(fire[2]), time: fire[3] };
    }
    if (normalizedHints.size && histoPlanIds.length) {
      if (options.force) return forcedPlanAndFire(text, events, historyBlocks(text, events), normalizedHints, manualPlanId);
      throw new Error(`O plano dos anexos (${[...normalizedHints].join(', ')}) não foi encontrado no HISTO. IDs encontrados: ${histoPlanIds.join(', ')}.`);
    }
    if (options.force) return forcedPlanAndFire(text, events, historyBlocks(text, events), normalizedHints, manualPlanId);
    return extractPlanAndFire(text);
  }

  window.OpenBlastPlanId = {
    extractPlanIds, normalizePlanId, parsePlanId, parseManualPlanId, planIdsMatch, planIdsMatchSameMonth, resolvePlanAndFire
  };
})();
