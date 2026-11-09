(() => {
  // Cota (Z) do realizado. Módulo puro (sem DOM); regras em SPEC.md, seção "Cota (Z) do realizado".
  //  - Z (crest): Z do Config Final quando é cota plausível. Senão, Z Collar do Plano de Perfuração
  //    do mesmo Number, desde que o X/Y do Config Final esteja a até a tolerância do X/Y Collar do plano.
  //    Senão, o furo fica sem cota (vazio) e aparece em aviso.
  //  - Z (toe): Z_Toe do Config Final quando o Z (crest) também veio do Config Final e o valor é cota plausível.
  //    Senão, Z (crest) - profundidade realizada * cos(inclinação), com aviso.
  //  - Nenhum furo com cota: não bloqueia. Z (crest) e Z (toe) ficam em branco e o aviso
  //    "Nenhum furo com cota; Z em branco" aparece no topo da lista de avisos.
  //  - Furo de assinatura (hole.preserved): Z (crest) e Z (toe) são os valores do Config Final como vieram,
  //    sem consulta ao plano nem cálculo pela geometria, e sem bloqueio mesmo fora da faixa (aviso).
  // config: { minM, maxM, matchToleranceM } (espelho de business.elevation_* em config.yaml).
  // holes: [{ number, x, y, z, zToe, length, angle, preserved }] e designRows: [{ number, x, y, z }], valores numéricos ou null.

  function isPlausibleElevation(value, config) {
    return Number.isFinite(value) && value >= config.minM && value <= config.maxM;
  }

  function roundForMessage(value) {
    return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000).replace('.', ',') : 'sem valor';
  }

  function resolveElevations(holes, designRows, config) {
    const design = new Map(designRows.filter(row => Number.isFinite(row.number)).map(row => [row.number, row]));
    const byNumber = new Map();
    const invalidFinal = [];
    const missing = [];
    const preservedInvalid = [];
    const preservedBlank = [];
    const counts = { final: 0, design: 0, signature: 0, toeFinal: 0, toeComputed: 0, toeMissing: 0 };

    for (const hole of holes) {
      if (hole.preserved) {
        // Furo de assinatura: Z e Z_Toe do Config Final como vieram (SPEC.md, "Furo de assinatura").
        byNumber.set(hole.number, { zCrest: hole.z, zToe: hole.zToe, crestSource: 'signature', toeSource: 'signature' });
        if (hole.z === null) {
          preservedBlank.push(hole.number);
        } else {
          counts.signature += 1;
          if (!isPlausibleElevation(hole.z, config)) preservedInvalid.push(hole);
        }
        continue;
      }
      const finalValid = isPlausibleElevation(hole.z, config);
      if (hole.z !== null && !finalValid) invalidFinal.push(hole);
      let zCrest = null;
      let crestSource = null;
      let reason = '';
      if (finalValid) {
        zCrest = hole.z;
        crestSource = 'final';
        counts.final += 1;
      } else if (hole.z === null) {
        reason = 'Z ausente no Config Final';
      } else {
        const plan = design.get(hole.number);
        if (!plan) {
          reason = design.size ? 'não consta no plano de perfuração' : 'Plano de Perfuração não anexado';
        } else if (!Number.isFinite(plan.x) || !Number.isFinite(plan.y) || !Number.isFinite(hole.x) || !Number.isFinite(hole.y)) {
          reason = 'X/Y ausente para conferir com o plano';
        } else {
          const distance = Math.hypot(plan.x - hole.x, plan.y - hole.y);
          if (distance > config.matchToleranceM) {
            reason = `X/Y diverge do plano em ${roundForMessage(distance)} m`;
          } else if (!isPlausibleElevation(plan.z, config)) {
            reason = 'Z Collar do plano fora da faixa de cota';
          } else {
            zCrest = plan.z;
            crestSource = 'design';
            counts.design += 1;
          }
        }
      }
      if (zCrest === null) missing.push({ number: hole.number, reason });

      let zToe = null;
      let toeSource = null;
      if (crestSource === 'final' && isPlausibleElevation(hole.zToe, config)) {
        zToe = hole.zToe;
        toeSource = 'final';
        counts.toeFinal += 1;
      } else if (zCrest !== null && Number.isFinite(hole.length) && Number.isFinite(hole.angle)) {
        zToe = zCrest - hole.length * Math.cos((hole.angle * Math.PI) / 180);
        toeSource = 'computed';
        counts.toeComputed += 1;
      } else {
        counts.toeMissing += 1;
      }
      byNumber.set(hole.number, { zCrest, zToe, crestSource, toeSource });
    }

    const resolved = counts.final + counts.design + counts.signature;

    const warnings = [];
    if (holes.length && resolved === 0) {
      warnings.push(
        'Nenhum furo com cota; Z em branco. O Z do Config Final não é cota (faixa de ' + config.minM + ' a ' + config.maxM + ' m) ' +
        'e nenhum Z Collar do Plano de Perfuração foi conferido (X/Y dentro de ' + `${roundForMessage(config.matchToleranceM)} m).`
      );
    }
    for (const hole of preservedInvalid) {
      warnings.push(
        `Furo de assinatura ${hole.number}: Z (crest) = ${roundForMessage(hole.z)} mantido como veio do Config Final, ` +
        `embora fora da faixa de cota (${config.minM} a ${config.maxM} m).`
      );
    }
    for (const number of preservedBlank) {
      warnings.push(`Furo de assinatura ${number}: sem Z no Config Final; Z (crest) e Z (toe) ficam em branco, como na entrada.`);
    }
    if (invalidFinal.length) {
      const examples = invalidFinal.slice(0, 3).map(hole => `${hole.number} = ${roundForMessage(hole.z)}`).join('; ');
      warnings.push(
        `Config Final: o Z de ${invalidFinal.length} furo(s) não é cota (fora da faixa de ${config.minM} a ${config.maxM} m; ex.: ${examples}). ` +
        'Esses valores têm a ordem de grandeza das coordenadas X e não foram usados como cota.'
      );
    }
    if (counts.design) {
      warnings.push(
        `Z (crest) de ${counts.design} furo(s) obtido do Plano de Perfuração (Z Collar), com X/Y conferidos ` +
        `(tolerância de ${roundForMessage(config.matchToleranceM)} m).`
      );
    }
    if (missing.length) {
      const list = missing.slice(0, 10).map(item => `${item.number} (${item.reason})`).join('; ');
      const more = missing.length > 10 ? `; e mais ${missing.length - 10}` : '';
      warnings.push(`Sem cota (Z) válida para ${missing.length} furo(s): ${list}${more}. Z (crest) e Z (toe) ficam em branco nesses furos.`);
    }
    if (counts.toeComputed) {
      warnings.push(
        `Z (toe) de ${counts.toeComputed} furo(s) calculado como Z (crest) - profundidade realizada * cos(inclinação), ` +
        'porque o Z_Toe do Config Final não foi usado para esses furos.'
      );
    }
    return { byNumber, warnings, counts };
  }

  window.OpenBlastElevation = { isPlausibleElevation, resolveElevations };
})();
