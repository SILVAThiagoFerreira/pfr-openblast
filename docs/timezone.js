(() => {
  const NONE = 'none';

  function parseOffset(value) {
    if (value === null || value === undefined || value === '' || value === NONE) return null;
    const match = String(value).trim().match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!match) throw new Error(`Fuso horário inválido: ${value}. Use o formato ±HH:MM.`);
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours > 23 || minutes > 59) throw new Error(`Fuso horário inválido: ${value}.`);
    const total = hours * 60 + minutes;
    return match[1] === '-' ? -total : total;
  }

  function formatOffset(value) {
    const total = Number(value);
    if (!Number.isInteger(total) || Math.abs(total) > 1439) throw new Error(`Fuso horário inválido: ${value}.`);
    const sign = total < 0 ? '-' : '+';
    const absolute = Math.abs(total);
    return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  }

  function parseDateTime(event) {
    const dateMatch = String(event?.date ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const timeMatch = String(event?.time ?? '').trim().match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) throw new Error('A data ou a hora do HISTO não está em um formato válido.');
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) {
      throw new Error('A data ou a hora do HISTO não é válida.');
    }
    const timestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds);
    const check = new Date(timestamp);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new Error('A data do HISTO não é válida.');
    }
    return timestamp;
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`;
  }

  function convertEvent(event, targetOffset, sourceOffset = '+00:00') {
    if (event?.timeSource === 'manual' || event?.timeSource === 'force-default') {
      return { ...event, timezoneOffset: null };
    }
    const targetMinutes = parseOffset(targetOffset);
    if (targetMinutes === null) return { ...event, timezoneOffset: null };
    const sourceMinutes = parseOffset(sourceOffset) ?? 0;
    const timestamp = parseDateTime(event) - sourceMinutes * 60 * 1000 + targetMinutes * 60 * 1000;
    return {
      ...event,
      date: formatDate(timestamp),
      time: formatTime(timestamp),
      timezoneOffset: formatOffset(targetMinutes)
    };
  }

  window.OpenBlastTimezone = { parseOffset, formatOffset, convertEvent, convertEventTime: convertEvent };
})();
