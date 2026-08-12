(() => {
  // O ID pode aparecer no nome dos anexos como PP440726 ou no HISTO novo
  // como BP:440826. O mês faz parte do código, mas não da identidade lógica
  // do plano: o projeto pode ser criado em um mês e disparado no seguinte.
  const PLAN_ID_PATTERN = /\bPP(?:[\s._/-]*\d){6,8}(?:[_-][A-Z])?\b|\bBP\s*:\s*(?:PP\s*)?\d{6,8}\b/gi;
  const EVENT_HEADER_PATTERN = /^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:(\d{4}\/\d{1,2}\/\d{1,2})-)?(\d{1,2}:\d{2}:\d{2})?[^\r\n]*$/gm;

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
    const candidate = embedded[0] || source.match(/\b\d{6,8}\b/)?.[0] || '';
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

  function normalizeDatePart(value) {
    const match = String(value ?? '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    return match ? `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}` : '';
  }

  function formatDate(date) {
    const normalized = normalizeDatePart(date);
    if (!normalized) return '';
    const [year, month, day] = normalized.split('/');
    return `${day}/${month}/${year}`;
  }

  function normalizeFireTime(value) {
    const source = String(value ?? '').trim();
    if (!source) return '';
    const match = source.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }

  function planError(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    return error;
  }

  function parseHistoryEvents(text) {
    const source = String(text ?? '');
    let currentDate = '';
    return [...source.matchAll(EVENT_HEADER_PATTERN)].map(match => {
      const rawName = match[1].trim();
      const name = rawName.toLowerCase() === 'blastplan' ? 'BlastingPlan' : rawName;
      if (match[2]) currentDate = normalizeDatePart(match[2]);
      const event = [match[0], name, currentDate, normalizeFireTime(match[3])];
      event.index = match.index;
      event.rawName = rawName;
      event.hasExplicitDate = Boolean(match[2]);
      return event;
    });
  }

  function historyDateFromEvents(events) {
    return [...events].reverse().find(event => event[2])?.[2] || '';
  }

  function historyBlocks(text, events) {
    const source = String(text ?? '');
    return events
      .map((event, index) => {
        if (!['BlastingPlan', 'StartProcedure'].includes(event[1])) return null;
        const nextBlock = events.slice(index + 1).find(item => {
          if (item[1] === 'BlastingPlan') return true;
          if (item[1] === 'StartProcedure') return event[1] === 'StartProcedure';
          return ['PowerOn', 'HistoryStart', 'HistoryEnd'].includes(item[1]);
        });
        const end = nextBlock ? nextBlock.index : source.length;
        const fire = events.slice(index + 1).find(item => item[1] === 'Fire' && item.index < end && item[3]);
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
    const source = String(text ?? '');
    const events = parseHistoryEvents(source);
    const block = historyBlocks(source, events).find(item => item.planIds.length && item.fire);
    if (block) {
      const planId = block.planIds[block.planIds.length - 1];
      return { planId, date: formatDate(block.fire[2]), time: block.fire[3] };
    }
    const plans = extractPlanIds(source).map(normalizePlanId);
    const planId = [...new Set(plans)].pop();
    if (!planId) throw planError('Não foi possível identificar o plano no HISTO.', 'MISSING_PLAN_ID');
    const fires = events.filter(event => event[1] === 'Fire' && event[3]);
    if (!fires.length) throw planError('Não foi possível identificar o horário do disparo no HISTO. Informe o horário do desmonte e tente novamente.', 'MISSING_FIRE_TIME');
    const fire = fires[fires.length - 1];
    if (!fire[2]) throw planError('Não foi possível identificar a data do disparo no HISTO.', 'MISSING_FIRE_DATE');
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

  function fallbackPlanAndFire(text, events, normalizedHints, manualPlanId, manualFireTime, forced) {
    const hintValues = [...normalizedHints];
    const histoPlanId = [...new Set(extractPlanIds(text).map(normalizePlanId).filter(Boolean))].pop() || '';
    const planId = manualPlanId || hintValues[0] || histoPlanId;
    if (!planId) throw planError('Informe o ID numérico do plano ou envie um anexo com o ID do plano antes de continuar.', 'MISSING_PLAN_ID');
    const date = historyDateFromEvents(events);
    if (!date) throw planError('Não foi possível identificar a data do disparo no HISTO.', 'MISSING_FIRE_DATE');
    if (!manualFireTime && !forced) {
      throw planError('Não foi possível identificar o horário do disparo no HISTO. Informe o horário do desmonte e tente novamente.', 'MISSING_FIRE_TIME');
    }
    const event = {
      planId,
      date: formatDate(date),
      time: manualFireTime || '12:00:00'
    };
    if (forced) event.forced = true;
    event.timeSource = manualFireTime ? 'manual' : 'force-default';
    if (histoPlanId && histoPlanId !== planId) event.histoPlanId = histoPlanId;
    return event;
  }

  function forcedPlanAndFire(text, events, blocks, normalizedHints, manualPlanId, manualFireTime) {
    const fires = events.filter(event => event[1] === 'Fire' && event[3]);
    const hintValues = [...normalizedHints];
    const hintFamilies = new Set(hintValues.map(value => parsePlanId(value)?.comparableKey || value));
    if (!manualPlanId && hintFamilies.size > 1) {
      throw planError(`Forçar execução exige um ID manual quando os anexos têm planos diferentes (${hintValues.join(', ')}).`, 'MULTIPLE_PLAN_HINTS');
    }
    if (!fires.length) return fallbackPlanAndFire(text, events, normalizedHints, manualPlanId, manualFireTime, true);

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
    if (!planId) throw planError('Informe o ID numérico do plano ou envie um anexo com o ID do plano antes de forçar a execução.', 'MISSING_PLAN_ID');
    if (!fire[2]) throw planError('Não foi possível identificar a data do disparo no HISTO.', 'MISSING_FIRE_DATE');

    const event = { planId, date: formatDate(fire[2]), time: manualFireTime || fire[3], forced: true };
    if (manualFireTime) event.timeSource = 'manual';
    if (histoPlanId && histoPlanId !== planId) event.histoPlanId = histoPlanId;
    return event;
  }

  function resolvePlanAndFire(text, hints, options = {}) {
    const manualPlanId = parseManualPlanId(options.manualPlanId || options.manualIdentity);
    const rawManualFireTime = options.manualFireTime || options.fireTime || '';
    if (rawManualFireTime && !normalizeFireTime(rawManualFireTime)) {
      throw planError('O horário informado é inválido. Use o formato HH:MM ou HH:MM:SS.', 'INVALID_FIRE_TIME');
    }
    const manualFireTime = normalizeFireTime(rawManualFireTime);
    const normalizedHints = normalizeHints(hints, manualPlanId);
    if (options.force && !manualPlanId) {
      const hintFamilies = new Set([...normalizedHints].map(value => parsePlanId(value)?.comparableKey || value));
      if (hintFamilies.size > 1) {
        throw planError(`Forçar execução exige um ID manual quando os anexos têm planos diferentes (${[...normalizedHints].join(', ')}).`, 'MULTIPLE_PLAN_HINTS');
      }
    }
    const source = String(text ?? '');
    const events = parseHistoryEvents(source);
    const blocks = historyBlocks(source, events);
    const matches = blocks.flatMap(block => {
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
      throw planError(`Foram encontrados múltiplos blocos [BlastingPlan] compatíveis com os anexos (${[...normalizedHints].join(', ')}): ${viableMatches.map(match => match.planId).join(', ')}.`, 'MULTIPLE_PLAN_BLOCKS');
    }
    if (viableMatches.length === 1) {
      const { planId, date, time } = viableMatches[0];
      const event = { planId: manualPlanId || planId, date, time: manualFireTime || time };
      if (options.force) event.forced = true;
      if (manualFireTime) event.timeSource = 'manual';
      if (manualPlanId && manualPlanId !== planId) event.histoPlanId = planId;
      return event;
    }

    const histoPlanIds = [...new Set(extractPlanIds(source).map(normalizePlanId).filter(Boolean))];
    const fires = events.filter(event => event[1] === 'Fire' && event[3]);
    const matchingHistoPlan = histoPlanIds.some(histoPlanId => [...normalizedHints].some(hint => planIdsMatch(hint, histoPlanId)));
    if (normalizedHints.size && histoPlanIds.length && !matchingHistoPlan) {
      if (options.force) return forcedPlanAndFire(source, events, blocks, normalizedHints, manualPlanId, manualFireTime);
      throw planError(`O plano dos anexos (${[...normalizedHints].join(', ')}) não foi encontrado no HISTO. IDs encontrados: ${histoPlanIds.join(', ')}.`, 'PLAN_NOT_FOUND_IN_HISTO');
    }
    if (!fires.length) {
      if (options.force) return forcedPlanAndFire(source, events, blocks, normalizedHints, manualPlanId, manualFireTime);
      return fallbackPlanAndFire(source, events, normalizedHints, manualPlanId, manualFireTime, false);
    }
    if (!histoPlanIds.length && normalizedHints.size) {
      const hintFamilies = new Set([...normalizedHints].map(value => parsePlanId(value)?.comparableKey || value));
      if (hintFamilies.size > 1) {
        throw planError(`Não foi possível selecionar o plano automaticamente porque os anexos têm IDs diferentes (${[...normalizedHints].join(', ')}). Informe o ID/nome do plano em trabalho.`, 'MULTIPLE_PLAN_HINTS');
      }
      if (options.force) return forcedPlanAndFire(source, events, blocks, normalizedHints, manualPlanId, manualFireTime);
      const planId = [...normalizedHints][0];
      const fire = fires[fires.length - 1];
      return { planId, date: formatDate(fire[2]), time: manualFireTime || fire[3], ...(manualFireTime ? { timeSource: 'manual' } : {}) };
    }
    if (options.force) return forcedPlanAndFire(source, events, blocks, normalizedHints, manualPlanId, manualFireTime);
    return extractPlanAndFire(source);
  }

  window.OpenBlastPlanId = {
    extractPlanIds,
    normalizePlanId,
    parsePlanId,
    parseManualPlanId,
    normalizeFireTime,
    parseHistoryEvents,
    planIdsMatch,
    planIdsMatchSameMonth,
    resolvePlanAndFire
  };
})();
