// ============================================================
// BUNDLE DE ACCIONES IPSA
//
// IMPORTANTE: La data se GENERA al cargar la app con un RNG
// seedeado, calibrada a los perfiles típicos (vol/drift) de
// cada acción del IPSA. Es data sintética para que la app abra
// con algo realista en pantalla; los precios finales aproximan
// los reales al 2026 pero NO son datos verdaderos.
//
// Para análisis serio: pegar CSV de Yahoo Finance.
//   Yahoo ticker: COPEC.SN, SQM-B.SN, CHILE.SN, FALABELLA.SN,
//                 ENELCHILE.SN, LTM.SN, CMPC.SN
// ============================================================

const TD = 252;

// PRNG seedeado para determinismo
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function generateOHLCV({ seed, days, startPrice, mu, sigma, jumpProb = 0.005, jumpSize = 0.04 }) {
  const rng = mulberry32(seed);
  const bars = [];
  let price = startPrice;
  const dailyMu = mu / TD;
  const dailySigma = sigma / Math.sqrt(TD);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [];
  let d = new Date(today);
  while (dates.length < days) {
    if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  dates.reverse();

  for (let i = 0; i < days; i++) {
    const z = normal(rng);
    const jump = rng() < jumpProb ? (rng() < 0.5 ? -1 : 1) * jumpSize * (0.5 + rng()) : 0;
    const dlogP = dailyMu - 0.5 * dailySigma ** 2 + dailySigma * z + jump;
    const close = price * Math.exp(dlogP);
    const intra = dailySigma * 0.7;
    const open = price * (1 + (rng() - 0.5) * intra);
    const hl = Math.abs(z) * intra + 0.003;
    const high = Math.max(open, close) * (1 + rng() * hl);
    const low = Math.min(open, close) * (1 - rng() * hl);
    const baseVol = 2_500_000;
    const volume = Math.floor(baseVol * (0.5 + rng()) * (1 + Math.abs(z) * 0.5 + Math.abs(jump) * 8));
    bars.push({
      date: dates[i].toISOString().slice(0, 10),
      i, open, high, low, close, volume
    });
    price = close;
  }
  return bars;
}

// Configuración por acción — calibrada a perfiles reales del IPSA
// Precios objetivo aproximados a niveles de mayo 2026
const CONFIGS = [
  {
    symbol: 'COPEC',
    name: 'Empresas Copec',
    sector: 'Energía · Forestal',
    currency: 'CLP',
    seed: 101,
    startPrice: 5720,    // termina ~6200
    mu: 0.08,
    sigma: 0.24,
    note: 'Diversificado integrado. Holding con combustibles, forestal y pesca.'
  },
  {
    symbol: 'SQM-B',
    name: 'Soc. Química y Minera B',
    sector: 'Litio · Especialidades',
    currency: 'CLP',
    seed: 202,
    startPrice: 41000,
    mu: -0.05,
    sigma: 0.46,
    jumpProb: 0.015,
    jumpSize: 0.06,
    note: 'Productor de litio. Alta vol por precio del Li2CO3 global.'
  },
  {
    symbol: 'CHILE',
    name: 'Banco de Chile',
    sector: 'Financiero · Banca',
    currency: 'CLP',
    seed: 303,
    startPrice: 141,
    mu: 0.12,
    sigma: 0.18,
    note: 'Defensivo. Dividendos altos. Sensible a tasas BCCh.'
  },
  {
    symbol: 'FALABELLA',
    name: 'Falabella',
    sector: 'Consumo · Retail',
    currency: 'CLP',
    seed: 404,
    startPrice: 5750,
    mu: -0.02,
    sigma: 0.31,
    note: 'Retail cíclico. Exposición a Chile, Perú, Colombia.'
  },
  {
    symbol: 'ENELCHILE',
    name: 'Enel Chile',
    sector: 'Utility · Eléctrica',
    currency: 'CLP',
    seed: 505,
    startPrice: 76,
    mu: 0.06,
    sigma: 0.20,
    note: 'Generadora y distribuidora. Negocio regulado, defensivo.'
  },
  {
    symbol: 'LTM',
    name: 'LATAM Airlines',
    sector: 'Transporte · Aerolínea',
    currency: 'CLP',
    seed: 606,
    startPrice: 19.3,
    mu: 0.18,
    sigma: 0.52,
    jumpProb: 0.012,
    jumpSize: 0.07,
    note: 'Aerolínea post-Ch11. Alta vol, expuesta a USD y combustible.'
  },
  {
    symbol: 'CMPC',
    name: 'Empresas CMPC',
    sector: 'Forestal · Celulosa',
    currency: 'CLP',
    seed: 707,
    startPrice: 1055,
    mu: 0.08,
    sigma: 0.26,
    note: 'Exportadora de celulosa. Precio de pulpa global, sensible a CLP/USD.'
  },
];

// Genera bundle completo al importar
export const IPSA_BUNDLE = CONFIGS.map(cfg => ({
  ...cfg,
  bars: generateOHLCV({ ...cfg, days: 252 })
}));

export const IPSA_BY_SYMBOL = Object.fromEntries(
  IPSA_BUNDLE.map(t => [t.symbol, t])
);
