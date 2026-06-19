import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { histogram } from '../lib/stats.js';
import {
  resampleMonthly, resampleAnnual, periodReturns, normalFit, normalPdf,
  empiricalCIs, monthlySeasonality, MONTH_LABELS
} from '../lib/returns.js';

const pf = (x, dec = 2) => x == null || isNaN(x) ? '—' : `${(x * 100).toFixed(dec)}%`;

export default function ReturnsDistribution({ bars, dataSource = 'bundle' }) {
  const [freq, setFreq] = useState('month'); // 'month' | 'year'
  const [mode, setMode] = useState('log');   // 'log' | 'arith' (default clase: mensual log)

  const periods = useMemo(() => freq === 'month' ? resampleMonthly(bars) : resampleAnnual(bars), [bars, freq]);
  const rets = useMemo(() => periodReturns(periods, mode).map(x => x.r), [periods, mode]);
  const fit = useMemo(() => normalFit(rets), [rets]);
  const cis = fit ? empiricalCIs(fit.mu, fit.sigma) : [];
  const season = useMemo(() => monthlySeasonality(bars), [bars]);

  // Histograma + curva Normal superpuesta (escalada a frecuencia).
  const chart = useMemo(() => {
    if (!fit || rets.length < 3) return [];
    const bins = Math.min(18, Math.max(6, Math.round(Math.sqrt(rets.length)) + 4));
    const h = histogram(rets, bins);
    const w = h.length > 1 ? (h[1].center - h[0].center) : 1;
    return h.map(b => ({
      center: b.center,
      label: (b.center * 100).toFixed(1),
      count: b.count,
      normal: normalPdf(b.center, fit.mu, fit.sigma) * rets.length * w,
      up: b.center >= 0,
    }));
  }, [rets, fit]);

  const synthetic = dataSource === 'bundle';
  const shortHistory = freq === 'year' && rets.length < 5;
  const freqLabel = freq === 'month' ? 'mensual' : 'anual';
  const modeLabel = mode === 'log' ? 'logarítmica' : 'aritmética';

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-title">
        <span>Distribución de retornos · <span className="accent">{freqLabel} {modeLabel}</span></span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="pf-input" value={freq} onChange={e => setFreq(e.target.value)}>
            <option value="month">Mensual</option>
            <option value="year">Anual</option>
          </select>
          <select className="pf-input" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="log">Logarítmico</option>
            <option value="arith">Aritmético</option>
          </select>
        </span>
      </div>

      {synthetic && (
        <div className="rd-flag">⚠ Ilustrativo — corre sobre bundle sintético. Dale <strong>↻ LIVE</strong> para data viva.</div>
      )}
      {shortHistory && (
        <div className="rd-flag">⚠ Histórico corto ({rets.length} años) — distribución anual poco robusta.</div>
      )}

      {!fit || rets.length < 3 ? (
        <p style={{ color: '#6b6558', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
          Serie insuficiente para {freqLabel} {modeLabel} ({rets.length} obs.).
        </p>
      ) : (
        <>
          <div className="rd-grid">
            {/* Histograma + Normal */}
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chart} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" stroke="#3a3530"
                    tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }}
                    tickFormatter={v => `${v}%`} interval={Math.floor(chart.length / 7)} />
                  <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} width={28} />
                  <Tooltip
                    contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }}
                    labelStyle={{ color: '#e8b86a' }} itemStyle={{ color: '#e8e3d8' }}
                    formatter={(v, n) => [typeof v === 'number' ? v.toFixed(2) : v, n === 'count' ? 'Frecuencia' : 'Normal']}
                    labelFormatter={l => `retorno ${l}%`} />
                  <ReferenceLine x={chart.reduce((a, b) => Math.abs(b.center) < Math.abs(a.center) ? b : a).label}
                    stroke="#3d342a" strokeDasharray="3 3" />
                  <Bar dataKey="count" name="count">
                    {chart.map((c, i) => <Cell key={i} fill={c.up ? '#82c5a4' : '#d97757'} fillOpacity={0.55} />)}
                  </Bar>
                  <Line type="monotone" dataKey="normal" stroke="#e8b86a" strokeWidth={1.8} dot={false} name="normal" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Ajuste Normal + Intervalos de confianza */}
            <div className="rd-side">
              <div className="rd-fit">
                <div><span className="lbl">μ ({freqLabel})</span><span className="val">{pf(fit.mu)}</span></div>
                <div><span className="lbl">σ ({freqLabel})</span><span className="val">{pf(fit.sigma)}</span></div>
                <div><span className="lbl">Obs.</span><span className="val">{fit.n}</span></div>
              </div>
              <table className="pf-table" style={{ marginTop: 8 }}>
                <thead><tr><th>IC</th><th>Rango (μ±kσ)</th><th>Prob.</th></tr></thead>
                <tbody>
                  {cis.map(ci => (
                    <tr key={ci.label}>
                      <td><strong>{ci.label}</strong></td>
                      <td>{pf(ci.lo)} … {pf(ci.hi)}</td>
                      <td>{ci.p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rd-note">Ajuste Normal sobre retornos {freqLabel}es {modeLabel}s. IC por regla empírica (μ±1/2/3σ).</p>
            </div>
          </div>

          {/* Tabla de frecuencias */}
          <details className="rd-freq">
            <summary>Tabla de frecuencias</summary>
            <table className="pf-table">
              <thead><tr><th>Centro</th><th>Frecuencia</th><th>%</th></tr></thead>
              <tbody>
                {chart.map((c, i) => (
                  <tr key={i}>
                    <td className={c.up ? 'up' : 'down'}>{c.label}%</td>
                    <td>{c.count}</td>
                    <td>{((c.count / rets.length) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      {/* ===== Estacionalidad mensual ===== */}
      <div className="rd-season">
        <div className="panel-title" style={{ marginTop: 4 }}>
          <span>Estacionalidad mensual <span className="accent">(retornos mensuales aritméticos)</span></span>
          <span className="rd-season-head">
            {season.bull && <>Alcista: <strong style={{ color: '#82c5a4' }}>{MONTH_LABELS[season.bull.month - 1]}</strong> ({pf(season.bull.mean)}) · </>}
            {season.bear && <>Bajista: <strong style={{ color: '#d97757' }}>{MONTH_LABELS[season.bear.month - 1]}</strong> ({pf(season.bear.mean)})</>}
          </span>
        </div>

        <ResponsiveContainer width="100%" height={170}>
          <ComposedChart data={season.byMonth.map(m => ({ ...m, label: MONTH_LABELS[m.month - 1], meanPct: m.mean == null ? 0 : m.mean * 100 }))}
            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} />
            <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} width={34} tickFormatter={v => `${v.toFixed(1)}%`} />
            <Tooltip contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }}
              labelStyle={{ color: '#e8b86a' }} itemStyle={{ color: '#e8e3d8' }}
              formatter={(v) => [`${Number(v).toFixed(2)}%`, 'Retorno medio']} />
            <ReferenceLine y={0} stroke="#3d342a" />
            <Bar dataKey="meanPct" name="meanPct">
              {season.byMonth.map((m, i) => <Cell key={i} fill={(m.mean ?? 0) >= 0 ? '#82c5a4' : '#d97757'} fillOpacity={0.6} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>

        <div style={{ overflowX: 'auto' }}>
          <table className="pf-table">
            <thead><tr><th>Mes</th>{season.byMonth.map(m => <th key={m.month}>{MONTH_LABELS[m.month - 1]}</th>)}</tr></thead>
            <tbody>
              <tr><td>Retorno medio</td>{season.byMonth.map(m => <td key={m.month} className={(m.mean ?? 0) >= 0 ? 'up' : 'down'}>{m.mean == null ? '—' : pf(m.mean)}</td>)}</tr>
              <tr><td>% meses +</td>{season.byMonth.map(m => <td key={m.month}>{m.pctPositive == null ? '—' : `${(m.pctPositive * 100).toFixed(0)}%`}</td>)}</tr>
            </tbody>
          </table>
        </div>

        <p className="rd-note">
          {season.best && <>Mejor mes individual: <strong style={{ color: '#82c5a4' }}>{season.best.period}</strong> ({pf(season.best.r)}). </>}
          {season.worst && <>Peor: <strong style={{ color: '#d97757' }}>{season.worst.period}</strong> ({pf(season.worst.r)}). </>}
          {season.nMonths < 24 && <strong>Pocos meses de historia — estacionalidad poco robusta.</strong>}
        </p>
      </div>

      <p className="rd-note" style={{ marginTop: 10 }}>
        ⓘ Lectura descriptiva del histórico cargado · educacional, no asesoría. La frecuencia anual requiere historia larga para ser robusta.
      </p>
    </div>
  );
}
