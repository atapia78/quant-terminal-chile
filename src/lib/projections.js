// ============================================================
// PROYECCIONES PROBABILÍSTICAS
//
// Importante: estos métodos producen DISTRIBUCIONES de outcomes
// posibles, NO predicciones puntuales. La línea mediana NO es
// "lo que va a pasar"; es el centro de un fan chart bajo
// supuestos explícitos (estacionariedad de μ y σ).
//
// Métodos incluidos:
//   - Monte Carlo (GBM): N caminos simulados, percentiles
//   - Cono de confianza (closed-form GBM)
//   - EWMA λ=0.94 (RiskMetrics): vol condicional
//   - GARCH(1,1): forecast multi-step de vol con mean reversion
//   - Naive benchmark: mismo cono pero con μ=0 (random walk puro)
// ============================================================

const TD = 252;

// Box-Muller para normal estándar
function normal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Aproximación a la inversa de la CDF normal estándar
// Beasley-Springer-Moro (precisa hasta ~6 decimales)
function normInv(p) {
  if (p <= 0 || p >= 1) return 0;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572
  ];
  const c = [
    -7.784894002430293e-3, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783
  ];
  const d = [
    7.784695709041462e-3, 0.3224671290700398, 2.445134137142996,
    3.754408661907416
  ];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r, x;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
        ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    x = (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
        (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
         ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  return x;
}

// ============================================================
// MONTE CARLO — GBM
// ============================================================
export function monteCarloGBM({ S0, mu, sigma, days, paths = 1000 }) {
  const dt = 1 / TD;
  const drift = (mu - 0.5 * sigma * sigma) * dt;
  const vol = sigma * Math.sqrt(dt);

  const allPaths = [];
  for (let p = 0; p < paths; p++) {
    const path = [S0];
    let S = S0;
    for (let t = 1; t <= days; t++) {
      S = S * Math.exp(drift + vol * normal());
      path.push(S);
    }
    allPaths.push(path);
  }
  return allPaths;
}

// Extrae percentiles por día desde N caminos
export function pathsToPercentiles(paths, percentiles = [5, 25, 50, 75, 95]) {
  if (paths.length === 0) return [];
  const days = paths[0].length;
  const result = [];
  for (let t = 0; t < days; t++) {
    const slice = paths.map(p => p[t]).sort((a, b) => a - b);
    const row = { t };
    for (const p of percentiles) {
      const idx = Math.min(slice.length - 1, Math.floor((p / 100) * slice.length));
      row[`p${p}`] = slice[idx];
    }
    result.push(row);
  }
  return result;
}

// ============================================================
// CONO CLOSED-FORM (GBM analítico)
//
// Bajo GBM: log(S_T/S_0) ~ N((μ - σ²/2)·T, σ²·T)
// S_T,p = S_0 · exp((μ - σ²/2)·T + σ·√T · z_p)
//
// Mucho más rápido y suave que Monte Carlo.
// ============================================================
export function closedFormCone({ S0, mu, sigma, days, percentiles = [5, 25, 50, 75, 95] }) {
  const result = [];
  for (let t = 0; t <= days; t++) {
    const T = t / TD;
    // OJO: `mu` es el drift ARITMÉTICO (media de retornos simples·252). Acá ya se
    // descuenta σ²/2, así que el p50 (z=0) = S0·exp((μ−σ²/2)·T) es la MEDIANA de GBM
    // (no la media). NO pasar mu_log acá: restaría σ²/2 dos veces. Ver README · Deuda técnica.
    const drift = (mu - 0.5 * sigma * sigma) * T;
    const vol = sigma * Math.sqrt(T);
    const row = { t };
    for (const p of percentiles) {
      const z = normInv(p / 100);
      row[`p${p}`] = S0 * Math.exp(drift + vol * z);
    }
    result.push(row);
  }
  return result;
}

// ============================================================
// EWMA λ=0.94 — RiskMetrics
// σ²_t = (1-λ)·r²_{t-1} + λ·σ²_{t-1}
//
// Caso especial de IGARCH (Integrated GARCH).
// Forecast multi-step: vol futura = vol actual (no mean-reverts).
// ============================================================
export function ewmaVol(returns, lambda = 0.94) {
  const out = new Array(returns.length);
  const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
  let varT = returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / returns.length;
  out[0] = Math.sqrt(varT);
  for (let i = 1; i < returns.length; i++) {
    varT = (1 - lambda) * returns[i - 1] ** 2 + lambda * varT;
    out[i] = Math.sqrt(varT);
  }
  return out;
}

// ============================================================
// GARCH(1,1) — fit por MLE con coordinate descent simple
// σ²_t = ω + α·r²_{t-1} + β·σ²_{t-1}
//
// Restricciones: ω > 0, α ≥ 0, β ≥ 0, α + β < 1
// Long-run vol: σ²_∞ = ω / (1 - α - β)
// ============================================================
function garchLogLik(returns, omega, alpha, beta) {
  const variance = returns.reduce((a, b) => a + b * b, 0) / returns.length;
  let sigma2 = variance;
  let ll = 0;
  for (let i = 0; i < returns.length; i++) {
    if (sigma2 <= 0) return -Infinity;
    ll -= 0.5 * (Math.log(2 * Math.PI) + Math.log(sigma2) + returns[i] ** 2 / sigma2);
    sigma2 = omega + alpha * returns[i] ** 2 + beta * sigma2;
  }
  return ll;
}

export function garchFit(returns) {
  // Inicialización razonable
  let variance = returns.reduce((a, b) => a + b * b, 0) / returns.length;
  let omega = variance * 0.05;
  let alpha = 0.08;
  let beta = 0.90;

  let bestLL = garchLogLik(returns, omega, alpha, beta);
  // Coordinate descent con búsqueda grilla local
  for (let iter = 0; iter < 30; iter++) {
    let improved = false;
    const stepO = omega * 0.2;
    const stepA = 0.02;
    const stepB = 0.02;
    const candidates = [
      [omega + stepO, alpha, beta],
      [omega - stepO, alpha, beta],
      [omega, alpha + stepA, beta],
      [omega, alpha - stepA, beta],
      [omega, alpha, beta + stepB],
      [omega, alpha, beta - stepB],
      [omega, alpha + stepA, beta - stepB],
      [omega, alpha - stepA, beta + stepB],
    ];
    for (const [o, a, b] of candidates) {
      // Restricciones
      if (o <= 0 || a < 0 || b < 0 || a + b >= 0.999) continue;
      const ll = garchLogLik(returns, o, a, b);
      if (ll > bestLL) {
        omega = o; alpha = a; beta = b;
        bestLL = ll;
        improved = true;
      }
    }
    if (!improved) break;
  }
  const longRunVar = omega / (1 - alpha - beta);
  return { omega, alpha, beta, longRunVar, longRunVol: Math.sqrt(longRunVar) };
}

// Forecast multi-step de varianza condicional bajo GARCH(1,1)
// σ²_{t+h} = σ²_∞ + (α+β)^(h-1) · (σ²_{t+1} - σ²_∞)
export function garchForecast({ params, currentReturn, currentVar, horizon }) {
  const { omega, alpha, beta, longRunVar } = params;
  const out = [];
  // Un paso adelante
  let nextVar = omega + alpha * currentReturn ** 2 + beta * currentVar;
  out.push({ h: 1, variance: nextVar, vol: Math.sqrt(nextVar) });
  const persistence = alpha + beta;
  for (let h = 2; h <= horizon; h++) {
    const v = longRunVar + Math.pow(persistence, h - 1) * (nextVar - longRunVar);
    out.push({ h, variance: v, vol: Math.sqrt(v) });
  }
  return out;
}

// ============================================================
// BENCHMARK NAIVE — random walk con drift cero
// "¿Y si la 'tendencia' no existiera?"
// ============================================================
export function naiveCone({ S0, sigma, days, percentiles = [5, 95] }) {
  return closedFormCone({ S0, mu: 0, sigma, days, percentiles });
}

// ============================================================
// Probabilidad de exceder un precio target en T días (closed-form)
// ============================================================
export function probAbove({ S0, mu, sigma, days, target }) {
  const T = days / TD;
  // log(S_T) ~ N(log(S_0) + (μ - σ²/2)T, σ²T)
  const meanLog = Math.log(S0) + (mu - 0.5 * sigma * sigma) * T;
  const stdLog = sigma * Math.sqrt(T);
  const z = (Math.log(target) - meanLog) / stdLog;
  // P(S_T > target) = 1 - Φ(z) = Φ(-z)
  return normCdf(-z);
}

function normCdf(x) {
  // Aproximación Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}
