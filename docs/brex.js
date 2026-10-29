(() => {
  // Leitura do relatório BREX (XML) exportado pelo sismógrafo BMO.
  // Módulo puro: não acessa o DOM. A interface fica em brex-import.js.
  // Horários do BMO são tratados como relógio do dispositivo (UTC nas amostras);
  // o ajuste em horas inteiras é aplicado por quem chama, nunca aqui.
  const ROOT_NAME = 'DB_BLASTREPORT_EXCHANGE';
  const HOUR_MS = 60 * 60 * 1000;
  const MIN_SEARCH_LENGTH = 3;
  const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const TOKEN_PATTERN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
  const ATTRIBUTE_PATTERN = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  // Placa de plano: "PP" + 6 a 8 dígitos, ou 6 dígitos isolados (ex.: "490926_B").
  const PLAN_NAME_PATTERN = /PP[\s._/-]*(\d{6,8})(?!\d)|(^|\D)(\d{6})(?!\d)/gi;

  function brexError(message) {
    const error = new Error(`Arquivo BREX inválido: ${message}`);
    error.code = 'INVALID_BREX';
    return error;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function planIdApi() {
    const api = window.OpenBlastPlanId;
    if (!api) throw new Error('Módulo de identificação do plano (plan-id.js) não foi carregado.');
    return api;
  }

  function decodeEntities(value) {
    return String(value).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isInteger(code) && code >= 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match;
      }
      return ENTITY_MAP[body] ?? match;
    });
  }

  function parseAttributes(source) {
    const attrs = {};
    for (const match of String(source ?? '').matchAll(ATTRIBUTE_PATTERN)) {
      attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
    }
    return attrs;
  }

  // Lê o XML em uma árvore simples. Qualquer trecho fora da gramática (tag
  // não fechada, texto solto antes da raiz etc.) interrompe a leitura.
  function parseXml(text) {
    const source = String(text).replace(/^﻿/, '');
    const docNode = { name: '#document', attrs: {}, children: [], text: '' };
    const stack = [docNode];
    let position = 0;
    while (position < source.length) {
      TOKEN_PATTERN.lastIndex = position;
      const match = TOKEN_PATTERN.exec(source);
      if (!match) throw brexError(`XML malformado na posição ${position}.`);
      const token = match[0];
      const top = stack[stack.length - 1];
      if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!DOCTYPE')) {
        // Comentários, declarações e DOCTYPE não carregam dados.
      } else if (token.startsWith('<![CDATA[')) {
        top.text += match[1];
      } else if (token.startsWith('</')) {
        const name = match[2];
        if (stack.length === 1 || top.name !== name) {
          throw brexError(`tag de fechamento </${name}> sem abertura correspondente (posição ${position}).`);
        }
        stack.pop();
      } else if (token.startsWith('<')) {
        const element = { name: match[3], attrs: parseAttributes(match[4]), children: [], text: '' };
        top.children.push(element);
        if (match[5] !== '/') stack.push(element);
      } else if (top === docNode) {
        if (match[6].trim()) throw brexError(`texto fora do elemento raiz (posição ${position}).`);
      } else {
        top.text += decodeEntities(match[6]);
      }
      position += token.length;
    }
    if (stack.length > 1) throw brexError(`a tag <${stack[stack.length - 1].name}> não foi fechada.`);
    if (docNode.children.length !== 1) throw brexError('o arquivo precisa ter exatamente um elemento raiz.');
    return docNode.children[0];
  }

  const childrenNamed = (element, name) => element.children.filter(child => child.name === name);
  const firstChild = (element, name) => element.children.find(child => child.name === name) ?? null;

  function pathText(element, names) {
    let current = element;
    for (const name of names) {
      current = current ? firstChild(current, name) : null;
    }
    return current ? current.text.trim() : '';
  }

  function parseDeviceDate(value) {
    const match = String(value ?? '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function parseDeviceTime(value) {
    const match = String(value ?? '').match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [hour, minute, second] = match.slice(1).map(Number);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  }

  // Extrai IDs de plano do nome do disparo no BMO, validados pela regra PLANO;MÊS;ANO.
  function planIdsFromName(name) {
    const api = planIdApi();
    const ids = [];
    for (const match of String(name ?? '').matchAll(PLAN_NAME_PATTERN)) {
      const normalized = api.parsePlanId(match[1] ?? match[3])?.normalized;
      if (normalized && !ids.includes(normalized)) ids.push(normalized);
    }
    return ids;
  }

  // Eventos do BLAST_CONTEXT: cada BLAST_EVENT_ID abre um registro; o TAG com
  // FIRING_TAG marca o evento de disparo.
  function readEvents(root) {
    const context = firstChild(root, 'BLAST_CONTEXT');
    if (!context) return [];
    const events = [];
    let current = null;
    for (const child of context.children) {
      if (child.name === 'BLAST_EVENT_ID') {
        current = { eventId: child.text.trim(), firing: false };
        events.push(current);
      } else if (current && child.name === 'TAG' && firstChild(child, 'FIRING_TAG')) {
        current.firing = true;
      }
    }
    return events;
  }

  function pickEventNumber(events) {
    const firing = events.filter(event => event.firing && event.eventId);
    const chosen = firing.length ? firing[firing.length - 1] : events.filter(event => event.eventId).at(-1);
    return chosen ? chosen.eventId : null;
  }

  // Lê um arquivo .brex e devolve um disparo por bloco <DATA> com horário de disparo.
  function parseBrex(text, fileName = 'arquivo.brex') {
    if (!String(text ?? '').trim()) throw brexError('o arquivo está vazio.');
    const root = parseXml(text);
    if (root.name !== ROOT_NAME) {
      throw brexError(`raiz <${root.name}>, esperado <${ROOT_NAME}>. Confira se o arquivo foi exportado pelo BMO.`);
    }
    const eventNumber = pickEventNumber(readEvents(root));
    const detonations = [];
    const warnings = [];
    childrenNamed(root, 'DATA').forEach((data, index) => {
      const serial = data.attrs.DBD_SN?.trim() || null;
      const label = `BMO ${serial ?? 's/n'} (bloco ${index + 1})`;
      const dateText = pathText(data, ['SUMMARY_UNIT', 'CHRONO', 'FIRING_DATE']);
      const startText = pathText(data, ['SUMMARY_UNIT', 'CHRONO', 'FIRING_TIME_START']);
      if (!dateText && !startText) {
        warnings.push(`${label} sem horário de disparo; o bloco foi ignorado.`);
        return;
      }
      const date = parseDeviceDate(dateText);
      const time = parseDeviceTime(startText);
      if (!date || !time) {
        throw brexError(`${label} com data ou horário de disparo inválido ("${dateText} ${startText}").`);
      }
      const totalText = pathText(data, ['SUMMARY_UNIT', 'SUMMARY_DET', 'TOTAL']);
      const displayName = pathText(data, ['DISPLAYED_NAME']);
      detonations.push({
        id: `${fileName}#${index + 1}`,
        fileName,
        bmoSerial: serial,
        displayName,
        planIds: planIdsFromName(displayName),
        eventNumber,
        detonators: /^\d+$/.test(totalText) ? Number(totalText) : null,
        date,
        time
      });
    });
    if (!detonations.length) throw brexError('nenhum disparo com data e horário foi encontrado.');
    return { fileName, detonations, warnings };
  }

  // Valida o ajuste informado: inteiro de horas dentro dos limites da configuração.
  function parseOffsetHours(value, min, max) {
    const text = String(value ?? '').trim();
    const message = `informe um número inteiro de horas entre ${min} e ${max}.`;
    if (!/^[+-]?\d{1,2}$/.test(text)) throw new Error(`Ajuste de horário inválido: ${message}`);
    const hours = Number(text);
    if (hours < min || hours > max) throw new Error(`Ajuste de horário inválido: ${message}`);
    return hours;
  }

  function adjustDetonation(detonation, offsetHours) {
    const [year, month, day] = detonation.date.split('-').map(Number);
    const [hour, minute, second] = detonation.time.split(':').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute, second) + offsetHours * HOUR_MS);
    const dd = pad(shifted.getUTCDate());
    const mm = pad(shifted.getUTCMonth() + 1);
    const yyyy = shifted.getUTCFullYear();
    const hh = pad(shifted.getUTCHours());
    const min = pad(shifted.getUTCMinutes());
    const ss = pad(shifted.getUTCSeconds());
    return {
      dateIso: `${yyyy}-${mm}-${dd}`,
      date: `${dd}/${mm}/${yyyy}`,
      time: `${hh}:${min}:${ss}`,
      sortKey: shifted.getTime()
    };
  }

  function normalizeIdentity(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function identityTokens(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 2);
  }

  // Pontua o quanto o ID/nome digitado combina com o disparo:
  // plano (mesmo plano e ano, mês ignorado) 90; igualdade após normalização 100;
  // contenção de texto 70; metade ou mais das palavras encontradas 20 a 40.
  function scoreDetonation(detonation, query, api) {
    const normalizedQuery = normalizeIdentity(query);
    if (!normalizedQuery) return { score: 0, matchedBy: null };
    const queryPlan = api.parseManualPlanId(query);
    const tokens = identityTokens(query);
    const candidates = [
      ...detonation.planIds.map(planId => ({ label: 'plano', value: planId, plan: true })),
      detonation.displayName && { label: 'nome', value: detonation.displayName },
      detonation.bmoSerial && { label: 'BMO', value: `BMO ${detonation.bmoSerial}` },
      detonation.eventNumber && { label: 'evento', value: detonation.eventNumber },
      { label: 'arquivo', value: detonation.fileName.replace(/\.[^.]+$/, '') }
    ].filter(Boolean);
    let best = { score: 0, matchedBy: null };
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeIdentity(candidate.value);
      let score = 0;
      if (candidate.plan && queryPlan && api.planIdsMatch(queryPlan, candidate.value)) score = 90;
      if (normalizedCandidate === normalizedQuery) {
        score = Math.max(score, 100);
      } else if (
        normalizedQuery.length >= MIN_SEARCH_LENGTH
        && normalizedCandidate.length >= MIN_SEARCH_LENGTH
        && (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate))
      ) {
        score = Math.max(score, 70);
      } else if (tokens.length >= 2) {
        const hits = tokens.filter(token => normalizedCandidate.includes(token)).length;
        const coverage = hits / tokens.length;
        if (coverage >= 0.5) score = Math.max(score, Math.round(40 * coverage));
      }
      if (score > best.score) best = { score, matchedBy: candidate.label };
    }
    return best;
  }

  // Ordem: ID/nome combinando primeiro (maior pontuação), depois disparos na data
  // informada, depois cronológica pelo horário ajustado.
  function rankDetonations(detonations, { query = '', fireDateIso = '', offsetHours }) {
    const api = planIdApi();
    return detonations
      .map(detonation => {
        const adjusted = adjustDetonation(detonation, offsetHours);
        const match = scoreDetonation(detonation, query, api);
        return {
          detonation,
          adjusted,
          score: match.score,
          matchedBy: match.matchedBy,
          sameDate: Boolean(fireDateIso) && adjusted.dateIso === fireDateIso
        };
      })
      .sort((left, right) => (right.score - left.score)
        || (Number(right.sameDate) - Number(left.sameDate))
        || (left.adjusted.sortKey - right.adjusted.sortKey));
  }

  // Rótulo do disparo escolhido: plano do evento; sem ID no evento, o ID digitado.
  function eventLabel(detonation, typedId = '') {
    if (detonation.planIds.length) return `Plano ${detonation.planIds[0]}`;
    const typed = String(typedId ?? '').trim();
    if (typed) return typed;
    if (detonation.displayName) return detonation.displayName;
    if (detonation.eventNumber) return `Evento ${detonation.eventNumber}`;
    return `BMO ${detonation.bmoSerial ?? 's/n'}`;
  }

  window.OpenBlastBrex = {
    parseBrex,
    parseOffsetHours,
    adjustDetonation,
    rankDetonations,
    eventLabel,
    normalizeIdentity
  };
})();
