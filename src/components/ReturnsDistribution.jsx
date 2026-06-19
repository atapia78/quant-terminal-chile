import React, { useState, useMemo, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { histogram, computeStats } from '../lib/stats.js';
import { useYahooQuotes, yahooSymbolFor } from '../lib/useYahooQuotes.js';
import {
  resampleMonthly, resampleAnnual, periodReturns, normalFit, normalPdf,
  empiricalCIs, monthlySeasonality, detectDiscontinuity, MONTH_LABELS
} from '../lib/returns.js';

const pf = (x, dec = 2) => x == null || isNaN(x) ? '—' : `${(x * 100).toFixed(dec)}%`;

// Construye histograma + ajuste Normal para una serie de retornos.
function buildDist(rets) {
  const n = rets.length;
  if (n < 1) return { n: 0, fit: null, chart: [], cis: [] };
  const fit = n >= 2 ? normalFit(rets) : null;
  let bins = Math.min(18, Math.max(5, Math.round(Math.sqrt(n)) + 3));
  const min = Math.min(...rets), max = Math.max(...rets);
  if (max === min) bins = 1;
  const h = histogram(rets, bins);
  const w = h.length > 1 ? (h[1].center - h[0].center) : (Math.abs(min) || 1);
  const chart = h.map(b => ({
    label: (b.center * 100).toFixed(1),
    count: b.count,
    normal: fit ? normalPdf(b.center, fit.mu, fit.sigma) * n * w : null,
    up: b.center >= 0,
  }));
  const cis = fit ? empiricalCIs(fit.mu, fit.sigma) : [];
  return { n, fit, chart, cis };
}

function DistBlock({ title, dist, mode, shortFlag }) {
  const { n, fit, chart, cis } = dist;
  return (
    <div className="rd-dist">
      <div className="rd-dist-head">
        <span className="rd-dist-title">{title} · {n} obs.</span>
        {shortFlag && <span className="rd-shortflag">histórico corto — poco robusto</span>}
      </div>
      {n < 1 ? (
        <p className="rd-note">Sin retornos en el tramo.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={chart} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }}
                tickFormatter={v => `${v}%`} interval={Math.max(0, Math.floor(chart.length / 6))} />
              <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} width={26} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }}
                labelStyle={{ color: '#e8b86a' }} itemStyle={{ color: '#e8e3d8' }}
                formatter={(v, nm) => [typeof v === 'number' ? v.toFixed(2) : v, nm === 'count' ? 'Frecuencia' : 'Normal']}
                labelFormatter={l => `retorno ${l}%`} />
              <Bar dataKey="count" name="count">
                {chart.map((c, i) => <Cell key={i} fill={c.up ? '#82c5a4' : '#d97757'} fillOpacity={0.55} />)}
              </Bar>
              {fit && <Line type="monotone" dataKey="normal" stroke="#e8b86a" strokeWidth={1.8} dot={false} name="normal" />}
            </ComposedChart>
          </ResponsiveContainer>
          {fit ? (
            <>
              <div className="rd-fit">
                <div><span className="lbl">μ</span><span className="val">{pf(fit.mu)}</span></div>
                <div><span className="lbl">σ</span><span className="val">{pf(fit.sigma)}</span></div>
              </div>
              <table className="pf-table" style={{ marginTop: 6 }}>
                <thead><tr><th>IC</th><th>Rango (μ±kσ)</th><th>Prob.</th></tr></thead>
                <tbody>
                  {cis.map(ci => (
                    <tr key={ci.label}><td><strong>{ci.label}</strong></td><td>{pf(ci.lo)} … {pf(ci.hi)}</td><td>{ci.p}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="rd-note">Muy pocas observaciones para ajustar Normal ({n}).</p>
          )}
        </>
      )}
    </div>
  );
}

export default function ReturnsDistribution({ symbol, fallbackBars, currency = 'CLP' }) {
  const [mode, setMode] = useState('log');   // 'log' | 'arith' (aplica a ambos)
  const [fromYear, setFromYear] = useState('auto');
  const { fetchSymbol } = useYahooQuotes();   // instancia propia (no aborta el fetch del gráfico)
  const [maxBars, setMaxBars] = useState(null);

  // Historia MÁXIMA del ticker seleccionado, independiente del range del gráfico.
  useEffect(() => {
    setMaxBars(null);
    setFromYear('auto');
    if (!symbol) return;
    let cancelled = false;
    fetchSymbol(yahooSymbolFor(symbol), 'max')
      .then(d => { if (!cancelled && d && d.bars) setMaxBars(d.bars); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol, fetchSymbol]);

  const haveLive = !!(maxBars && maxBars.length);
  const sourceBars = haveLive ? maxBars : (fallbackBars || []);

  // Guard de discontinuidad (quiebre estructural) + override manual "analizar desde".
  const disc = useMemo(() => detectDiscontinuity(sourceBars), [sourceBars]);
  const years = useMemo(() => {
    const ys = new Set();
    for (const b of sourceBars) ys.add(b.date.slice(0, 4));
    return [...ys].sort();
  }, [sourceBars]);

  const effStartIndex = useMemo(() => {
    let idx = disc.startIndex || 0;
    if (fromYear !== 'auto') {
      const manual = sourceBars.findIndex(b => b.date.slice(0, 4) >= fromYear);
      if (manual >= 0) idx = Math.max(idx, manual);
    }
    return idx;
  }, [disc, fromYear, sourceBars]);

  const eff = useMemo(() => sourceBars.slice(effStartIndex), [sourceBars, effStartIndex]);

  // CAGR + drag sobre la serie efectiva (historia continua).
  const cagrInfo = useMemo(() => {
    if (eff.length < 2) return null;
    const closes = eff.map(b => b.close);
    const st = computeStats(closes);
    const first = eff[0], last = eff[eff.length - 1];
    const yrs = (new Date(last.date) - new Date(first.date)) / (365.25 * 864e5);
    if (!(first.close > 0) || !(last.close > 0) || yrs <= 0) return null;
    const cagr = Math.pow(last.close / first.close, 1 / yrs) - 1;
    const annR = st ? st.annReturn : null;
    return { cagr, annR, dragBps: annR != null ? (annR - cagr) * 10000 : null, years: yrs };
  }, [eff]);

  // Distribuciones mensual y anual (ambas), serie elegida (log/aritm).
  const monthlyRets = useMemo(() => periodReturns(resampleMonthly(eff), mode).map(x => x.r), [eff, mode]);
  const annualRets = useMemo(() => periodReturns(resampleAnnual(eff), mode).map(x => x.r), [eff, mode]);
  const distM = useMemo(() => buildDist(monthlyRets), [monthlyRets]);
  const distA = useMemo(() => buildDist(annualRets), [annualRets]);
  const season = useMemo(() => monthlySeasonality(eff), [eff]);

  const synthetic = !haveLive;
  const modeLabel = mode === 'log' ? 'logarítmica' : 'aritmética';
  const effFrom = eff[0]?.date, effTo = eff[eff.length - 1]?.date;
  const annualShort = annualRets.length < 5;

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-title">
        <span>Distribución de retornos · <span className="accent">mensual + anual ({modeLabel})</span></span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="pf-input" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="log">Logarítmico</option>
            <option value="arith">Aritmético</option>
          </select>
          <select className="pf-input" value={fromYear} onChange={e => setFromYear(e.target.value)} title="Analizar desde (override del corte)">
            <option value="auto">Desde: auto</option>
            {years.map(y => <option key={y} value={y}>Desde {y}</option>)}
          </select>
        </span>
      </div>

      {/* Flags de honestidad + período efectivo */}
      {synthetic && (
        <div className="rd-flag">⚠ Ilustrativo — sin data viva del ticker. Dale <strong>↻ LIVE</strong> para historia real.</div>
      )}
      {disc.cutDate && (
        <div className="rd-flag">
          Análisis acotado al tramo continuo desde <strong>{disc.cutDate}</strong>: {disc.reason}.
        </div>
      )}
      <p className="rd-note" style={{ marginTop: 0 }}>
        Período efectivo: <strong>{effFrom || '—'}</strong> → <strong>{effTo || '—'}</strong> ({eff.length} días)
        {cagrInfo && <> · CAGR (geom. anual) <strong style={{ color: cagrInfo.cagr >= 0 ? '#82c5a4' : '#d97757' }}>{pf(cagrInfo.cagr)}</strong>
          {cagrInfo.dragBps != null && <> · drag por volatilidad <strong>{cagrInfo.dragBps >= 0 ? '+' : ''}{cagrInfo.dragBps.toFixed(0)} pb</strong> (vs aritmético {pf(cagrInfo.annR)})</>}</>}
      </p>

      {/* Ambos histogramas a la vez */}
      <div className="rd-dist-grid">
        <DistBlock title="Mensual" dist={distM} mode={mode} shortFlag={false} />
        <DistBlock title="Anual" dist={distA} mode={mode} shortFlag={annualShort} />
      </div>

      {/* Estacionalidad */}
      <div className="rd-season">
        <div className="panel-title" style={{ marginTop: 4 }}>
          <span>Estacionalidad mensual <span className="accent">(retornos mensuales aritméticos)</span></span>
          <span className="rd-season-head">
            {season.bull && <>Alcista: <strong style={{ color: '#82c5a4' }}>{MONTH_LABELS[season.bull.month - 1]}</strong> ({pf(season.bull.mean)}) · </>}
            {season.bear && <>Bajista: <strong style={{ color: '#d97757' }}>{MONTH_LABELS[season.bear.month - 1]}</strong> ({pf(season.bear.mean)})</>}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={season.byMonth.map(m => ({ label: MONTH_LABELS[m.month - 1], meanPct: m.mean == null ? 0 : m.mean * 100, mean: m.mean }))}
            margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} />
            <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} width={34} tickFormatter={v => `${v.toFixed(1)}%`} />
            <Tooltip contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }}
              labelStyle={{ color: '#e8b86a' }} itemStyle={{ color: '#e8e3d8' }} formatter={(v) => [`${Number(v).toFixed(2)}%`, 'Retorno medio']} />
            <ReferenceLine y={0} stroke="#3d342a" />
            <Bar dataKey="meanPct" name="meanPct">
              {season.byMonth.map((m, i) => <Cell key={i} fill={(m.mean ?? 0) >= 0 ? '#82c5a4' : '#d97757'} fillOpacity={0.6} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        <p className="rd-note">
          {season.best && <>Mejor mes: <strong style={{ color: '#82c5a4' }}>{season.best.period}</strong> ({pf(season.best.r)}). </>}
          {season.worst && <>Peor: <strong style={{ color: '#d97757' }}>{season.worst.period}</strong> ({pf(season.worst.r)}). </>}
          {season.nMonths < 24 && <strong>Pocos meses — estacionalidad poco robusta.</strong>}
        </p>
      </div>

      <p className="rd-note" style={{ marginTop: 10 }}>
        ⓘ Lectura descriptiva sobre la historia continua del ticker · educacional, no asesoría. La distribución anual requiere historia larga para ser robusta.
      </p>
    </div>
  );
}
