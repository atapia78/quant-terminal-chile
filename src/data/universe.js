// ============================================================
// UNIVERSO MULTI-MERCADO — Chile (IPSA ~30) + EE.UU. (mega-caps)
//
// Cada ticker trae: símbolo Yahoo (yf), mercado (CL/US), moneda
// (CLP/USD), sector, y un BUNDLE SINTÉTICO de respaldo generado con
// RNG seedeado (calibrado a perfiles plausibles). El bundle es solo
// fallback honesto: el análisis serio usa data LIVE (botón ↻ LIVE).
//
// CL → sufijo .SN · US → sin sufijo · índice → ^IPSA
// ============================================================

const TD = 252;

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
    const volume = Math.floor(2_000_000 * (0.5 + rng()) * (1 + Math.abs(z) * 0.5 + Math.abs(jump) * 8));
    bars.push({ date: dates[i].toISOString().slice(0, 10), i, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

// ---------- Configs compactas: [symbol, name, sector, startPrice, mu, sigma] ----------
// CHILE (IPSA). yf = symbol + .SN
const CL = [
  ['COPEC', 'Empresas Copec', 'Energía · Forestal', 6200, 0.08, 0.24],
  ['SQM-B', 'Soc. Química y Minera B', 'Litio · Especialidades', 38000, -0.05, 0.46],
  ['CHILE', 'Banco de Chile', 'Financiero · Banca', 145, 0.12, 0.18],
  ['BSANTANDER', 'Banco Santander Chile', 'Financiero · Banca', 52, 0.10, 0.20],
  ['BCI', 'Banco de Crédito e Inversiones', 'Financiero · Banca', 30500, 0.10, 0.19],
  ['ITAUCL', 'Itaú Chile', 'Financiero · Banca', 12500, 0.07, 0.22],
  ['ENELCHILE', 'Enel Chile', 'Utility · Eléctrica', 78, 0.06, 0.20],
  ['ENELAM', 'Enel Américas', 'Utility · Eléctrica', 120, 0.07, 0.24],
  ['COLBUN', 'Colbún', 'Utility · Generación', 165, 0.09, 0.22],
  ['ECL', 'Engie Energía Chile', 'Utility · Generación', 900, 0.04, 0.27],
  ['AGUAS-A', 'Aguas Andinas A', 'Utility · Sanitaria', 290, 0.05, 0.15],
  ['CMPC', 'Empresas CMPC', 'Forestal · Celulosa', 1700, 0.08, 0.26],
  ['CAP', 'CAP', 'Minería · Acero', 6800, 0.02, 0.40],
  ['FALABELLA', 'Falabella', 'Consumo · Retail', 3200, -0.02, 0.31],
  ['CENCOSUD', 'Cencosud', 'Consumo · Retail', 1950, 0.06, 0.27],
  ['CENCOMALLS', 'Cencosud Shopping', 'Inmobiliario · Malls', 1550, 0.07, 0.22],
  ['MALLPLAZA', 'Mallplaza', 'Inmobiliario · Malls', 1650, 0.08, 0.24],
  ['PARAUCO', 'Parque Arauco', 'Inmobiliario · Malls', 1850, 0.07, 0.25],
  ['RIPLEY', 'Ripley Corp', 'Consumo · Retail', 380, 0.03, 0.38],
  ['SMU', 'SMU', 'Consumo · Supermercados', 175, 0.06, 0.28],
  ['CCU', 'CCU', 'Consumo · Bebidas', 6300, 0.04, 0.26],
  ['CONCHATORO', 'Viña Concha y Toro', 'Consumo · Vinos', 1250, 0.05, 0.24],
  ['ANDINA-B', 'Embotelladora Andina B', 'Consumo · Bebidas', 2650, 0.07, 0.21],
  ['ENTEL', 'Entel', 'Telecom', 3100, 0.05, 0.27],
  ['SONDA', 'Sonda', 'Tecnología · TI', 480, 0.04, 0.30],
  ['LTM', 'LATAM Airlines', 'Transporte · Aerolínea', 24, 0.18, 0.52],
  ['VAPORES', 'Cía. Sud Americana de Vapores', 'Transporte · Naviero', 62, 0.10, 0.45],
  ['QUINENCO', 'Quiñenco', 'Holding · Diversificado', 3400, 0.07, 0.23],
  ['SECURITY', 'Grupo Security', 'Financiero · Holding', 285, 0.06, 0.24],
  ['IAM', 'IAM (Inversiones Aguas Metropolitanas)', 'Utility · Sanitaria', 1050, 0.05, 0.17],
];

// EE.UU. (starter ~25 mega-caps). yf = symbol (sin sufijo)
const US = [
  ['AAPL', 'Apple', 'Tecnología · Hardware', 225, 0.14, 0.26],
  ['MSFT', 'Microsoft', 'Tecnología · Software', 440, 0.16, 0.25],
  ['NVDA', 'NVIDIA', 'Tecnología · Semis', 130, 0.35, 0.50],
  ['AMZN', 'Amazon', 'Consumo · E-commerce', 185, 0.15, 0.32],
  ['GOOGL', 'Alphabet A', 'Tecnología · Internet', 175, 0.13, 0.28],
  ['META', 'Meta Platforms', 'Tecnología · Internet', 560, 0.20, 0.36],
  ['TSLA', 'Tesla', 'Automotriz · EV', 250, 0.10, 0.55],
  ['BRK-B', 'Berkshire Hathaway B', 'Holding · Diversificado', 460, 0.11, 0.16],
  ['AVGO', 'Broadcom', 'Tecnología · Semis', 165, 0.22, 0.38],
  ['JPM', 'JPMorgan Chase', 'Financiero · Banca', 215, 0.12, 0.24],
  ['V', 'Visa', 'Financiero · Pagos', 280, 0.12, 0.22],
  ['MA', 'Mastercard', 'Financiero · Pagos', 480, 0.13, 0.23],
  ['UNH', 'UnitedHealth', 'Salud · Seguros', 580, 0.10, 0.27],
  ['JNJ', 'Johnson & Johnson', 'Salud · Farma', 155, 0.05, 0.16],
  ['XOM', 'Exxon Mobil', 'Energía · Petróleo', 115, 0.08, 0.25],
  ['WMT', 'Walmart', 'Consumo · Retail', 80, 0.12, 0.19],
  ['PG', 'Procter & Gamble', 'Consumo · Defensivo', 170, 0.07, 0.16],
  ['HD', 'Home Depot', 'Consumo · Retail', 400, 0.09, 0.24],
  ['COST', 'Costco', 'Consumo · Retail', 890, 0.14, 0.21],
  ['ORCL', 'Oracle', 'Tecnología · Software', 175, 0.18, 0.30],
  ['NFLX', 'Netflix', 'Comunicación · Streaming', 700, 0.18, 0.35],
  ['AMD', 'Advanced Micro Devices', 'Tecnología · Semis', 150, 0.15, 0.48],
  ['CRM', 'Salesforce', 'Tecnología · Software', 280, 0.12, 0.32],
  ['KO', 'Coca-Cola', 'Consumo · Bebidas', 70, 0.07, 0.15],
  ['PEP', 'PepsiCo', 'Consumo · Bebidas', 170, 0.06, 0.16],
];

function build(rows, market) {
  const moneda = market === 'US' ? 'USD' : 'CLP';
  return rows.map(([symbol, name, sector, startPrice, mu, sigma], idx) => {
    // jumps un poco más probables en perfiles muy volátiles
    const jumpProb = sigma > 0.42 ? 0.012 : 0.005;
    const seed = (market === 'US' ? 90000 : 10000) + idx * 137 + symbol.length;
    return {
      symbol, name, sector, market, currency: moneda,
      yf: market === 'US' ? symbol : `${symbol}.SN`,
      seed, startPrice, mu, sigma,
      bars: generateOHLCV({ seed, days: 252, startPrice, mu, sigma, jumpProb }),
    };
  });
}

export const UNIVERSE = [...build(CL, 'CL'), ...build(US, 'US')];

export const UNIVERSE_BY_SYMBOL = Object.fromEntries(UNIVERSE.map(t => [t.symbol, t]));

// Agrupado por mercado para selectores
export const MARKETS = [
  { key: 'CL', label: 'Chile (IPSA)', tickers: UNIVERSE.filter(t => t.market === 'CL') },
  { key: 'US', label: 'EE.UU. (mega-caps)', tickers: UNIVERSE.filter(t => t.market === 'US') },
];

// Símbolo Yahoo para un nemo (CL → .SN, US → directo)
export function yfSymbol(nemo) {
  return UNIVERSE_BY_SYMBOL[nemo]?.yf || `${nemo}.SN`;
}
