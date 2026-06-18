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
