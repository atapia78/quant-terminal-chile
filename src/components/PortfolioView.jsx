import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { loadPortfolio, savePortfolio, projectTicker, rotationVerdict, alignMonthlyReturns, portfolioRisk, xirr, cagrBetween, HORIZONS } from '../lib/portfolio.js';
import { detectDiscontinuity } from '../lib/returns.js';
import { useYahooQuotes, yahooSymbolFor } from '../lib/useYahooQuotes.js';

// Formato de moneda: CLP chileno 2 decimales ($6.713,00) · USD 2 decimales ($185.42)
function fmtMoney(v, moneda) {
  if (v == null || isNaN(v)) return '—';
  return moneda === 'USD'
    ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$' + v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(x, withSign = true) {
  if (x == null || isNaN(x)) return '—';
  const s = (x * 100).toFixed(1) + '%';
  return withSign && x > 0 ? '+' + s : s;
}

export default function PortfolioView({ universe, bySymbol, liveData, onRefreshTicker, loading }) {
  const [positions, setPositions] = useState(() => loadPortfolio());
  const [horizonDays, setHorizonDays] = useState(126); // default 6m
  const [recalcNonce, setRecalcNonce] = useState(0);
  const [newTicker, setNewTicker] = useState(universe[0]?.symbol || '');
  const [newQty, setNewQty] = useState(100);
  const [liveMsg, setLiveMsg] = useState(null);
  const [rankMsg, setRankMsg] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [expandedTir, setExpandedTir] = useState(new Set());

  const persist = useCallback((next) => {
    setPositions(next);
    savePortfolio(next);
  }, []);

  // Barras disponibles: live si fue cargado, si no el bundle. Nunca dispara red.
  const getBars = useCallback((symbol) => {
    return liveData[symbol]?.bars || bySymbol[symbol]?.bars || null;
  }, [liveData, bySymbol]);
  const priceOf = useCallback((symbol) => {
    const bars = getBars(symbol);
    return bars && bars.length ? bars[bars.length - 1].close : null;
  }, [getBars]);
  const isLive = useCallback((symbol) => !!liveData[symbol], [liveData]);

  // Historia MÁXIMA por papel SOLO para el riesgo de cartera (Markowitz),
  // independiente de la ventana del gráfico. Instancia de fetch propia (no aborta
  // los fetches del resto), cacheada por símbolo. Secuencial con respiro anti-429.
  const { fetchSymbol: fetchMaxSymbol } = useYahooQuotes();
  const [maxBars, setMaxBars] = useState({});
  const reqRef = useRef(new Set());
  useEffect(() => {
    const syms = [...new Set(positions.map(p => p.ticker))].filter(s => !reqRef.current.has(s));
    if (syms.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const s of syms) {
        reqRef.current.add(s);
        try {
          const d = await fetchMaxSymbol(yahooSymbolFor(s), 'max');
          if (!cancelled && d && d.bars) setMaxBars(prev => ({ ...prev, [s]: d.bars }));
        } catch { /* sin data viva: cae al fallback corto */ }
        await new Promise(r => setTimeout(r, 350));
      }
    })();
    return () => { cancelled = true; };
  }, [positions, fetchMaxSymbol]);

  // ---------- CRUD posiciones ----------
  function updateField(idx, field, value) {
    const next = positions.map((p, i) => i === idx ? { ...p, [field]: value } : p);
    persist(next);
  }
  function removePosition(idx) {
    persist(positions.filter((_, i) => i !== idx));
  }
  function addPosition() {
    if (!newTicker) return;
    const u = bySymbol[newTicker];
    const moneda = u?.currency || 'CLP';
    const mercado = moneda === 'USD' ? 'US' : 'CL';
    const next = [...positions, {
      ticker: newTicker, mercado, moneda,
      cantidad: Number(newQty) || 0, costoPromedio: null,
    }];
    persist(next);
  }

  // ---------- Lotes / TIR (aditivo: campo opcional `lotes`) ----------
  function toggleTir(idx) {
    setExpandedTir(s => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }
  function addLote(idx) {
    updateField(idx, 'lotes', [...(positions[idx].lotes || []), { fecha: '', cantidad: 0, precio: 0 }]);
  }
  function updateLote(idx, li, field, value) {
    updateField(idx, 'lotes', (positions[idx].lotes || []).map((l, i) => i === li ? { ...l, [field]: value } : l));
  }
  function removeLote(idx, li) {
    updateField(idx, 'lotes', (positions[idx].lotes || []).filter((_, i) => i !== li));
  }

  // Actualiza precio vivo SOLO de las posiciones (son pocas). Secuencial con un
  // pequeño respiro entre llamadas para no gatillar rate-limits (429) de Yahoo,
  // y reporta cuántas quedaron en vivo y cuáles no.
  async function refreshPositionsLive() {
    const seen = new Set();
    const list = positions.filter(p => (seen.has(p.ticker) ? false : seen.add(p.ticker)));
    let ok = 0; const fail = [];
    setLiveMsg(`Cargando ${list.length}…`);
    for (const p of list) {
      const success = await onRefreshTicker(p.ticker);
      if (success) ok++; else fail.push(p.ticker);
      await new Promise(res => setTimeout(res, 350));
    }
    setLiveMsg(`${ok}/${list.length} en vivo${fail.length ? ` · sin data: ${fail.join(', ')}` : ''}`);
  }

  // Trae TODO el universo en vivo (acción manual explícita). Secuencial con respiro
  // anti-429; al terminar, el ranking ya corre con data real.
  async function refreshAllLive() {
    if (bulkLoading) return;
    setBulkLoading(true);
    let ok = 0; const fail = [];
    for (let i = 0; i < universe.length; i++) {
      const u = universe[i];
      setRankMsg(`Cargando ${i + 1}/${universe.length}…`);
      const success = await onRefreshTicker(u.symbol);
      if (success) ok++; else fail.push(u.symbol);
      await new Promise(res => setTimeout(res, 400));
    }
    setRankMsg(`${ok}/${universe.length} en vivo${fail.length ? ` · sin data (símbolo no válido en Yahoo o 429): ${fail.join(', ')}` : ''}`);
    setBulkLoading(false);
  }

  // ---------- Totales por moneda ----------
  const totalsByCurrency = useMemo(() => {
    const acc = {};
    for (const p of positions) {
      const price = priceOf(p.ticker);
      const mv = price != null ? price * p.cantidad : 0;
      const cost = p.costoPromedio != null ? p.costoPromedio * p.cantidad : null;
      if (!acc[p.moneda]) acc[p.moneda] = { mv: 0, cost: 0, hasCost: false };
      acc[p.moneda].mv += mv;
      if (cost != null) { acc[p.moneda].cost += cost; acc[p.moneda].hasCost = true; }
    }
    return acc;
  }, [positions, priceOf]);

  // ---------- Comparador de rotación (ranking proyectado) ----------
  // Calcula sobre la data DISPONIBLE (bundle + lo ya cargado con LIVE).
  // No dispara fetches masivos: recompute manual con "Recalcular" o al cambiar horizonte.
  const { ranking, excluded, basis } = useMemo(() => {
    const rows = universe.map(u => {
      const proj = projectTicker(getBars(u.symbol), horizonDays);
      return proj ? {
        symbol: u.symbol, name: u.name, moneda: u.currency || 'CLP',
        live: isLive(u.symbol), verdict: rotationVerdict(proj), ...proj,
      } : null;
    }).filter(Boolean);

    // HONESTIDAD: no mezclar bases de datos. Si hay AL MENOS un papel con data
    // viva, el ranking comparable se arma SOLO con los que tienen live (misma
    // base real); el resto queda excluido (no comparable) hasta refrescarlo.
    // Si nadie tiene live, se rankea todo el bundle pero marcado como ilustrativo.
    const anyLive = rows.some(r => r.live);
    const comparable = anyLive ? rows.filter(r => r.live) : rows;
    const rest = anyLive ? rows.filter(r => !r.live) : [];
    comparable.sort((a, b) => b.riskAdj - a.riskAdj);
    comparable.forEach((r, i) => { r.rank = i + 1; });
    return { ranking: comparable, excluded: rest, basis: anyLive ? 'live' : 'synthetic' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, horizonDays, liveData, recalcNonce]);

  // ---------- Riesgo de cartera (Markowitz) ----------
  const cartera = useMemo(() => {
    const seen = new Set();
    const uniq = positions.filter(p => (seen.has(p.ticker) ? false : seen.add(p.ticker)));
    // Serie de historia MÁXIMA por papel (si está); fallback a la ventana corta.
    // Guard de discontinuidad ANTES de la covarianza: acota a tramo continuo.
    const meta = {}; // symbol -> { live, cut }
    const entries = uniq.map(p => {
      const usingMax = !!maxBars[p.ticker];
      const raw = (usingMax ? maxBars[p.ticker] : getBars(p.ticker)) || [];
      const disc = detectDiscontinuity(raw);
      meta[p.ticker] = { live: usingMax, cut: disc.cutDate };
      return { symbol: p.ticker, bars: raw.slice(disc.startIndex || 0) };
    });
    const { symbols, months, series, excluded } = alignMonthlyReturns(entries);
    if (symbols.length === 0 || months.length < 2) {
      return { ok: false, symbols, excluded, n: months.length };
    }
    const mvBy = {}; let total = 0; let firstCur = null; let mixedCur = false; let anyBundle = false;
    for (const p of positions) {
      if (!symbols.includes(p.ticker)) continue;
      const price = priceOf(p.ticker);
      const mv = price != null ? price * p.cantidad : 0;
      mvBy[p.ticker] = (mvBy[p.ticker] || 0) + mv;
      total += mv;
      if (firstCur == null) firstCur = p.moneda; else if (p.moneda !== firstCur) mixedCur = true;
      if (!meta[p.ticker]?.live) anyBundle = true;
    }
    if (total <= 0) return { ok: false, symbols, excluded, n: months.length };
    const weights = symbols.map(s => (mvBy[s] || 0) / total);
    const risk = portfolioRisk({ symbols, series, weights });
    const cuts = symbols.filter(s => meta[s]?.cut).map(s => `${s} desde ${meta[s].cut}`);
    return { ok: true, symbols, weights, risk, excluded, n: months.length, mixedCur, anyBundle, cuts };
  }, [positions, getBars, priceOf, maxBars]);

  // TIR money-weighted (XIRR) por posición vs CAGR del activo en la ventana.
  function tirInfo(p) {
    const lotes = (p.lotes || []).filter(l => l.fecha && Number(l.cantidad) > 0 && Number(l.precio) > 0);
    if (lotes.length === 0) return { state: 'empty' };
    const price = priceOf(p.ticker);
    if (price == null) return { state: 'noprice' };
    const sorted = [...lotes].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const date0 = sorted[0].fecha;
    const today = new Date().toISOString().slice(0, 10);
    const yrs = (d) => (new Date(d).getTime() - new Date(date0).getTime()) / (365 * 864e5);
    const flows = sorted.map(l => ({ t: yrs(l.fecha), cf: -(Number(l.cantidad) * Number(l.precio)) }));
    const totalQty = lotes.reduce((a, l) => a + Number(l.cantidad), 0);
    flows.push({ t: yrs(today), cf: totalQty * price });
    const tir = xirr(flows);
    const raw = maxBars[p.ticker] || getBars(p.ticker) || [];
    const disc = detectDiscontinuity(raw);
    const cagr = cagrBetween(raw.slice(disc.startIndex || 0), date0);
    return {
      state: 'ok', tir, cagr,
      brecha: (tir != null && cagr != null) ? (tir - cagr) : null,
      date0, totalQty,
      qtyMismatch: Math.abs(totalQty - Number(p.cantidad)) > 1e-9,
      illustrative: !maxBars[p.ticker],
    };
  }

  function renderTir(p, idx) {
    const lotes = p.lotes || [];
    const info = tirInfo(p);
    return (
      <div className="pf-tir">
        <table className="pf-table" style={{ maxWidth: 460 }}>
          <thead><tr><th>Fecha compra</th><th>Cantidad</th><th>Precio</th><th></th></tr></thead>
          <tbody>
            {lotes.length === 0 && <tr><td colSpan={4} style={{ color: '#6b6558' }}>Sin lotes.</td></tr>}
            {lotes.map((l, li) => (
              <tr key={li}>
                <td><input className="pf-input" style={{ width: 130 }} type="date" value={l.fecha || ''} onChange={e => updateLote(idx, li, 'fecha', e.target.value)} /></td>
                <td><input className="pf-input" style={{ width: 90 }} type="number" min="0" value={l.cantidad} onChange={e => updateLote(idx, li, 'cantidad', Number(e.target.value) || 0)} /></td>
                <td><input className="pf-input" style={{ width: 100 }} type="number" min="0" step="0.01" value={l.precio} onChange={e => updateLote(idx, li, 'precio', Number(e.target.value) || 0)} /></td>
                <td><button className="pf-del" onClick={() => removeLote(idx, li)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="import-btn" onClick={() => addLote(idx)} style={{ marginTop: 6 }}>+ Lote</button>

        {info.state === 'empty' && (
          <p className="rd-note" style={{ marginTop: 8 }}>Agregá fecha, cantidad y precio de cada compra para ver tu TIR (el retorno real de tus entradas).</p>
        )}
        {info.state === 'noprice' && (
          <p className="rd-note" style={{ marginTop: 8 }}>— Sin precio actual del papel; dale ↻ Precios vivos.</p>
        )}
        {info.state === 'ok' && (
          <div style={{ marginTop: 8 }}>
            {info.illustrative && <div className="pf-reco-illustrative">⚠ Ilustrativo — CAGR sobre bundle sintético; dale ↻ Precios vivos.</div>}
            {info.qtyMismatch && <div className="pf-reco-illustrative">⚠ Los lotes no suman la cantidad de la posición (TIR igual se calcula con los lotes cargados).</div>}
            <p className="pf-tir-line">
              {info.tir == null
                ? <>TIR: <strong>—</strong> (sin cambio de signo en los flujos / ventana degenerada)</>
                : <>TIR (tu timing): <strong className={info.tir >= 0 ? 'up' : 'down'}>{fmtPct(info.tir)}</strong></>}
              {' · '}CAGR del activo: <strong className={info.cagr == null ? '' : info.cagr >= 0 ? 'up' : 'down'}>{info.cagr == null ? '—' : fmtPct(info.cagr)}</strong>
              {info.brecha != null && <> · brecha (TIR−CAGR): <strong>{info.brecha >= 0 ? '+' : ''}{(info.brecha * 100).toFixed(1)} pp</strong></>}
            </p>
            <p className="rd-note" style={{ marginTop: 2 }}>TIR &gt; CAGR ⇒ tu timing sumó; TIR &lt; CAGR ⇒ restó. Money-weighted, una sola moneda · educacional.</p>
          </div>
        )}
      </div>
    );
  }

  const heldSymbols = useMemo(() => new Set(positions.map(p => p.ticker)), [positions]);
  const horizonLabel = HORIZONS.find(h => h.days === horizonDays)?.label || `${horizonDays}d`;
  const heldRanked = ranking.filter(r => heldSymbols.has(r.symbol));
  const topN = ranking.slice(0, 3);
  // ¿El ranking corre con data viva o solo con bundle sintético?
  const synthetic = basis === 'synthetic';

  // ---------- Recomendación de rotación (model-based, orientadora) ----------
  // Postura explícita por posición: MANTENER si nada le gana de forma material;
  // EVALUAR ROTACIÓN hacia los candidatos que proyectan mejor retorno ajustado
  // por riesgo Y le ganan al benchmark naive. Sigue siendo lectura del modelo:
  // probabilística, con supuestos, no una orden. La decisión es de Alex.
  const recos = useMemo(() => {
    const seen = new Set();
    return positions.filter(p => (seen.has(p.ticker) ? false : seen.add(p.ticker))).map(p => {
      const held = ranking.find(r => r.symbol === p.ticker);
      // Posición sin data viva cuando el ranking ya corre sobre base real:
      // no es comparable, hay que refrescarla primero (no la mezclamos).
      if (!held) return { symbol: p.ticker, missing: true };
      const better = ranking
        .filter(r => !heldSymbols.has(r.symbol) && r.beatsNaive
          && r.riskAdj > held.riskAdj && r.medianReturn > held.medianReturn + 0.01)
        .slice(0, 3);
      return { held, better, missing: false, action: better.length === 0 ? 'MANTENER' : 'EVALUAR ROTACIÓN' };
    });
  }, [positions, ranking, heldSymbols]);

  return (
    <div>
      {/* ============ A. POSICIONES ============ */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          <span>Mis posiciones</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {liveMsg && <span style={{ fontSize: 11, color: '#a89f8e', fontFamily: 'JetBrains Mono, monospace' }}>{liveMsg}</span>}
            <button className="import-btn" onClick={refreshPositionsLive} disabled={loading}
              title="Baja precio vivo de Yahoo solo para tus posiciones (son pocas)">
              {loading ? '...' : '↻ Precios vivos'}
            </button>
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="pf-table">
            <thead>
              <tr>
                <th>Ticker</th><th>Cantidad</th><th>Costo prom.</th><th>Precio actual</th>
                <th>Valor mercado</th><th>P/L no realizado</th><th>Peso %</th><th></th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr><td colSpan={8} style={{ color: '#6b6558', padding: 12 }}>Sin posiciones. Agregá una abajo.</td></tr>
              )}
              {positions.map((p, idx) => {
                const price = priceOf(p.ticker);
                const mv = price != null ? price * p.cantidad : null;
                const cost = p.costoPromedio;
                const plAmt = (price != null && cost != null) ? (price - cost) * p.cantidad : null;
                const plPct = (price != null && cost != null && cost > 0) ? (price / cost - 1) : null;
                const totalCur = totalsByCurrency[p.moneda]?.mv || 0;
                const weight = (mv != null && totalCur > 0) ? mv / totalCur : null;
                const tirOpen = expandedTir.has(idx);
                return (
                  <React.Fragment key={idx}>
                  <tr>
                    <td>
                      <strong>{p.ticker}</strong>
                      <span className="pf-badge">{p.mercado}</span>
                      <span className="pf-src" style={{ color: isLive(p.ticker) ? '#82c5a4' : '#e8b86a' }}>
                        {isLive(p.ticker) ? 'LIVE' : 'bundle'}
                      </span>
                      <button className="pf-tir-toggle" onClick={() => toggleTir(idx)} title="TIR por fechas de compra (money-weighted)">
                        {tirOpen ? '▾' : '▸'} Fechas de compra (TIR)
                      </button>
                    </td>
                    <td>
                      <input className="pf-input" type="number" min="0" value={p.cantidad}
                        onChange={e => updateField(idx, 'cantidad', Number(e.target.value) || 0)} />
                    </td>
                    <td>
                      <input className="pf-input" type="number" min="0" step="0.01"
                        placeholder="—"
                        value={p.costoPromedio ?? ''}
                        onChange={e => updateField(idx, 'costoPromedio', e.target.value === '' ? null : Number(e.target.value))} />
                    </td>
                    <td>{fmtMoney(price, p.moneda)}</td>
                    <td>{fmtMoney(mv, p.moneda)}</td>
                    <td className={plAmt == null ? '' : plAmt >= 0 ? 'up' : 'down'}>
                      {plAmt == null ? '—' : `${fmtMoney(plAmt, p.moneda)} (${fmtPct(plPct)})`}
                    </td>
                    <td>{weight == null ? '—' : (weight * 100).toFixed(1) + '%'}</td>
                    <td>
                      <button className="pf-del" title="Eliminar (salida total)" onClick={() => removePosition(idx)}>✕</button>
                    </td>
                  </tr>
                  {tirOpen && (
                    <tr className="pf-tir-row">
                      <td colSpan={8}>{renderTir(p, idx)}</td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totales por moneda (separados, nunca se suman CLP + USD) */}
        <div className="pf-totals">
          {Object.keys(totalsByCurrency).length === 0 && <span style={{ color: '#6b6558' }}>—</span>}
          {Object.entries(totalsByCurrency).map(([moneda, t]) => {
            const pl = t.hasCost ? t.mv - t.cost : null;
            const plPct = t.hasCost && t.cost > 0 ? (t.mv / t.cost - 1) : null;
            return (
              <div key={moneda} className="pf-total-cell">
                <span className="lbl">Total {moneda}</span>
                <span className="val">{fmtMoney(t.mv, moneda)}</span>
                {pl != null && (
                  <span className={`pf-total-pl ${pl >= 0 ? 'up' : 'down'}`}>
                    P/L {fmtMoney(pl, moneda)} ({fmtPct(plPct)})
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Alta de posición */}
        <div className="pf-add">
          <select value={newTicker} onChange={e => setNewTicker(e.target.value)} className="pf-input" style={{ width: 260 }}>
            <optgroup label="Chile (IPSA)">
              {universe.filter(u => (u.market || 'CL') === 'CL').map(u => <option key={u.symbol} value={u.symbol}>{u.symbol} · {u.name}</option>)}
            </optgroup>
            <optgroup label="EE.UU.">
              {universe.filter(u => u.market === 'US').map(u => <option key={u.symbol} value={u.symbol}>{u.symbol} · {u.name}</option>)}
            </optgroup>
          </select>
          <input className="pf-input" type="number" min="0" value={newQty}
            onChange={e => setNewQty(Number(e.target.value) || 0)} placeholder="cantidad" />
          <button className="import-btn" onClick={addPosition}>+ Agregar posición</button>
        </div>
      </div>

      {/* ============ RIESGO DE CARTERA (Markowitz) ============ */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          <span>Riesgo de cartera · <span className="accent">Markowitz</span></span>
          {cartera.ok && <span style={{ fontSize: 11, color: '#a89f8e', fontFamily: 'JetBrains Mono, monospace' }}>{cartera.n} meses comunes</span>}
        </div>

        {!cartera.ok ? (
          <p className="rd-note">Necesitás al menos 2 papeles con historia mensual común. Agregá posiciones y dale ↻ Precios vivos.</p>
        ) : (
          <>
            {cartera.anyBundle && <div className="pf-reco-illustrative">⚠ Ilustrativo — algún papel corre sobre bundle sintético. Dale ↻ Precios vivos para historia real.</div>}
            {cartera.mixedCur && <div className="pf-reco-illustrative">⚠ Cartera con CLP y USD: este riesgo v1 <strong>NO incluye el efecto cambiario</strong> (pesos por valor de mercado nominal).</div>}
            {cartera.n < 24 && <div className="pf-reco-illustrative">⚠ Solo {cartera.n} meses comunes — covarianza poco robusta (&lt;24).</div>}
            {cartera.cuts && cartera.cuts.length > 0 && (
              <p className="rd-note" style={{ marginTop: 0 }}>Acotado por quiebre estructural: {cartera.cuts.join(' · ')}.</p>
            )}

            <div className="pf-totals" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
              <div className="pf-total-cell">
                <span className="lbl">Riesgo cartera σ_P (anual)</span>
                <span className="val">{fmtPct(cartera.risk.sigmaP, false)}</span>
              </div>
              <div className="pf-total-cell">
                <span className="lbl">Σ wᵢ·σᵢ (sin diversificar)</span>
                <span className="val">{fmtPct(cartera.risk.weightedSumVol, false)}</span>
              </div>
              <div className="pf-total-cell">
                <span className="lbl">Beneficio diversificación</span>
                <span className="val" style={{ color: cartera.risk.diversification > 0 ? '#82c5a4' : '#a89f8e' }}>
                  {fmtPct(cartera.risk.diversification, false)}
                </span>
              </div>
              <div className="pf-total-cell">
                <span className="lbl">Retorno cartera R_P (anual)</span>
                <span className="val" style={{ color: cartera.risk.retP >= 0 ? '#82c5a4' : '#d97757' }}>{fmtPct(cartera.risk.retP)}</span>
              </div>
            </div>

            {cartera.symbols.length >= 2 ? (
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <div className="rd-note" style={{ marginTop: 0, marginBottom: 6 }}>Matriz de correlación — pares cercanos a 1 = poca diversificación.</div>
                <table className="pf-table">
                  <thead>
                    <tr><th></th>{cartera.symbols.map((s, i) => <th key={s}>{s}<br /><span style={{ color: '#6b6558' }}>{(cartera.weights[i] * 100).toFixed(0)}%</span></th>)}</tr>
                  </thead>
                  <tbody>
                    {cartera.symbols.map((si, i) => (
                      <tr key={si}>
                        <td><strong>{si}</strong></td>
                        {cartera.symbols.map((sj, j) => {
                          const c = cartera.risk.corr[i][j];
                          const col = i === j ? '#6b6558' : c > 0.7 ? '#d97757' : c < 0.3 ? '#82c5a4' : '#c9bfa8';
                          return <td key={sj} style={{ color: col }}>{c.toFixed(2)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rd-note">Con 1 papel no hay diversificación ni correlación; agregá otro para compararlos.</p>
            )}

            {cartera.excluded.length > 0 && (
              <p className="rd-note">Sin historia suficiente (excluidos del cálculo): {cartera.excluded.join(', ')}.</p>
            )}
            <p className="rd-note">
              σ_P = √(wᵀΩw) con Ω = varianza-covarianza muestral de retornos mensuales log alineados (anualizada ×√12). σ_P &lt; Σ wᵢσᵢ cuando la correlación es &lt;1. Educacional, no asesoría.
            </p>
          </>
        )}
      </div>

      {/* ============ B. COMPARADOR DE ROTACIÓN ============ */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          <span>Comparador de rotación · <span className="accent">retorno proyectado {horizonLabel}</span></span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {rankMsg && <span style={{ fontSize: 11, color: '#a89f8e', fontFamily: 'JetBrains Mono, monospace' }}>{rankMsg}</span>}
            <select value={horizonDays} onChange={e => setHorizonDays(+e.target.value)} className="pf-input">
              {HORIZONS.map(h => <option key={h.days} value={h.days}>{h.label}</option>)}
            </select>
            <button className="import-btn" onClick={refreshAllLive} disabled={bulkLoading}
              title={`Baja en vivo las ${universe.length} acciones del universo (secuencial, ~${Math.round(universe.length * 0.4)}s, anti-429)`}
              style={{ color: '#82c5a4', borderColor: '#2e4636' }}>
              {bulkLoading ? '...' : '↻ Todo en vivo'}
            </button>
            <button className="import-btn" onClick={() => setRecalcNonce(n => n + 1)}
              title="Recalcula el ranking con la data disponible (bundle + lo cargado con LIVE)">↻ Recalcular</button>
          </span>
        </div>

        {/* Recomendación de rotación — accionable, model-based */}
        <div className="pf-reco">
          <div className="pf-reco-head">
            <span className="lbl">Recomendación de rotación · {horizonLabel}</span>
            <span className="pf-reco-top">
              Mejor del universo: {topN.map(r => `${r.symbol} (${fmtPct(r.medianReturn)})`).join(' · ') || '—'}
            </span>
          </div>

          {synthetic && (
            <div className="pf-reco-illustrative">
              ⚠ Orden ilustrativo — corre sobre bundle sintético. Dale <strong>↻ Todo en vivo</strong> para una recomendación con data real.
            </div>
          )}
          {!synthetic && excluded.length > 0 && (
            <div className="pf-reco-illustrative">
              ⚠ Comparando solo los <strong>{ranking.length}</strong> papeles con data viva (misma base real). Quedan <strong>{excluded.length}</strong> en
              bundle, <strong>excluidos</strong> del ranking para no mezclar real con sintético. Dale <strong>↻ Todo en vivo</strong> para incluirlos.
            </div>
          )}

          {recos.length === 0 && (
            <div className="pf-reco-row" style={{ color: '#6b6558' }}>
              Agregá una posición arriba para ver una lectura de rotación sobre tu cartera.
            </div>
          )}

          {recos.map((rec) => {
            if (rec.missing) {
              return (
                <div key={rec.symbol} className="pf-reco-row">
                  <span className="pf-reco-tag rotate">SIN DATA</span>
                  <span className="pf-reco-text">
                    Tu <strong>{rec.symbol}</strong> no tiene precio vivo: no es comparable contra los demás todavía.
                    Dale <strong>↻ Precios vivos</strong> (o ↻ Todo en vivo) para incluirla.
                  </span>
                </div>
              );
            }
            const { held, better, action } = rec;
            const top = better[0];
            return (
              <div key={held.symbol} className="pf-reco-row">
                <span className={`pf-reco-tag ${action === 'MANTENER' ? 'hold' : 'rotate'}`}>{action}</span>
                <span className="pf-reco-text">
                  Tu <strong>{held.symbol}</strong>: <span className={`pf-verdict ${held.verdict.tone}`}>{held.verdict.label}</span>,
                  puesto {held.rank} de {ranking.length} a {horizonLabel}.
                  {action === 'MANTENER'
                    ? <> El modelo sugiere <strong>MANTENER</strong>: ningún candidato lo supera con margen en retorno ajustado por riesgo y ganándole al naive.</>
                    : <> El modelo sugiere <strong>EVALUAR ROTACIÓN</strong> hacia {better.map(b => b.symbol).join(', ')} — proyectan mejor retorno ajustado por riesgo
                        (p. ej. {top.symbol} mediano {fmtPct(top.medianReturn)} vs tu {fmtPct(held.medianReturn)}; P(&gt;0) {(top.probPositive*100).toFixed(0)}% vs {(held.probPositive*100).toFixed(0)}%; le ganan al naive).</>}
                </span>
              </div>
            );
          })}

          <div className="pf-reco-foot">Lectura del modelo · educacional, no asesoría.</div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="pf-table">
            <thead>
              <tr>
                <th>#</th><th>Ticker</th><th>Veredicto</th>
                <th>Retorno med. ({horizonLabel})</th>
                <th>Banda P10–P90</th>
                <th>P(ret &gt; 0)</th>
                <th>Naive (μ=0)</th>
                <th>Riesgo-aj.</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map(r => {
                const held = heldSymbols.has(r.symbol);
                return (
                  <tr key={r.symbol} className={held ? 'pf-held' : ''}>
                    <td>{r.rank}</td>
                    <td>
                      <strong>{r.symbol}</strong>
                      {held && <span className="pf-badge" style={{ background: '#e8b86a', color: '#0d0c0a' }}>MÍA</span>}
                      <span className="pf-src" style={{ color: r.live ? '#82c5a4' : '#6b6558' }}>{r.live ? 'LIVE' : 'bundle'}</span>
                    </td>
                    <td><span className={`pf-verdict ${r.verdict.tone}`}>{r.verdict.label}</span></td>
                    <td className={r.medianReturn >= 0 ? 'up' : 'down'}>{fmtPct(r.medianReturn)}</td>
                    <td style={{ fontSize: 11, color: '#a89f8e' }}>{fmtPct(r.p10Return)} … {fmtPct(r.p90Return)}</td>
                    <td>{(r.probPositive * 100).toFixed(0)}%</td>
                    <td style={{ color: r.beatsNaive ? '#82c5a4' : '#d97757', fontSize: 11 }}>
                      {fmtPct(r.naiveMedianReturn)} {r.beatsNaive ? '✓ gana' : '≈ ruido'}
                    </td>
                    <td><strong>{r.riskAdj.toFixed(2)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!synthetic && excluded.length > 0 && (
          <p style={{ marginTop: 10, fontSize: 11, color: '#6b6558', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 }}>
            Excluidos por no tener data viva ({excluded.length}): {excluded.map(r => r.symbol).join(', ')}.
          </p>
        )}

        <p className="pf-disclaimer">
          ⓘ Ranking <strong>model-based</strong> (GBM con μ/σ históricos, reusa el motor de proyecciones). Depende del horizonte
          y <strong>no es garantía</strong>. La métrica riesgo-ajustada = retorno mediano ÷ amplitud de la banda P10–P90. El
          <strong style={{ color: '#d97757' }}> naive (μ=0)</strong> va al lado: si el modelo no le gana, la "señal" es ruido. La
          lectura y la decisión de rotar son tuyas.
        </p>
      </div>
    </div>
  );
}
