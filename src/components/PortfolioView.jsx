import React, { useState, useMemo, useCallback } from 'react';
import { loadPortfolio, savePortfolio, projectTicker, HORIZONS } from '../lib/portfolio.js';

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

  // Actualiza precio vivo SOLO de las posiciones (son pocas).
  async function refreshPositionsLive() {
    const seen = new Set();
    for (const p of positions) {
      if (seen.has(p.ticker)) continue;
      seen.add(p.ticker);
      await onRefreshTicker(p.ticker);
    }
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
        live: isLive(u.symbol), ...proj,
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
          <button className="import-btn" onClick={refreshPositionsLive} disabled={loading}
            title="Baja precio vivo de Yahoo solo para tus posiciones (son pocas)">
            {loading ? '...' : '↻ Precios vivos'}
          </button>
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
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={horizonDays} onChange={e => setHorizonDays(+e.target.value)} className="pf-input">
              {HORIZONS.map(h => <option key={h.days} value={h.days}>{h.label}</option>)}
            </select>
            <button className="import-btn" onClick={() => setRecalcNonce(n => n + 1)}
              title="Recalcula el ranking con la data disponible (bundle + lo cargado con LIVE)">↻ Recalcular</button>
          </span>
        </div>

        {/* Recomendación de rotación — postura explícita, model-based */}
        <div className="pf-reco">
          <div className="pf-reco-head">
            <span className="lbl">Recomendación de rotación · {horizonLabel}</span>
            <span className="pf-reco-top">
              Mejor del universo: {topN.map(r => `${r.symbol} (${fmtPct(r.medianReturn)})`).join(' · ') || '—'}
            </span>
          </div>
          {recos.length === 0 && (
            <div className="pf-reco-row" style={{ color: '#6b6558' }}>
              Agregá una posición arriba para ver una lectura de rotación sobre tu cartera.
            </div>
          )}
          {recos.map(({ held, better, action }) => (
            <div key={held.symbol} className="pf-reco-row">
              <span className={`pf-reco-tag ${action === 'MANTENER' ? 'hold' : 'rotate'}`}>{action}</span>
              <span className="pf-reco-text">
                <strong>{held.symbol}</strong> (puesto {held.rank}/{ranking.length} · retorno med. {fmtPct(held.medianReturn)},
                P(&gt;0) {(held.probPositive * 100).toFixed(0)}%)
                {action === 'MANTENER'
                  ? ' — ningún candidato le gana en retorno ajustado por riesgo y al naive. El modelo sugiere mantener.'
                  : <> — el modelo sugiere evaluar rotar hacia: {better.map(b =>
                      `${b.symbol} (${fmtPct(b.medianReturn)}, P(>0) ${(b.probPositive * 100).toFixed(0)}%)`).join(' · ')}.</>}
              </span>
            </div>
          ))}
          <div className="pf-reco-foot">
            Lectura <strong>model-based</strong> (proyección GBM, reusa el motor). Es orientación probabilística con supuestos
            explícitos, <strong>no una orden ni garantía</strong>. La decisión final es tuya · uso educacional.
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="pf-table">
            <thead>
              <tr>
                <th>#</th><th>Ticker</th>
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
