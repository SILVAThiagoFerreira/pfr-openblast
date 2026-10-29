(() => {
  // Identificação do plano gravada no Excel e usada no nome do arquivo.
  // Módulo puro (sem DOM). Ordem de resolução:
  //   1. ID digitado (número ou nome, ex.: "REG CRISTA F3"), gravado como digitado;
  //   2. ID numérico resolvido pelos anexos ou pelo HISTO (plan-id.js);
  //   3. nome do PDF/planilha dos anexos, sem termos genéricos;
  //   4. ID gerado com prefixo configurado e a data/hora do disparo.
  // Os itens 3 e 4 geram aviso não bloqueante, retornado ao chamador.
  const NUMERIC_LIKE_PATTERN = /^\s*(?:(?:plano|pp|bp)[\s._:/-]*)*\d{6,8}(?:[_-][A-Z])?\s*$/i;
  const COMBINING_MARKS = /[̀-ͯ]/g;

  function configError(name) {
    return new Error(`Configuração de identificação do plano ausente ou inválida em config.js: ${name}.`);
  }

  function stripAccents(value) {
    return String(value ?? '').normalize('NFD').replace(COMBINING_MARKS, '');
  }

  // Comparação de termos: sem acentos, minúsculas, somente letras e números separados por espaço.
  function normalizeWords(value) {
    return stripAccents(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function readConfig(config) {
    const prefix = config?.planLabelFallbackPrefix;
    const maxLength = config?.planLabelMaxLength;
    const genericNames = config?.planLabelGenericNames;
    const planTemplate = config?.outputNameTemplate;
    const textTemplate = config?.outputNameTextTemplate;
    if (!/^[A-Za-z0-9]{1,16}$/.test(String(prefix ?? ''))) throw configError('planLabelFallbackPrefix');
    if (!Number.isInteger(maxLength) || maxLength < 8 || maxLength > 120) throw configError('planLabelMaxLength');
    if (!Array.isArray(genericNames) || genericNames.some(name => typeof name !== 'string')) throw configError('planLabelGenericNames');
    if (!String(planTemplate ?? '').includes('{plan_id}')) throw configError('outputNameTemplate');
    if (!String(textTemplate ?? '').includes('{plan_label}')) throw configError('outputNameTextTemplate');
    return {
      prefix,
      maxLength,
      genericNames: new Set(genericNames.map(normalizeWords)),
      planTemplate,
      textTemplate
    };
  }

  // Nome seguro para arquivo: sem acentos, caracteres inválidos no Windows ou espaços.
  // O texto gravado na célula do Excel não passa por esta função.
  function sanitizeFileStem(value, maxLength) {
    const ascii = stripAccents(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/[^A-Za-z0-9 ._-]/g, ' ');
    const trimSeparators = text => text.replace(/^[._-]+|[._-]+$/g, '');
    let stem = trimSeparators(ascii.trim().replace(/\s+/g, '_').replace(/_+/g, '_'));
    if (stem.length > maxLength) stem = trimSeparators(stem.slice(0, maxLength));
    return stem;
  }

  // Nome de arquivo derivado de "Crista_F3.pdf": sem extensão e com sublinhados como espaços.
  function labelFromFileName(fileName) {
    return String(fileName ?? '')
      .replace(/\.[^.]+$/, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function deriveLabelFromFileNames(fileNames, settings) {
    for (const fileName of fileNames) {
      const label = labelFromFileName(fileName);
      const words = normalizeWords(label);
      if (words.replace(/ /g, '').length < 2) continue;
      if (settings.genericNames.has(words)) continue;
      return { label, fileName };
    }
    return null;
  }

  function generatedPlanLabel(prefix, date, time) {
    const dateMatch = String(date ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const timeMatch = String(time ?? '').match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) {
      throw new Error('Data ou horário do disparo ausentes; não foi possível gerar o ID do plano.');
    }
    const [, day, month, year] = dateMatch;
    const [, hour, minute, second] = timeMatch;
    return `${prefix}_${year}${month}${day}_${hour}${minute}${second}`;
  }

  // Resolve o ID do plano para a execução atual. `manualPlanId` é o ID numérico
  // reconhecido no texto digitado (plan-id.js); `resolvedPlanId` é o ID numérico
  // obtido dos anexos ou do HISTO. `fileNames` deve vir em ordem de preferência.
  function resolvePlanIdentity({ typedRaw = '', manualPlanId = '', resolvedPlanId = '', fileNames = [], date, time, config }) {
    const settings = readConfig(config);
    const typed = String(typedRaw ?? '').trim();
    if (typed) {
      const planId = NUMERIC_LIKE_PATTERN.test(typed) && manualPlanId ? String(manualPlanId) : typed;
      return { planId, source: 'typed', warnings: [] };
    }
    if (resolvedPlanId) {
      return { planId: String(resolvedPlanId), source: 'documents', warnings: [] };
    }
    const derived = deriveLabelFromFileNames(fileNames, settings);
    if (derived) {
      return {
        planId: derived.label,
        source: 'file-name',
        warnings: [`Nenhum ID foi digitado nem encontrado nos anexos. O ID do plano foi derivado do nome do arquivo "${derived.fileName}": "${derived.label}". Informe o ID no campo de identificação para substituí-lo.`]
      };
    }
    const generated = generatedPlanLabel(settings.prefix, date, time);
    return {
      planId: generated,
      source: 'generated',
      warnings: [`Nenhum ID foi digitado, encontrado nos anexos ou derivado dos nomes dos arquivos. O ID gerado é ${generated}, a partir da data e do horário do disparo. Informe o ID no campo de identificação para substituí-lo.`]
    };
  }

  // Nome do arquivo: ID numérico segue o modelo PP{plan_id}; qualquer outro ID usa o nome sanitizado.
  function outputFileName(planId, config) {
    const settings = readConfig(config);
    const id = String(planId ?? '').trim();
    if (/^\d+$/.test(id)) {
      return { fileName: settings.planTemplate.replace('{plan_id}', id), warnings: [] };
    }
    const stem = sanitizeFileStem(id, settings.maxLength);
    if (!stem) {
      return {
        fileName: 'Plano_Fogo_Realizado.xlsx',
        warnings: [`O ID "${id}" não tem caracteres aceitos em nome de arquivo; o Excel foi salvo como Plano_Fogo_Realizado.xlsx. A aba Resumo mantém o ID digitado.`]
      };
    }
    return { fileName: settings.textTemplate.replace('{plan_label}', stem), warnings: [] };
  }

  window.OpenBlastPlanLabel = {
    sanitizeFileStem,
    deriveLabelFromFileNames: (fileNames, config) => deriveLabelFromFileNames(fileNames, readConfig(config)),
    generatedPlanLabel,
    resolvePlanIdentity,
    outputFileName
  };
})();
