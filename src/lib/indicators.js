// ============================================================
// INDICADORES TÉCNICOS
// Implementaciones estándar — Wilder smoothing donde corresponde
// ============================================================

export function sma(arr, p) {
  const out = Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= p) s -= arr[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

export function ema(arr, p) {
  const out = Array(arr.length).fill(null);
  const k = 2 / (p + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (i === p - 1) {
      let s = 0;
      for (let j = 0; j < p; j++) s += arr[j];
      prev = s / p;
      out[i] = prev;
    } else if (i >= p) {
      prev = arr[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

// RSI con suavizamiento de Wilder (estándar)
export function rsi(closes, p = 14) {
  const out = Array(closes.length).fill(null);
  if (closes.length < p + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  let aG = g / p, aL = l / p;
  out[p] = aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    aG = (aG * (p - 1) + (d > 0 ? d : 0)) / p;
    aL = (aL * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const eF = ema(closes, fast);
  const eS = ema(closes, slow);
  const line = closes.map((_, i) =>
    eF[i] != null && eS[i] != null ? eF[i] - eS[i] : null
  );
  const start = line.findIndex(v => v != null);
  const valid = line.filter(v => v != null);
  const sigValid = ema(valid, sig);
  const signal = Array(closes.length).fill(null);
  sigValid.forEach((v, k) => {
    if (v != null) signal[start + k] = v;
  });
  const hist = line.map((m, i) =>
    m != null && signal[i] != null ? m - signal[i] : null
  );
  return { macd: line, signal, hist };
}

export function bollinger(closes, p = 20, k = 2) {
  const ma = sma(closes, p);
  const up = Array(closes.length).fill(null);
  const lo = Array(closes.length).fill(null);
  for (let i = p - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) {
      s += (closes[j] - ma[i]) ** 2;
    }
    const sd = Math.sqrt(s / p);
    up[i] = ma[i] + k * sd;
    lo[i] = ma[i] - k * sd;
  }
  return { ma, up, lo };
}

// ATR — Wilder smoothing
export function atr(bars, p = 14) {
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(
      b.high - b.low,
      Math.abs(b.high - pc),
      Math.abs(b.low - pc)
    );
  });
  const out = Array(bars.length).fill(null);
  if (bars.length < p) return out;
  let s = 0;
  for (let i = 0; i < p; i++) s += tr[i];
  out[p - 1] = s / p;
  for (let i = p; i < bars.length; i++) {
    out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  }
  return out;
}
