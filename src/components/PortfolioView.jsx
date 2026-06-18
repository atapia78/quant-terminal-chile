import React, { useState, useMemo, useCallback } from 'react';
import { loadPortfolio, savePortfolio, projectTicker, rotationVerdict, HORIZONS } from '../lib/portfolio.js';

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
  const ranking = useMemo(() => {
    const rows = universe.map(u => {
      const proj = projectTicker(getBars(u.symbol), horizonDays);
      return proj ? {
        symbol: u.symbol, name: u.name, moneda: u.currency || 'CLP',
        live: isLive(u.symbol), verdict: rotationVerdict(proj), ...proj,
      } : null;
    }).filter(Boolean);
    rows.sort((a, b) => b.riskAdj - a.riskAdj);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, horizonDays, liveData, recalcNonce]);

  const heldSymbols = useMemo(() => new Set(positions.map(p => p.ticker)), [positions]);
  const horizonLabel = HORIZONS.find(h => h.days === horizonDays)?.label || `${horizonDays}d`;
  const heldRanked = ranking.filter(r => heldSymbols.has(r.symbol));
  const topN = ranking.slice(0, 3);
  // ¿El ranking corre con data viva o solo con bundle sintético?
  const liveCount = ranking.filter(r => r.live).length;
  const synthetic = liveCount === 0;

  // ---------- Recomendación de rotación (model-based, orientadora) ----------
  // Postura explícita por posición: MANTENER si nada le gana de forma material;
  // EVALUAR ROTACIÓN hacia los candidatos que proyectan mejor retorno ajustado
  // por riesgo Y le ganan al benchmark naive. Sigue siendo lectura del modelo:
  // probabilística, con supuestos, no una orden. La decisión es de Alex.
  const recos = useMemo(() => {
    return positions
      .map(p => ranking.find(r => r.symbol === p.ticker))
      .filter(Boolean)
      .map(held => {
        const better = ranking
          .filter(r => !heldSymbols.has(r.symbol) && r.beatsNaive
            && r.riskAdj > held.riskAdj && r.medianReturn > held.medianReturn + 0.01)
          .slice(0, 3);
        return { held, better, action: better.length === 0 ? 'MANTENER' : 'EVALUAR ROTACIÓN' };
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
                return (
                  <tr key={idx}>
                    <td>
                      <strong>{p.ticker}</strong>
                      <span className="pf-badge">{p.mercado}</span>
                      <span className="pf-src" style={{ color: isLive(p.ticker) ? '#82c5a4' : '#e8b86a' }}>
                        {isLive(p.ticker) ? 'LIVE' : 'bundle'}
                      </span>
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
              ⚠ Orden ilustrativo — corre sobre bundle sintético. Dale <strong>↻ Precios vivos</strong> / <strong>↻ del mercado</strong> y
              <strong> Recalcular</strong> para una recomendación con data viva.
            </div>
          )}

          {recos.length === 0 && (
            <div className="pf-reco-row" style={{ color: '#6b6558' }}>
              Agregá una posición arriba para ver una lectura de rotación sobre tu cartera.
            </div>
          )}

          {recos.map(({ held, better, action }) => {
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
