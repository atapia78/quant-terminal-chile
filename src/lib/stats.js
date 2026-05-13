// ============================================================
// ESTADÍSTICAS DE RETORNOS
// Sharpe, Sortino, Calmar, VaR/CVaR históricos, momentos
// ============================================================

const TD = 252;

export function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    r.push(closes[i] / closes[i - 1] - 1);
  }
  return r;
}

export function computeStats(closes, rf = 0.04) {
  const r = dailyReturns(closes);
  const n = r.length;
  if (n < 2) return null;

  const mean = r.reduce((a, b) => a + b, 0) / n;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  const annReturn = mean * TD;
  const annVol = std * Math.sqrt(TD);
  const sharpe = annVol > 0 ? (annReturn - rf) / annVol : NaN;

  // Sortino — downside deviation
  const downside = r.filter(x => x < 0);
  const downStd = Math.sqrt(
    downside.reduce((a, b) => a + b * b, 0) / n
  ) * Math.sqrt(TD);
  const sortino = downStd > 0 ? (annReturn - rf) / downStd : NaN;

  // Max drawdown
  let peak = closes[0], maxDD = 0;
  for (const p of closes) {
    if (p > peak) peak = p;
    const dd = (p - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  const calmar = maxDD < 0 ? -annReturn / maxDD : NaN;

  // VaR / CVaR históricos al 95%
  const sorted = [...r].sort((a, b) => a - b);
  const idx5 = Math.max(1, Math.floor(n * 0.05));
  const var95 = sorted[idx5];
  const tail = sorted.slice(0, idx5);
  const cvar95 = tail.reduce((a, b) => a + b, 0) / tail.length;

  // Momentos de orden superior
  const m3 = r.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const m4 = r.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const skew = m3 / std ** 3;
  const kurt = m4 / std ** 4 - 3; // exceso

  return {
    n, mean, std, annReturn, annVol,
    sharpe, sortino, calmar,
    maxDD, var95, cvar95,
    skew, kurt,
    returns: r,
  };
}

export function histogram(values, bins = 22) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = (max - min) / bins;
  const counts = Array(bins).fill(0);
  for (const v of values) {
    let i = Math.floor((v - min) / w);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    counts[i]++;
  }
  return counts.map((c, i) => ({
    center: min + i * w + w / 2,
    count: c,
    pct: (min + i * w + w / 2) * 100,
    fill: (min + i * w + w / 2) < 0 ? '#d97757' : '#82c5a4'
  }));
}
