(() => {
  const PLAN_ID_PATTERN = /\bPP(?:[\s._/-]*\d){6,8}(?:[_-][A-Z])?\b/gi;

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

  function resolvePlanAndFire(text, hints) {
    const normalizedHints = new Set(hints);
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
      return { planId, date, time };
    }
    const histoPlanIds = [...new Set(extractPlanIds(text).map(normalizePlanId).filter(Boolean))];
    const fires = events.filter(event => event[1] === 'Fire');
    if (!histoPlanIds.length && normalizedHints.size && fires.length) {
      const planId = [...normalizedHints][0];
      const fire = fires[fires.length - 1];
      return { planId, date: formatDate(fire[2]), time: fire[3] };
    }
    if (normalizedHints.size && histoPlanIds.length) {
      throw new Error(`O plano dos anexos (${[...normalizedHints].join(', ')}) não foi encontrado no HISTO. IDs encontrados: ${histoPlanIds.join(', ')}.`);
    }
    return extractPlanAndFire(text);
  }

  window.OpenBlastPlanId = {
    extractPlanIds, normalizePlanId, parsePlanId, planIdsMatch, planIdsMatchSameMonth, resolvePlanAndFire
  };
})();
