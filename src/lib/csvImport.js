// ============================================================
// IMPORT DE CSV
// Soporta formato Yahoo Finance: Date,Open,High,Low,Close,Adj Close,Volume
// También variantes con comas o punto y coma como separador
// ============================================================

import Papa from 'papaparse';

export function parseCSV(text) {
  // Detectar separador
  const firstLine = text.split('\n')[0];
  const delim = firstLine.includes(';') ? ';' : ',';

  const parsed = Papa.parse(text, {
    header: true,
    delimiter: delim,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_')
  });

  if (parsed.errors.length > 0) {
    const sample = parsed.errors.slice(0, 3).map(e => e.message).join('; ');
    throw new Error(`Error parseando CSV: ${sample}`);
  }

  const rows = parsed.data;
  if (rows.length === 0) throw new Error('CSV vacío');

  // Buscar columnas. Yahoo usa: date, open, high, low, close, adj_close, volume
  const sample = rows[0];
  const keys = Object.keys(sample);
  const dateKey = keys.find(k => /^date|fecha/.test(k));
  const openKey = keys.find(k => /^open|apertura/.test(k));
  const highKey = keys.find(k => /^high|maximo|máximo|alto/.test(k));
  const lowKey = keys.find(k => /^low|minimo|mínimo|bajo/.test(k));
  const closeKey = keys.find(k => /^adj_close|adjusted/.test(k)) ||
                   keys.find(k => /^close|cierre/.test(k));
  const volKey = keys.find(k => /^volume|volumen/.test(k));

  if (!dateKey || !closeKey) {
    throw new Error(`No se encontraron columnas date/close. Columnas: ${keys.join(', ')}`);
  }

  const bars = rows
    .map((r, i) => ({
      date: r[dateKey],
      open: parseFloat(r[openKey] ?? r[closeKey]),
      high: parseFloat(r[highKey] ?? r[closeKey]),
      low: parseFloat(r[lowKey] ?? r[closeKey]),
      close: parseFloat(r[closeKey]),
      volume: parseInt(r[volKey] ?? '0', 10) || 0,
      i,
    }))
    .filter(b => !isNaN(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b, i) => ({ ...b, i }));

  if (bars.length < 30) {
    throw new Error(`Muy pocos datos (${bars.length} filas). Necesitas al menos 30.`);
  }

  return bars;
}
