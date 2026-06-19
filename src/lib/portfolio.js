// ============================================================
// MI PORTAFOLIO — modelo de datos (localStorage) + ranking proyectado
//
// Filosofía: Alex registra sus posiciones reales y las compara
// contra candidatos por RETORNO PROYECTADO (no rendimiento pasado).
// La comparación es honesta: distribución + cono + benchmark naive.
// La decisión de rotar es de Alex.
//
// REUSA el motor existente (projections.js). No hay modelo nuevo:
// solo se consumen sus salidas (cono closed-form GBM + naive).
// ============================================================

import { closedFormCone, probAbove } from './projections.js';
import { dailyReturns } from './stats.js';
import { resampleMonthly, periodReturns } from './returns.js';

const STORAGE_KEY = 'qtc.portfolio.v1';
const TD = 252;

// Posición sembrada por defecto: la posición actual de Alex (LTM).
// cantidad editable; costoPromedio opcional.
const SEED = [
  { ticker: 'LTM', mercado: 'CL', moneda: 'CLP', cantidad: 1000, costoPromedio: null },
];

// Horizontes seleccionables (días de trading)
export const HORIZONS = [
  { label: '1m', days: 21 },
  { label: '3m', days: 63 },
  { label: '6m', days: 126 },
  { label: '1y', days: 252 },
];

// ---------- Persistencia ----------
export function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      savePortfolio(SEED);
      return SEED.map(p => ({ ...p }));
    }
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return SEED.map(p => ({ ...p }));
    return arr;
  } catch {
    return SEED.map(p => ({ ...p }));
  }
}

export function savePortfolio(positions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    /* storage no disponible: no rompemos la app */
  }
}

// ---------- Proyección por ticker (reusa projections.js) ----------
// Calibra μ y σ anualizados desde los retornos históricos disponibles
// (misma calibración que ProjectionsPanel) y devuelve las salidas del
// cono closed-form GBM a horizonte H, más el benchmark naive (μ=0).
export function projectTicker(bars, horizonDays) {
  if (!bars || bars.length < 30) return null;
  const closes = bars.map(b => b.close);
  const S0 = closes[closes.length - 1];
  const returns = dailyReturns(closes);
  if (returns.length < 2) return null;

  const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varR = returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1);
  const mu = meanR * TD;
  const sigma = Math.sqrt(varR) * Math.sqrt(TD);

  const pct = [10, 50, 90];
  const cone = closedFormCone({ S0, mu, sigma, days: horizonDays, percentiles: pct });
  const end = cone[cone.length - 1];
  const naive = closedFormCone({ S0, mu: 0, sigma, days: horizonDays, percentiles: pct });
  const naiveEnd = naive[naive.length - 1];

  const medianReturn = end.p50 / S0 - 1;
  const p10Return = end.p10 / S0 - 1;
  const p90Return = end.p90 / S0 - 1;
  const bandWidth = (end.p90 - end.p10) / S0; // amplitud P10–P90 como fracción
  const probPositive = probAbove({ S0, mu, sigma, days: horizonDays, target: S0 });
  const naiveMedianReturn = naiveEnd.p50 / S0 - 1;

  // Métrica ajustada por riesgo: retorno mediano ÷ amplitud de la banda P10–P90
  // (info-ratio proyectado; penaliza la incertidumbre del cono).
  const riskAdj = bandWidth > 0 ? medianReturn / bandWidth : 0;
  const projVol = sigma * Math.sqrt(horizonDays / TD);

  // ¿El modelo le gana al naive? (retorno mediano materialmente sobre el naive)
  const beatsNaive = medianReturn - naiveMedianReturn > 0.005;

  return {
    S0, mu, sigma, projVol,
    medianReturn, p10Return, p90Return, bandWidth,
    p10: end.p10, p50: end.p50, p90: end.p90,
    probPositive,
    naiveMedianReturn,
    naiveP10: naiveEnd.p10, naiveP90: naiveEnd.p90,
    riskAdj, beatsNaive,
  };
}

// ---------- Veredicto por acción ----------
// Umbrales documentados y ajustables. Combinan tres señales del cono GBM:
//   · retorno mediano proyectado > 0
//   · que el modelo le gane al benchmark naive (μ=0) → la "señal" no es ruido
//   · P(retorno > 0) al horizonte
//   · métrica ajustada por riesgo (retorno mediano ÷ amplitud banda P10–P90)
export const VERDICT_THRESHOLDS = {
  atractivo: { prob: 0.55, riskAdj: 0.40 }, // Atractivo: supera estos + gana al naive + retorno>0
  debil:     { prob: 0.45 },                // Débil: bajo este P(>0), o pierde con naive, o retorno<=0
};

// ============================================================
// RIESGO DE CARTERA (Markowitz) — ver docs/metodologia-mdf.md
// ============================================================
const MPY = 12; // meses por año (anualización de retornos mensuales)

// Retornos mensuales log indexados por mes 'YYYY-MM'.
function monthlyLogByMonth(bars) {
  const map = new Map();
  for (const x of periodReturns(resampleMonthly(bars || []), 'log')) map.set(x.period, x.r);
  return map;
}

// Alinea por meses comunes (intersección) los retornos mensuales de varios papeles.
// entries: [{ symbol, bars }]. Excluye los que no tienen historia suficiente.
export function alignMonthlyReturns(entries, minMonths = 2) {
  const maps = entries.map(e => ({ symbol: e.symbol, map: monthlyLogByMonth(e.bars) }));
  const usable = maps.filter(m => m.map.size >= minMonths);
  const excluded = maps.filter(m => m.map.size < minMonths).map(m => m.symbol);
  if (usable.length === 0) return { symbols: [], months: [], series: {}, excluded };
  let common = null;
  for (const m of usable) {
    const keys = new Set(m.map.keys());
    common = common ? new Set([...common].filter(k => keys.has(k))) : keys;
  }
  const months = [...common].sort();
  const series = {};
  for (const m of usable) series[m.symbol] = months.map(k => m.map.get(k));
  return { symbols: usable.map(m => m.symbol), months, series, excluded };
}

// Matriz de varianza-covarianza muestral (s_xy = Σ(x−x̄)(y−ȳ)/(n−1)) MENSUAL.
export function covarianceMatrix(series, symbols) {
  const n = symbols.length ? series[symbols[0]].length : 0;
  const means = {};
  symbols.forEach(s => { means[s] = series[s].reduce((a, b) => a + b, 0) / n; });
  const cov = symbols.map(si => symbols.map(sj => {
    let s = 0;
    for (let t = 0; t < n; t++) s += (series[si][t] - means[si]) * (series[sj][t] - means[sj]);
    return n > 1 ? s / (n - 1) : 0;
  }));
  return { cov, means, n };
}

// Riesgo/retorno de cartera anualizados + correlación + beneficio de diversificación.
// weights alineado al orden de symbols (debe sumar ~1).
export function portfolioRisk({ symbols, series, weights }) {
  const { cov, means, n } = covarianceMatrix(series, symbols);
  const k = symbols.length;
  // varianza mensual de cartera wᵀΩw
  let varM = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) varM += weights[i] * weights[j] * cov[i][j];
  const sigmaP = Math.sqrt(Math.max(0, varM)) * Math.sqrt(MPY);          // anualizada
  const sigmaInd = symbols.map((_, i) => Math.sqrt(Math.max(0, cov[i][i])) * Math.sqrt(MPY));
  const weightedSumVol = symbols.reduce((a, _, i) => a + weights[i] * sigmaInd[i], 0); // Σ wᵢσᵢ
  const retP = symbols.reduce((a, sym, i) => a + weights[i] * means[sym], 0) * MPY;
  // matriz de correlación
  const corr = symbols.map((_, i) => symbols.map((__, j) => {
    const d = Math.sqrt(cov[i][i] * cov[j][j]);
    return d > 0 ? cov[i][j] / d : (i === j ? 1 : 0);
  }));
  return { sigmaP, sigmaInd, weightedSumVol, retP, corr, n, diversification: weightedSumVol - sigmaP };
}

// ============================================================
// TIR money-weighted (XIRR) — ver docs/metodologia-mdf.md
// flows: [{ t (años, Actual/365), cf (con signo) }]
// ============================================================
export function xirr(flows) {
  if (!flows || flows.length < 2) return null;
  const npv = (r) => flows.reduce((s, f) => s + f.cf / Math.pow(1 + r, f.t), 0);
  const dnpv = (r) => flows.reduce((s, f) => s + (-f.t * f.cf) / Math.pow(1 + r, f.t + 1), 0);

  // Newton desde r=0.1
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r), d = dnpv(r);
    if (!isFinite(v) || !isFinite(d) || d === 0) break;
    const rn = r - v / d;
    if (!isFinite(rn)) break;
    if (Math.abs(rn - r) < 1e-7) { if (rn > -0.9999) return rn; break; }
    r = rn;
    if (r <= -0.9999) break;
  }
  // Bisección en [-0.9999, 10] si hay cambio de signo
  let lo = -0.9999, hi = 10;
  const flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  let a = lo, b = hi, fa = flo;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2, fm = npv(mid);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7 || (b - a) < 1e-9) return mid;
    if (fa * fm < 0) b = mid; else { a = mid; fa = fm; }
  }
  return (a + b) / 2;
}

// CAGR time-weighted del activo entre date0 y el último cierre de la serie.
// Toma el close más cercano a date0. (Pasar bars ya acotada por discontinuidad.)
export function cagrBetween(bars, date0) {
  if (!bars || bars.length < 2 || !date0) return null;
  const t0 = new Date(date0).getTime();
  let best = null, bestDiff = Infinity;
  for (const b of bars) {
    const diff = Math.abs(new Date(b.date).getTime() - t0);
    if (diff < bestDiff) { bestDiff = diff; best = b; }
  }
  const last = bars[bars.length - 1];
  if (!best || !last) return null;
  const days = (new Date(last.date).getTime() - new Date(best.date).getTime()) / 864e5;
  if (days <= 0 || !(best.close > 0) || !(last.close > 0)) return null;
  return Math.pow(last.close / best.close, 365 / days) - 1;
}

export function rotationVerdict(p) {
  if (!p) return { label: '—', tone: 'neutral' };
  const { medianReturn, beatsNaive, probPositive, riskAdj } = p;
  if (medianReturn > 0 && beatsNaive
    && probPositive >= VERDICT_THRESHOLDS.atractivo.prob
    && riskAdj >= VERDICT_THRESHOLDS.atractivo.riskAdj) {
    return { label: 'Atractivo', tone: 'good' };
  }
  if (!beatsNaive || medianReturn <= 0 || probPositive < VERDICT_THRESHOLDS.debil.prob) {
    return { label: 'Débil', tone: 'weak' };
  }
  return { label: 'Neutral', tone: 'neutral' };
}
