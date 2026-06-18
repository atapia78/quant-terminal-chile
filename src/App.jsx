import React, { useState, useMemo, useCallback } from 'react';
import './App.css';

import { IPSA_BUNDLE, IPSA_BY_SYMBOL } from './data/ipsaBundle.js';
import { sma, ema, rsi, macd, bollinger, atr } from './lib/indicators.js';
import { computeStats, histogram } from './lib/stats.js';
import { useYahooQuotes, yahooSymbolFor } from './lib/useYahooQuotes.js';

import PriceChart from './components/PriceChart.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import IndicatorsRow from './components/IndicatorsRow.jsx';
import ProjectionsPanel from './components/ProjectionsPanel.jsx';
import PositionSizing from './components/PositionSizing.jsx';
import QuantSummary from './components/QuantSummary.jsx';
import CSVImportModal from './components/CSVImportModal.jsx';
import PortfolioView from './components/PortfolioView.jsx';

export default function App() {
  const [view, setView] = useState('analisis');
  const [tickerKey, setTickerKey] = useState('COPEC');
  const [customStock, setCustomStock] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [liveData, setLiveData] = useState({});
  const [fetchError, setFetchError] = useState(null);
  const [range, setRange] = useState('2y');

  const { fetchSymbol, loading } = useYahooQuotes();

  const isCustom = customStock != null && tickerKey === customStock.symbol;
  const live = liveData[tickerKey];

  // Prioridad: CSV import > Yahoo live > Bundle
  const stock = isCustom
    ? { ...customStock, name: customStock.symbol, sector: 'CSV Import', currency: customStock.currency || 'USD' }
    : live
      ? { ...IPSA_BY_SYMBOL[tickerKey], bars: live.bars, currency: live.currency, fetchedAt: live.fetchedAt }
      : IPSA_BY_SYMBOL[tickerKey];

  const refreshTicker = useCallback(async (nemo) => {
    setFetchError(null);
    try {
      const symbol = yahooSymbolFor(nemo);
      const data = await fetchSymbol(symbol, range);
      if (data) setLiveData(prev => ({ ...prev, [nemo]: data }));
    } catch (e) {
      setFetchError(`${nemo}: ${e.message}`);
    }
  }, [fetchSymbol, range]);

  const refreshAll = useCallback(async () => {
    setFetchError(null);
    let errors = [];
    for (const t of IPSA_BUNDLE) {
      try {
        const data = await fetchSymbol(yahooSymbolFor(t.symbol), range);
        if (data) setLiveData(prev => ({ ...prev, [t.symbol]: data }));
      } catch (e) {
        errors.push(`${t.symbol}: ${e.message}`);
      }
    }
    if (errors.length > 0) setFetchError(errors.join(' · '));
  }, [fetchSymbol, range]);

  const enriched = useMemo(() => {
    if (!stock) return [];
    const bars = stock.bars;
    const closes = bars.map(b => b.close);
    const s20 = sma(closes, 20), s50 = sma(closes, 50);
    const bb = bollinger(closes, 20, 2);
    const r = rsi(closes, 14);
    const m = macd(closes);
    const a = atr(bars, 14);
    return bars.map((b, i) => ({
      ...b,
      sma20: s20[i], sma50: s50[i],
      bbUp: bb.up[i], bbLo: bb.lo[i],
      rsi: r[i],
      macd: m.macd[i], macdSig: m.signal[i], macdHist: m.hist[i],
      atr: a[i],
    }));
  }, [stock]);

  const stats = useMemo(() => {
    if (enriched.length < 2) return null;
    return computeStats(enriched.map(b => b.close));
  }, [enriched]);

  const hist = useMemo(() => {
    if (!stats) return [];
    return histogram(stats.returns, 22);
  }, [stats]);

  if (!stock || enriched.length === 0) {
    return <div className="terminal">Cargando...</div>;
  }

  const latest = enriched[enriched.length - 1];
  const prev = enriched[enriched.length - 2];
  const dayChg = prev ? (latest.close - prev.close) / prev.close : 0;
  const w5 = enriched[Math.max(0, enriched.length - 6)];
  const weekChg = (latest.close - w5.close) / w5.close;
  const yearStart = enriched[0];
  const yearChg = (latest.close - yearStart.close) / yearStart.close;

  const currency = stock.currency || 'CLP';
  const fmtPrice = v => currency === 'CLP'
    ? '$' + v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$' + v.toFixed(2);

  function handleImport({ symbol, bars }) {
    setCustomStock({ symbol, bars, currency: 'USD' });
    setTickerKey(symbol);
    setShowImport(false);
  }

  const dataSource = isCustom ? 'csv' : live ? 'yahoo' : 'bundle';
  const dataSourceLabel = {
    csv: { text: 'CSV', color: '#82c5a4' },
    yahoo: { text: 'YAHOO LIVE', color: '#82c5a4' },
    bundle: { text: 'BUNDLE SINTÉTICO', color: '#e8b86a' },
  }[dataSource];

  return (
    <div className="terminal">
      <div className="header">
        <div className="brand-wrap">
          <span className="brand-mark"><em>Quant</em>Terminal</span>
          <span className="brand-sub">Bolsa de Santiago · v0.2</span>
        </div>
        <div className="header-right">
          <div className="ticker-tabs">
            {IPSA_BUNDLE.map(t => (
              <button
                key={t.symbol}
                className={`ticker-pill ${tickerKey === t.symbol && !isCustom ? 'active' : ''}`}
                onClick={() => setTickerKey(t.symbol)}
                style={liveData[t.symbol] ? { borderLeft: '2px solid #82c5a4' } : {}}
                title={liveData[t.symbol] ? 'Data live de Yahoo' : 'Data del bundle (sintética)'}
              >
                {t.symbol}
              </button>
            ))}
            {customStock && (
              <button
                className={`ticker-pill ${isCustom ? 'active' : ''}`}
                onClick={() => setTickerKey(customStock.symbol)}
                style={{ borderColor: '#82c5a4' }}
              >
                {customStock.symbol}
              </button>
            )}
          </div>
          {!isCustom && (
            <>
              <select
                value={range}
                onChange={e => setRange(e.target.value)}
                className="ticker-pill"
                style={{ paddingRight: 26, cursor: 'pointer' }}
                title="Rango histórico al refrescar"
              >
                <option value="1y">1Y</option>
                <option value="2y">2Y</option>
                <option value="5y">5Y</option>
                <option value="max">MAX</option>
              </select>
              <button
                className="import-btn"
                onClick={() => refreshTicker(tickerKey)}
                disabled={loading}
                title="Bajar datos frescos de Yahoo Finance vía /api/quotes"
              >
                {loading ? '...' : '↻ LIVE'}
              </button>
              <button
                className="import-btn"
                onClick={refreshAll}
                disabled={loading}
                title="Refresca las 7 acciones del bundle"
                style={{ color: '#e8b86a', borderColor: '#3d342a' }}
              >
                ↻ ALL
              </button>
            </>
          )}
          <button className="import-btn" onClick={() => setShowImport(true)}>+ CSV</button>
        </div>
      </div>

      {fetchError && (
        <div style={{
          padding: '10px 14px', background: 'rgba(217, 119, 87, 0.08)',
          border: '1px solid #3d2a26', marginBottom: 14, fontSize: 12,
          fontFamily: 'JetBrains Mono, monospace', color: '#d97757'
        }}>
          ⚠ {fetchError}. En dev local usa <code style={{ color: '#e8b86a' }}>vercel dev</code> (no <code>npm run dev</code>) para que <code>/api/quotes</code> funcione.
          <button onClick={() => setFetchError(null)} style={{
            float: 'right', background: 'transparent', border: 'none', color: '#d97757',
            cursor: 'pointer', fontSize: 16
          }}>×</button>
        </div>
      )}

      <div className="view-nav">
        <button className={`view-tab ${view === 'analisis' ? 'active' : ''}`} onClick={() => setView('analisis')}>Análisis</button>
        <button className={`view-tab ${view === 'portafolio' ? 'active' : ''}`} onClick={() => setView('portafolio')}>Mi Portafolio</button>
      </div>

      {view === 'portafolio' && (
        <PortfolioView
          universe={IPSA_BUNDLE}
          bySymbol={IPSA_BY_SYMBOL}
          liveData={liveData}
          onRefreshTicker={refreshTicker}
          loading={loading}
        />
      )}

      {view === 'analisis' && (<>
      <div className="top-stats">
        <div className="stat-cell">
          <span className="stat-label">Instrumento</span>
          <span className="stat-name">
            {stock.name}
            <span className="custom-tag" style={{ background: dataSourceLabel.color }}>{dataSourceLabel.text}</span>
          </span>
          <span className="stat-meta">
            {stock.symbol} · {stock.sector}
            {live && <> · <span style={{ color: '#82c5a4' }}>actualizado {new Date(live.fetchedAt).toLocaleString('es-CL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span></>}
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Último</span>
          <span className="stat-value">{fmtPrice(latest.close)}</span>
          <span className="stat-meta">{latest.date}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Día</span>
          <span className={`stat-value ${dayChg >= 0 ? 'up' : 'down'}`}>
            {dayChg >= 0 ? '+' : ''}{(dayChg * 100).toFixed(2)}%
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">5 días</span>
          <span className={`stat-value ${weekChg >= 0 ? 'up' : 'down'}`}>
            {weekChg >= 0 ? '+' : ''}{(weekChg * 100).toFixed(2)}%
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Vol anual</span>
          <span className="stat-value">{stats ? (stats.annVol * 100).toFixed(1) + '%' : '—'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Sharpe</span>
          <span className={`stat-value ${stats && stats.sharpe >= 1 ? 'up' : stats && stats.sharpe < 0 ? 'down' : ''}`}>
            {stats ? stats.sharpe.toFixed(2) : '—'}
          </span>
        </div>
      </div>

      <div className="grid-main">
        <PriceChart enriched={enriched} currency={currency} />
        <StatsPanel stats={stats} yearChg={yearChg} />
      </div>

      <IndicatorsRow enriched={enriched} hist={hist} latest={latest} statsN={stats?.n ?? 0} />

      <div style={{ marginBottom: 18 }}>
        <ProjectionsPanel bars={enriched} currency={currency} />
      </div>

      <div className="grid-bottom">
        <PositionSizing latest={latest} currency={currency} />
        <QuantSummary stats={stats} latest={latest} tickerSymbol={stock.symbol} />
      </div>
      </>)}

      <div className="footer-note">
        <span>
          {dataSource === 'csv' && 'DATA IMPORTADA DE CSV · análisis sobre serie del usuario'}
          {dataSource === 'yahoo' && '✓ DATA LIVE DE YAHOO FINANCE · vía /api/quotes (cache 15 min)'}
          {dataSource === 'bundle' && 'DATA SINTÉTICA · click ↻ LIVE para bajar real de Yahoo'}
        </span>
        <span>
          Bolsa de Santiago · IPSA · no constituye recomendación de inversión · <a href="https://github.com/" target="_blank" rel="noopener">github</a>
        </span>
      </div>

      {showImport && <CSVImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
    </div>
  );
}
