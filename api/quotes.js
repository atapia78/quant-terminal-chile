// ============================================================
// /api/quotes — Serverless function (Vercel Node runtime)
//
// Proxy a Yahoo Finance para obtener histórico de acciones.
// Funciona como reverse proxy: tu browser pide /api/quotes,
// Vercel ejecuta esta función que llama a Yahoo y retorna JSON.
// No hay CORS porque la llamada del browser es al mismo dominio.
//
// Cache: 15 minutos vía Vercel Edge Cache (s-maxage).
//
// Uso desde el frontend:
//   fetch('/api/quotes?symbol=COPEC.SN&range=2y')
//
// Rangos válidos: 1mo, 3mo, 6mo, 1y, 2y, 5y, max
// Intervalos: 1d (diario)
// ============================================================

export default async function handler(req, res) {
  const symbol = (req.query.symbol || '').trim();
  const range = req.query.range || '2y';
  const interval = req.query.interval || '1d';

  // Validación básica para evitar SSRF / injection ('=' permite pares FX como USDCLP=X)
  if (!symbol || !/^[A-Z0-9\-\.\^=]{1,16}$/i.test(symbol)) {
    return res.status(400).json({ error: 'Símbolo inválido' });
  }
  if (!/^(1mo|3mo|6mo|1y|2y|5y|10y|max)$/.test(range)) {
    return res.status(400).json({ error: 'Rango inválido' });
  }
  if (interval !== '1d' && interval !== '1wk') {
    return res.status(400).json({ error: 'Intervalo inválido' });
  }

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;

  try {
    const upstream = await fetch(yahooUrl, {
      headers: {
        // Yahoo bloquea sin user-agent
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Yahoo Finance respondió ${upstream.status}`,
        symbol,
      });
    }

    const json = await upstream.json();
    const result = json?.chart?.result?.[0];
    if (!result || !result.timestamp) {
      return res.status(404).json({ error: 'No hay data para ' + symbol });
    }

    const timestamps = result.timestamp;
    const ohlc = result.indicators?.quote?.[0] || {};
    const adj = result.indicators?.adjclose?.[0]?.adjclose || [];

    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = adj[i] ?? ohlc.close?.[i];
      if (close == null || isNaN(close)) continue;
      bars.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        open: ohlc.open?.[i] ?? close,
        high: ohlc.high?.[i] ?? close,
        low: ohlc.low?.[i] ?? close,
        close,
        volume: ohlc.volume?.[i] ?? 0,
      });
    }

    // Re-indexar
    bars.forEach((b, i) => { b.i = i; });

    if (bars.length < 30) {
      return res.status(404).json({ error: `Solo ${bars.length} barras válidas para ${symbol}` });
    }

    // Cache 15 min en Vercel Edge, revalida 1h
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).json({
      symbol,
      currency: result.meta?.currency || 'CLP',
      exchange: result.meta?.exchangeName || 'SGO',
      bars,
      fetchedAt: new Date().toISOString(),
      source: 'yahoo-finance',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Fetch error: ' + err.message });
  }
}
