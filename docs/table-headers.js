(() => {
  // Cabeçalhos de tabela: reconhece colunas obrigatórias mesmo com caixa, acentos,
  // espaços ou separadores diferentes (ex.: "number" -> "Number", "Total_Charge kg" -> "Total_Charge_kg").
  // Módulo puro (sem DOM). Regras:
  //   - aliases explícitos (ex.: "Angle (º)") são aplicados sem aviso;
  //   - cabeçalho com o nome exato da coluna tem prioridade sobre variações;
  //   - só há ajuste quando a variação casa com exatamente uma coluna conhecida;
  //   - cada ajuste fora dos aliases é devolvido em `renamed` para aparecer como aviso.
  function canonicalKey(name) {
    return String(name ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function mapHeaders(headers, knownColumns, aliases = {}) {
    const trimmed = [...new Set(headers.map(header => String(header ?? '').trim()))];
    const mapping = new Map();
    const renamed = [];
    for (const header of trimmed) {
      mapping.set(header, aliases[header] || header);
    }
    const taken = new Set([...mapping.values()]);
    for (const header of trimmed) {
      const target = mapping.get(header);
      if (knownColumns.includes(target)) continue;
      const matches = knownColumns.filter(column => canonicalKey(column) === canonicalKey(target));
      if (matches.length === 1 && !taken.has(matches[0])) {
        const column = matches[0];
        mapping.set(header, column);
        taken.add(column);
        if (aliases[header] !== column) renamed.push({ from: header, to: column });
      }
    }
    return { mapping, renamed };
  }

  // Aplica o mapeamento de cabeçalhos a todas as linhas de uma tabela.
  function canonicalizeTable(rows, { knownColumns, aliases = {} }) {
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const { mapping, renamed } = mapHeaders(headers, knownColumns, aliases);
    const canonicalRows = rows.map(row => Object.fromEntries(
      Object.entries(row).map(([name, value]) => {
        const trimmed = String(name).trim();
        return [mapping.get(trimmed) ?? trimmed, value];
      })
    ));
    return { rows: canonicalRows, renamed };
  }

  window.OpenBlastTableHeaders = { canonicalKey, mapHeaders, canonicalizeTable };
})();
