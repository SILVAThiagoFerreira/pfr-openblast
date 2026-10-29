(() => {
  // Interface do botão "Importar BREX (BMO)": escolhe o arquivo, lista os disparos
  // com o ajuste de horário aplicado ao vivo e preenche o horário de desmonte (HH:MM:SS).
  // Toda a leitura acontece no navegador; o arquivo não é enviado a servidor.
  const importButton = document.querySelector('#brex-import-button');
  const fileInput = document.querySelector('#brex-file');
  const importError = document.querySelector('#brex-import-error');
  const planIdentityInput = document.querySelector('#plan-identity');
  const fireDateInput = document.querySelector('#manual-fire-date');
  const fireTimeInput = document.querySelector('#manual-fire-time');
  const fireTimeError = document.querySelector('#manual-fire-time-error');
  const panel = document.querySelector('#brex-panel');
  const offsetInput = document.querySelector('#brex-offset-hours');
  const offsetError = document.querySelector('#brex-offset-error');
  const summary = document.querySelector('#brex-summary');
  const statusLine = document.querySelector('#brex-status');
  const warningsLine = document.querySelector('#brex-warnings');
  const list = document.querySelector('#brex-list');

  let detonations = [];
  let importedFiles = [];
  let importWarnings = [];
  let rankedEntries = [];
  let chosen = null;
  let limits = null;

  function setMessage(element, message = '') {
    element.textContent = message;
    element.hidden = !message;
  }

  function readConfig() {
    const business = window.PFR_BROWSER_CONFIG?.business || {};
    const values = {
      offsetHours: business.brexOffsetHours,
      minHours: business.brexOffsetMinHours,
      maxHours: business.brexOffsetMaxHours
    };
    const invalid = Object.entries(values).filter(([, value]) => !Number.isInteger(value)).map(([name]) => name);
    if (invalid.length) {
      throw new Error(`Configuração do BREX ausente ou inválida em config.js: ${invalid.join(', ')}.`);
    }
    if (values.offsetHours < values.minHours || values.offsetHours > values.maxHours) {
      throw new Error('Configuração do BREX inválida em config.js: o ajuste padrão está fora dos limites.');
    }
    return values;
  }

  function formatOffset(hours) {
    const sign = hours < 0 ? '-' : '+';
    return `UTC${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`;
  }

  async function readFileText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  }

  async function parseFile(file) {
    try {
      return window.OpenBlastBrex.parseBrex(await readFileText(file), file.name);
    } catch (error) {
      throw new Error(`${file.name}: ${error.message}`);
    }
  }

  // Identificadores exibidos: o principal (plano, nome, evento ou BMO) e os demais.
  function identifiers(detonation) {
    const eventText = detonation.eventNumber ? `Evento ${detonation.eventNumber}` : null;
    const serialText = `BMO ${detonation.bmoSerial ?? 's/n'}`;
    const secondary = [];
    let primary;
    if (detonation.planIds.length) {
      primary = `Plano ${detonation.planIds.join(' / ')}`;
      if (detonation.displayName && !detonation.displayName.includes(detonation.planIds[0])) {
        secondary.push(`Nome ${detonation.displayName}`);
      }
    } else if (detonation.displayName) {
      primary = `Nome ${detonation.displayName}`;
    } else {
      primary = eventText ?? serialText;
    }
    if (eventText && eventText !== primary) secondary.push(eventText);
    if (serialText !== primary) secondary.push(serialText);
    secondary.push(detonation.fileName);
    return { primary, secondary };
  }

  function chip(text, className = '') {
    const element = document.createElement('span');
    element.className = `brex-item__chip ${className}`.trim();
    element.textContent = text;
    return element;
  }

  function buildItem(entry) {
    const { detonation, adjusted, score, sameDate, matchedBy } = entry;
    const isChosen = chosen?.detonationId === detonation.id;
    const ids = identifiers(detonation);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'brex-item';
    button.dataset.detonationId = detonation.id;
    button.classList.toggle('is-suggested', score > 0);
    button.classList.toggle('is-chosen', isChosen);
    button.setAttribute('aria-pressed', String(isChosen));
    button.setAttribute('aria-label', `Disparo ${adjusted.date} às ${adjusted.time}, ${ids.primary}`);

    const time = document.createElement('span');
    time.className = 'brex-item__time';
    time.textContent = adjusted.time;

    const date = document.createElement('span');
    date.className = 'brex-item__date';
    date.textContent = sameDate ? `${adjusted.date} · data informada` : adjusted.date;

    const idLine = document.createElement('span');
    idLine.className = 'brex-item__ids';
    idLine.append(chip(ids.primary, 'is-primary'), ...ids.secondary.map(text => chip(text)));

    button.append(time, date, idLine);
    if (score > 0) {
      const badge = document.createElement('span');
      badge.className = 'brex-item__badge';
      badge.textContent = `Combina com o ID informado (${matchedBy})`;
      button.append(badge);
    }
    button.addEventListener('click', () => choose(detonation.id));
    item.append(button);
    return item;
  }

  function renderStatus(typedId, offsetHours) {
    const chosenEntry = chosen ? rankedEntries.find(entry => entry.detonation.id === chosen.detonationId) : null;
    if (chosenEntry) {
      const { detonation, adjusted } = chosenEntry;
      const label = window.OpenBlastBrex.eventLabel(detonation, typedId);
      const fireDate = fireDateInput.value;
      const dateNote = fireDate && adjusted.dateIso !== fireDate
        ? ` Atenção: a data informada (${fireDate.split('-').reverse().join('/')}) é diferente da data deste disparo.`
        : '';
      statusLine.textContent = `Horário ${adjusted.time} preenchido a partir de ${label} (${detonation.fileName}, ajuste ${formatOffset(offsetHours)}).${dateNote}`;
      return;
    }
    if (rankedEntries.some(entry => entry.score > 0)) {
      statusLine.textContent = 'Disparos que combinam com o ID informado estão destacados. Clique em um disparo para preencher o horário.';
      return;
    }
    statusLine.textContent = typedId
      ? 'Nenhum disparo combina com o ID informado; a lista segue a data informada e a ordem cronológica. Clique em um disparo para preencher o horário.'
      : 'Clique em um disparo para preencher o horário de desmonte (HH:MM:SS).';
  }

  function render() {
    if (!limits || !detonations.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    summary.textContent = `${detonations.length} disparo(s) em ${importedFiles.length} arquivo(s)`;
    setMessage(warningsLine, importWarnings.join(' '));
    let offsetHours;
    try {
      offsetHours = window.OpenBlastBrex.parseOffsetHours(offsetInput.value, limits.minHours, limits.maxHours);
      setMessage(offsetError);
      offsetInput.setAttribute('aria-invalid', 'false');
    } catch (error) {
      setMessage(offsetError, error.message);
      offsetInput.setAttribute('aria-invalid', 'true');
      rankedEntries = [];
      list.replaceChildren();
      statusLine.textContent = 'Corrija o ajuste de horário para ver os disparos.';
      return;
    }
    const typedId = planIdentityInput.value.trim();
    rankedEntries = window.OpenBlastBrex.rankDetonations(detonations, {
      query: typedId,
      fireDateIso: fireDateInput.value,
      offsetHours
    });
    list.replaceChildren(...rankedEntries.map(buildItem));
    renderStatus(typedId, offsetHours);
  }

  function choose(detonationId) {
    const entry = rankedEntries.find(item => item.detonation.id === detonationId);
    if (!entry) return;
    fireTimeInput.value = entry.adjusted.time;
    setMessage(fireTimeError);
    fireTimeInput.setAttribute('aria-invalid', 'false');
    chosen = { detonationId, filledTime: entry.adjusted.time };
    render();
    // A lista é recriada a cada render; devolve o foco ao disparo escolhido para teclado e leitor de tela.
    [...list.querySelectorAll('button')].find(button => button.dataset.detonationId === detonationId)?.focus();
  }

  importButton.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    importButton.disabled = true;
    try {
      const parsed = await Promise.all(files.map(parseFile));
      detonations = parsed.flatMap(item => item.detonations);
      importedFiles = parsed.map(item => item.fileName);
      importWarnings = parsed.flatMap(item => item.warnings.map(warning => `${item.fileName}: ${warning}`));
      chosen = null;
      setMessage(importError);
      render();
    } catch (error) {
      setMessage(importError, error.message);
    } finally {
      importButton.disabled = false;
    }
  });

  // Ajuste ao vivo: se o horário ainda é o que o botão preencheu, acompanha o novo ajuste.
  offsetInput.addEventListener('input', () => {
    render();
    if (!chosen) return;
    const entry = rankedEntries.find(item => item.detonation.id === chosen.detonationId);
    if (entry && fireTimeInput.value === chosen.filledTime) {
      fireTimeInput.value = entry.adjusted.time;
      chosen.filledTime = entry.adjusted.time;
      render();
    }
  });
  planIdentityInput.addEventListener('input', render);
  fireDateInput.addEventListener('input', render);
  fireDateInput.addEventListener('change', render);

  try {
    limits = readConfig();
    offsetInput.min = String(limits.minHours);
    offsetInput.max = String(limits.maxHours);
    offsetInput.value = String(limits.offsetHours);
  } catch (error) {
    importButton.disabled = true;
    setMessage(importError, `${error.message} A importação do BREX está desativada.`);
  }
  panel.hidden = true;
})();
