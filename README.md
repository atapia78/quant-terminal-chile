# Quant Terminal — Bolsa de Santiago

Análisis cuantitativo de acciones del IPSA con **proyecciones probabilísticas honestas** y **datos live de Yahoo Finance** vía serverless functions.

En vez de pretender que las líneas técnicas predicen el futuro, te muestra distribuciones de outcomes posibles bajo supuestos explícitos (GBM + Monte Carlo + GARCH + benchmark naive).

---

## Filosofía

La mayoría de las apps de retail venden humo: extienden RSIs en gráficos hacia el futuro, presentan ML opacos como "predicciones", o esconden la incertidumbre detrás de líneas confiadas.

Acá no.

- **No hay forecasts puntuales** ("el precio va a estar en X"). Solo **distribuciones probabilísticas**.
- **El benchmark naive (μ=0)** se muestra al lado de la proyección con drift histórico, para que veas cuánto del cono viene de "tendencia" vs ruido puro.
- **GARCH(1,1)** se ajusta por MLE — vol futura mean-reverts hacia la varianza incondicional.
- **VaR/CVaR históricos**, no paramétricos. Con kurtosis alta los normales mienten.
- **Data automática**: la app baja precios reales de Yahoo Finance vía un proxy serverless. Sin paste manual de CSVs.

## Stack

- React 18 + Vite (frontend)
- Vercel Serverless Functions (proxy a Yahoo Finance)
- Recharts (visualización)
- PapaParse (import CSV opcional)
- Cero base de datos, ~$0 de hosting

## Arquitectura de datos

```
┌─────────────────┐    1. fetch /api/quotes?symbol=COPEC.SN
│   Tu browser    │ ─────────────────────────┐
│   (React app)   │                          ▼
└─────────────────┘                ┌─────────────────────┐
        ▲                          │  Vercel Serverless  │
        │                          │   /api/quotes.js    │
        │ 4. JSON con OHLCV        └─────────────────────┘
        │                                     │
        │                          2. fetch query1.finance.yahoo.com
        │                                     ▼
        │                          ┌─────────────────────┐
        └──────────────────────────│   Yahoo Finance     │
                                   │  (sin CORS issues)  │
                                   └─────────────────────┘
                                        3. JSON OHLCV
```

**Por qué necesitamos el proxy**: Yahoo Finance no permite peticiones directas desde browsers (CORS bloqueado). El serverless corre en backend, así que no tiene esa limitación. Y como vive en el mismo dominio que tu app, tu browser sí puede llamarlo.

**Cache**: 15 minutos vía Vercel Edge. Suficiente para análisis cuantitativo y mantiene los costos en $0.

## Instalación y desarrollo

```bash
git clone https://github.com/atapia78/quant-terminal-chile.git
cd quant-terminal-chile
npm install
```

### Opción A: Dev solo frontend (sin live data)
```bash
npm run dev          # http://localhost:5173
```
La app funciona, pero el botón **↻ LIVE** fallará porque `/api/quotes` no está corriendo. Verás la data sintética del bundle.

### Opción B: Dev con backend (recomendado)
```bash
npm install -g vercel
vercel login
npm run dev:full     # ejecuta `vercel dev` → frontend + serverless juntos
```

Esto corre Vite Y la función serverless en paralelo. Ahora **↻ LIVE** baja data real de Yahoo.

### Build de producción
```bash
npm run build        # output a /dist
npm run preview      # sirve el build localmente
```

## Deploy

### Vercel (recomendado, gratis, automático)
```bash
npm run deploy       # equivale a `vercel --prod`
```

O sin script: `vercel`. La primera vez te pide login y nombre del proyecto. Detecta Vite + /api/ automáticamente. En ~2 minutos tienes una URL `https://quant-terminal-chile-xxx.vercel.app`.

### Netlify (alternativa)
Funciones serverless tienen sintaxis distinta. Crea `netlify/functions/quotes.js` adaptando el handler de `api/quotes.js`:
```js
exports.handler = async (event) => {
  const { symbol, range } = event.queryStringParameters;
  // ... mismo código ...
  return { statusCode: 200, body: JSON.stringify(data) };
};
```

### GitHub Pages
**No funciona con live data** porque GitHub Pages es estático puro (no soporta serverless functions). Pero funciona perfecto si te conformas con bundle + import CSV manual.

## Acciones incluidas

7 acciones del IPSA con bundle sintético inicial. Click en **↻ LIVE** baja la data real desde Yahoo Finance.

| Nemo | Empresa | Sector | Yahoo Ticker |
|---|---|---|---|
| `COPEC` | Empresas Copec | Energía · Forestal | `COPEC.SN` |
| `SQM-B` | Soc. Química y Minera | Litio · Especialidades | `SQM-B.SN` |
| `CHILE` | Banco de Chile | Financiero · Banca | `CHILE.SN` |
| `FALABELLA` | Falabella | Consumo · Retail | `FALABELLA.SN` |
| `ENELCHILE` | Enel Chile | Utility · Eléctrica | `ENELCHILE.SN` |
| `LTM` | LATAM Airlines | Transporte | `LTM.SN` |
| `CMPC` | Empresas CMPC | Forestal · Celulosa | `CMPC.SN` |

Otros tickers del IPSA con sufijo `.SN`: `BCI.SN`, `BSANTANDER.SN`, `CENCOSUD.SN`, `COLBUN.SN`, `ENTEL.SN`, `MALLPLAZA.SN`, `ANDINA-B.SN`, `CCU.SN`, `CONCHATORO.SN`, `PARAUCO.SN`, `RIPLEY.SN`, `AGUAS-A.SN`, `IAM.SN`, `ILC.SN`, `ITAUCL.SN`, `SONDA.SN`, `SMU.SN`. Para añadir una al bundle: edita `src/data/ipsaBundle.js` y `YAHOO_SYMBOL_MAP` en `src/lib/useYahooQuotes.js`.

Índice IPSA mismo: `^IPSA`.

## API: `/api/quotes`

Proxy a Yahoo Finance. Devuelve OHLCV normalizado.

**Query params:**
- `symbol` (required): ej. `COPEC.SN`, `^IPSA`
- `range` (default `2y`): `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `max`
- `interval` (default `1d`): `1d`, `1wk`

**Ejemplo:**
```bash
curl 'https://tu-app.vercel.app/api/quotes?symbol=COPEC.SN&range=2y'
```

**Respuesta:**
```json
{
  "symbol": "COPEC.SN",
  "currency": "CLP",
  "exchange": "Santiago",
  "bars": [
    { "date": "2024-05-12", "open": 5800, "high": 5850, "low": 5780, "close": 5820, "volume": 1234567, "i": 0 },
    ...
  ],
  "fetchedAt": "2026-05-12T13:45:00.000Z",
  "source": "yahoo-finance"
}
```

## Metodología cuantitativa

### Indicadores técnicos
- **SMA / EMA**: medias móviles simple y exponencial
- **RSI(14)**: con suavizamiento de Wilder (no SMA, que es la versión incorrecta común)
- **MACD(12/26/9)**: línea, signal, histograma
- **Bandas de Bollinger**: SMA20 ± 2σ
- **ATR(14)**: rango verdadero promedio con suavizamiento de Wilder

### Estadísticas
- **Retorno anualizado**: μ_daily × 252
- **Volatilidad anualizada**: σ_daily × √252
- **Sharpe**: (R_a - rf) / σ_a, con rf = 4%
- **Sortino**: como Sharpe pero solo penaliza desviación negativa
- **Calmar**: R_a / |MaxDD|
- **Max Drawdown**: peak-to-trough en la serie de precios
- **VaR 95% histórico**: percentil 5 de retornos diarios
- **CVaR 95%**: media de retornos en el peor 5%
- **Skewness / Kurtosis**: momentos 3° y 4° (kurtosis en exceso, normal = 0)

### Proyecciones probabilísticas

#### Monte Carlo (GBM)
Simula N caminos del Geometric Brownian Motion con μ y σ históricos:

```
S(t+dt) = S(t) · exp((μ - σ²/2)·dt + σ·√dt · Z),   Z ~ N(0,1)
```

Después extrae percentiles por día.

#### Cono closed-form
Bajo GBM, `log(S_T/S_0) ~ N((μ - σ²/2)·T, σ²·T)`. Percentiles directos:

```
S_T,p = S_0 · exp((μ - σ²/2)·T + σ·√T · z_p)
```

Más rápido y suave que Monte Carlo. Ambos deben coincidir — es la misma matemática por dos caminos.

#### GARCH(1,1)
```
σ²_t = ω + α·r²_{t-1} + β·σ²_{t-1}
```

Ajustado por MLE (coordinate descent). Forecast h-step ahead:

```
σ²_{t+h} = σ²_∞ + (α+β)^(h-1) · (σ²_{t+1} - σ²_∞)
```

donde `σ²_∞ = ω / (1 - α - β)` es la varianza incondicional.

**Útil porque**: la vol ES predecible (vol clustering bien documentado). Los retornos no.

#### EWMA (RiskMetrics, λ=0.94)
Caso especial de IGARCH:
```
σ²_t = (1-λ)·r²_{t-1} + λ·σ²_{t-1}
```

Usado por JPM RiskMetrics. Stays flat forward (no mean reverts).

#### Benchmark naive (μ=0)
Mismo cono closed-form pero con `μ=0` (random walk puro). **Si las líneas naive (rojas punteadas) cubren la misma área que las doradas, la "tendencia" no aporta información — todo es ruido**.

### Position sizing
```
position_size = (account × risk_pct) / (ATR × atr_multiplier)
```

## Roadmap

- [x] Indicadores técnicos + estadísticas
- [x] Proyecciones probabilísticas (MC + GBM + GARCH + EWMA + naive)
- [x] **Data automática de Yahoo Finance vía serverless**
- [x] Import CSV (fallback / data custom)
- [x] Position sizing
- [x] Rule-based quant summary
- [x] **Taller MDF (Sesión 2):** CAGR / media geométrica + drag por volatilidad; vista "Distribución de retornos" (mensual/anual, log/aritmético, ajuste Normal + IC68/95/99); estacionalidad mensual.
- [ ] Comparación entre tickers (correlación, beta)
- [ ] Análisis de portafolio (Markowitz, risk parity)
- [ ] Conversión CLP/USD automática (fetch del dólar observado)
- [ ] Backtest de estrategias técnicas
- [ ] Black-Scholes para opciones (cuando aplique al mercado CL)
- [ ] AI deep-dive opcional vía función serverless adicional

## Deuda técnica

- **Cono de proyección — drift geométrico: RESUELTO / no era un bug.** El cono se calibra con `mu = media(retornos simples)·252` (aritmético), pero `closedFormCone` ya aplica `drift = (mu − σ²/2)·T`, así que la línea central **p50 ya es la MEDIANA honesta de GBM** `S0·exp((μ − σ²/2)·T)`, no la media `S0·exp(μ·T)`. Verificado numéricamente (ej. SQM-B 126d: p50 = 9,65% = mediana honesta; el valor sin descontar sería 15,14%). Calibrar el drift con retornos log y pasarlo a `closedFormCone` **restaría σ²/2 dos veces** (mediana demasiado baja): NO hacerlo. El drag por volatilidad ya se ve en el panel de Estadísticas (CAGR vs aritmético).

## Limitaciones honestas

1. **GBM asume retornos log-normales** — la realidad tiene colas más gordas. El cono subestima eventos extremos. Por eso mostramos VaR/CVaR históricos.
2. **μ y σ son históricos** — proyectamos asumiendo que el pasado se repite. **No se repite.** Cambios de régimen (crisis, M&A, regulación) no son anticipados.
3. **No hay análisis fundamental** — la app no sabe nada de earnings, valoración, ni tesis sectorial. Es 100% cuantitativa sobre precios.
4. **Yahoo Finance no es oficial** — la API que usamos (`query1.finance.yahoo.com`) es no documentada. Funciona consistentemente desde hace años, pero podría cambiar.
5. **Rate limits**: el cache de 15 min protege contra abuso, pero si haces muchísimos refreshes en serie de muchos símbolos podrías ver 429 de Yahoo.

## Licencia

MIT — usa, modifica, distribuye libremente.

## Disclaimer

Esta herramienta es para **análisis cuantitativo y educacional**. No constituye recomendación de inversión, asesoría financiera, ni consejo legal. Los modelos descritos tienen supuestos (GBM, estacionariedad de μ y σ, retornos i.i.d.) que **no se cumplen en mercados reales**. Cualquier decisión de inversión es responsabilidad exclusiva del usuario.

Los autores no se hacen responsables por pérdidas derivadas del uso de esta herramienta.
