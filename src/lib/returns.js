// ============================================================
// RETORNOS Y REMUESTREO — Taller de Análisis Financiero (MDF, Sesión 2)
//
// Funciones puras de solo lectura sobre la serie de cierres diarios ya
// cargada (bundle / live / CSV). No mutan nada. Complementan stats.js
// (dailyReturns, computeStats, histogram) con:
//   · CAGR (retorno geométrico anualizado)
//   · remuestreo a fin de mes / fin de año
//   · retornos log y aritméticos
//   · ajuste Normal + intervalos de confianza (regla empírica)
//   · estacionalidad por mes calendario
// ============================================================

// Último cierre por período (clave derivada de la fecha YYYY-MM-DD).
// Preserva el orden cronológico de aparición de cada período.
function lastCloseByPeriod(bars, keyOf) {
  const map = new Map();
  for (const b of bars) {
    if (b.close == null || !b.date) continue;
    map.set(keyOf(b.date), { period: keyOf(b.date), date: b.date, close: b.close });
  }
  return [...map.values()];
}

// Remuestreo a fin de mes: clave YYYY-MM (último cierre disponible del mes).
export function resampleMonthly(bars) {
  return lastCloseByPeriod(bars, d => d.slice(0, 7));
}

// Remuestreo a fin de año: clave YYYY (último cierre disponible del año).
export function resampleAnnual(bars) {
  return lastCloseByPeriod(bars, d => d.slice(0, 4));
}

// Retornos de una serie de cierres.
//   mode='log'   → r = ln(P_t / P_{t-1})
//   mode='arith' → r = P_t / P_{t-1} − 1
// Devuelve [{ period, r }] alineado al período de cierre P_t.
export function periodReturns(periods, mode = 'log') {
  const out = [];
  for (let i = 1; i < periods.length; i++) {
    const a = periods[i - 1].close, b = periods[i].close;
    if (a > 0 && b > 0) {
      const r = mode === 'arith' ? (b / a - 1) : Math.log(b / a);
      out.push({ period: periods[i].period, date: periods[i].date, r });
    }
  }
  return out;
}

// CAGR = (P_final / P_inicial)^(1/años) − 1, años = (Δfecha)/365.25.
// Sobre la serie diaria cargada. Devuelve { cagr, years } o null.
export function computeCAGR(bars) {
  if (!bars || bars.length < 2) return null;
  const first = bars[0], last = bars[bars.length - 1];
  if (!(first.close > 0) || !(last.close > 0)) return null;
  const ms = new Date(last.date) - new Date(first.date);
  const years = ms / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return null;
  return { cagr: Math.pow(last.close / first.close, 1 / years) - 1, years };
}

// Ajuste Normal: μ = media, σ = desviación estándar muestral (n−1).
export function normalFit(values) {
  const n = values.length;
  if (n < 2) return null;
  const mu = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1);
  return { mu, sigma: Math.sqrt(variance), n };
}

// Densidad Normal (para superponer la curva sobre el histograma).
export function normalPdf(x, mu, sigma) {
  if (sigma <= 0) return 0;
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
}

// Intervalos de confianza por regla empírica (Normal).
export function empiricalCIs(mu, sigma) {
  return [
    { label: 'IC68', k: 1, lo: mu - sigma, hi: mu + sigma, p: '68,26%' },
    { label: 'IC95', k: 2, lo: mu - 2 * sigma, hi: mu + 2 * sigma, p: '95,44%' },
    { label: 'IC99', k: 3, lo: mu - 3 * sigma, hi: mu + 3 * sigma, p: '99,74%' },
  ];
}

// Estacionalidad por mes calendario, desde retornos mensuales (aritméticos).
// Devuelve:
//   byMonth[1..12]: { month, mean, pctPositive, count }
//   bull/bear: mes con mayor/menor media
//   best/worst: retorno mensual individual máximo/mínimo con su período
export function monthlySeasonality(bars) {
  const monthly = periodReturns(resampleMonthly(bars), 'arith'); // [{period 'YYYY-MM', r}]
  const buckets = Array.from({ length: 12 }, () => ({ sum: 0, count: 0, pos: 0 }));
  let best = null, worst = null;
  for (const { period, r } of monthly) {
    const m = parseInt(period.slice(5, 7), 10) - 1; // 0..11
    if (m < 0 || m > 11) continue;
    buckets[m].sum += r;
    buckets[m].count += 1;
    if (r > 0) buckets[m].pos += 1;
    if (!best || r > best.r) best = { period, r };
    if (!worst || r < worst.r) worst = { period, r };
  }
  const byMonth = buckets.map((b, i) => ({
    month: i + 1,
    mean: b.count ? b.sum / b.count : null,
    pctPositive: b.count ? b.pos / b.count : null,
    count: b.count,
  }));
  const withData = byMonth.filter(m => m.count > 0);
  const bull = withData.length ? withData.reduce((a, b) => (b.mean > a.mean ? b : a)) : null;
  const bear = withData.length ? withData.reduce((a, b) => (b.mean < a.mean ? b : a)) : null;
  return { byMonth, bull, bear, best, worst, nMonths: monthly.length };
}

export const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
