import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';
import {
  monteCarloGBM, pathsToPercentiles, closedFormCone,
  garchFit, garchForecast, naiveCone, probAbove, ewmaVol
} from '../lib/projections.js';
import { dailyReturns } from '../lib/stats.js';

export default function ProjectionsPanel({ bars, currency = 'CLP' }) {
  const [horizon, setHorizon] = useState(60);      // días forward
  const [paths, setPaths] = useState(500);
  const [showMC, setShowMC] = useState(true);
  const [showCone, setShowCone] = useState(true);
  const [showNaive, setShowNaive] = useState(true);
  const [targetPct, setTargetPct] = useState(10);   // % sobre precio actual

  const closes = bars.map(b => b.close);
  const returns = dailyReturns(closes);
  const S0 = closes[closes.length - 1];

  // Calibración: μ y σ anualizados desde retornos históricos
  const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varR = returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1);
  const mu = meanR * 252;
  const sigma = Math.sqrt(varR) * Math.sqrt(252);

  // GARCH fit
  const garch = useMemo(() => {
    try {
      return garchFit(returns);
    } catch (e) {
      return null;
    }
  }, [returns]);

  // EWMA actual (último valor)
  const ewmaSeries = useMemo(() => ewmaVol(returns, 0.94), [returns]);
  const currentEwmaVol = ewmaSeries[ewmaSeries.length - 1] * Math.sqrt(252);

  // GARCH forecast multi-step
  const garchFc = useMemo(() => {
    if (!garch) return null;
    const variance = returns.reduce((a, b) => a + b * b, 0) / returns.length;
    const currentVar = ewmaSeries[ewmaSeries.length - 1] ** 2;
    const currentReturn = returns[returns.length - 1];
    return garchForecast({
      params: garch,
      currentReturn,
      currentVar,
      horizon: Math.min(horizon, 100)
    });
  }, [garch, returns, ewmaSeries, horizon]);

  // Combinar histórico + proyección en un solo dataset
  const chartData = useMemo(() => {
    const lookback = Math.min(60, bars.length);
    const hist = bars.slice(-lookback).map((b, i) => ({
      t: i - lookback + 1,
      historical: b.close,
      date: b.date,
    }));

    // Proyección closed-form
    const cone = closedFormCone({ S0, mu, sigma, days: horizon });
    const naive = showNaive ? naiveCone({ S0, sigma, days: horizon, percentiles: [5, 95] }) : null;

    // Monte Carlo
    let mcPct = null;
    if (showMC) {
      const mcPaths = monteCarloGBM({ S0, mu, sigma, days: horizon, paths });
      mcPct = pathsToPercentiles(mcPaths, [5, 50, 95]);
    }

    const forward = [];
    for (let i = 0; i <= horizon; i++) {
      const row = { t: i };
      if (i === 0) row.historical = S0;
      if (showCone) {
        row.cone_p5 = cone[i].p5;
        row.cone_p25 = cone[i].p25;
        row.cone_p50 = cone[i].p50;
        row.cone_p75 = cone[i].p75;
        row.cone_p95 = cone[i].p95;
        row.cone_p5_p25 = cone[i].p25 - cone[i].p5;
        row.cone_p25_p75 = cone[i].p75 - cone[i].p25;
        row.cone_p75_p95 = cone[i].p95 - cone[i].p75;
      }
      if (showNaive && naive) {
        row.naive_p5 = naive[i].p5;
        row.naive_p95 = naive[i].p95;
      }
      if (showMC && mcPct) {
        row.mc_p5 = mcPct[i].p5;
        row.mc_p50 = mcPct[i].p50;
        row.mc_p95 = mcPct[i].p95;
      }
      forward.push(row);
    }

    return [...hist, ...forward];
  }, [bars, S0, mu, sigma, horizon, paths, showMC, showCone, showNaive]);

  // Probabilidad de exceder target
  const targetPrice = S0 * (1 + targetPct / 100);
  const probUp = probAbove({ S0, mu, sigma, days: horizon, target: targetPrice });
  const probDown = 1 - probAbove({ S0, mu, sigma, days: horizon, target: S0 * (1 - targetPct / 100) });

  const fmt = (v) => v == null ? '—' : currency === 'CLP'
    ? '$' + Math.round(v).toLocaleString('es-CL')
    : '$' + v.toFixed(2);

  // Cono al final del horizonte (para el resumen)
  const endIdx = chartData.length - 1;
  const endRow = chartData[endIdx];

  return (
    <div className="panel">
      <div className="panel-title">
        <span>Proyecciones probabilísticas <span className="accent">{horizon}d</span></span>
        <span>μ <strong>{(mu * 100).toFixed(1)}%</strong> · σ <strong>{(sigma * 100).toFixed(1)}%</strong>
          {garch && <> · ω <strong>{(garch.omega * 1e6).toFixed(2)}e-6</strong> · α <strong>{garch.alpha.toFixed(2)}</strong> · β <strong>{garch.beta.toFixed(2)}</strong></>}
        </span>
      </div>

      <div className="proj-controls">
        <div className="field">
          <label>Horizonte (días)</label>
          <select value={horizon} onChange={e => setHorizon(+e.target.value)}>
            <option value={21}>21 (1 mes)</option>
            <option value={63}>63 (3 meses)</option>
            <option value={126}>126 (6 meses)</option>
            <option value={252}>252 (1 año)</option>
          </select>
        </div>
        <div className="field">
          <label>Caminos MC</label>
          <select value={paths} onChange={e => setPaths(+e.target.value)}>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
            <option value={2000}>2000</option>
          </select>
        </div>
        <div className="field">
          <label>Target ± (%)</label>
          <input type="number" step="1" value={targetPct} onChange={e => setTargetPct(+e.target.value || 0)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8 }}>
          <label className="proj-toggle">
            <input type="checkbox" checked={showCone} onChange={e => setShowCone(e.target.checked)} />
            Cono GBM
          </label>
          <label className="proj-toggle">
            <input type="checkbox" checked={showMC} onChange={e => setShowMC(e.target.checked)} />
            Monte Carlo
          </label>
          <label className="proj-toggle">
            <input type="checkbox" checked={showNaive} onChange={e => setShowNaive(e.target.checked)} />
            Naive (μ=0)
          </label>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={chartData} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="t"
            stroke="#3a3530"
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#6b6558' }}
            tickFormatter={v => v === 0 ? 'HOY' : (v > 0 ? '+' + v + 'd' : v + 'd')}
            ticks={[-60, -30, 0, Math.floor(horizon / 4), Math.floor(horizon / 2), Math.floor(3 * horizon / 4), horizon]}
          />
          <YAxis
            stroke="#3a3530"
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#6b6558' }}
            domain={['auto', 'auto']}
            tickFormatter={v => currency === 'CLP' ? Math.round(v).toLocaleString('es-CL') : v.toFixed(0)}
            width={60}
          />
          <Tooltip
            contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }}
            labelStyle={{ color: '#e8b86a' }}
            itemStyle={{ color: '#e8e3d8' }}
            formatter={(v, name) => v != null ? [fmt(v), name] : ['—', name]}
            labelFormatter={t => t === 0 ? 'HOY' : (t > 0 ? `+${t} días` : `${t} días`)}
          />
          <ReferenceLine x={0} stroke="#e8b86a" strokeWidth={1} strokeDasharray="4 4" />

          {/* Cono GBM: bandas apiladas */}
          {showCone && <>
            <Area type="monotone" dataKey="cone_p5" stroke="none" fill="#0d0c0a" fillOpacity={0} stackId="1" name="p5" />
            <Area type="monotone" dataKey="cone_p5_p25" stroke="none" fill="#e8b86a" fillOpacity={0.08} stackId="1" name="p5-p25" />
            <Area type="monotone" dataKey="cone_p25_p75" stroke="none" fill="#e8b86a" fillOpacity={0.18} stackId="1" name="p25-p75" />
            <Area type="monotone" dataKey="cone_p75_p95" stroke="none" fill="#e8b86a" fillOpacity={0.08} stackId="1" name="p75-p95" />
            <Line type="monotone" dataKey="cone_p50" stroke="#e8b86a" strokeWidth={1.5} dot={false} name="Mediana GBM" strokeDasharray="0" />
          </>}

          {/* Naive: solo bordes de 5/95 */}
          {showNaive && <>
            <Line type="monotone" dataKey="naive_p5" stroke="#d97757" strokeWidth={1} dot={false} strokeDasharray="2 4" name="Naive p5" />
            <Line type="monotone" dataKey="naive_p95" stroke="#d97757" strokeWidth={1} dot={false} strokeDasharray="2 4" name="Naive p95" />
          </>}

          {/* Monte Carlo: solo mediana como verificación */}
          {showMC && <Line type="monotone" dataKey="mc_p50" stroke="#82c5a4" strokeWidth={1} dot={false} strokeDasharray="3 3" name="Mediana MC" />}

          {/* Histórico */}
          <Line type="monotone" dataKey="historical" stroke="#e8e3d8" strokeWidth={1.8} dot={false} name="Precio" />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="proj-summary">
        <div className="proj-stat">
          <span className="lbl">P(precio ≥ +{targetPct}%) en {horizon}d</span>
          <span className="val">{(probUp * 100).toFixed(1)}%</span>
        </div>
        <div className="proj-stat">
          <span className="lbl">P(precio ≤ -{targetPct}%) en {horizon}d</span>
          <span className="val">{(probDown * 100).toFixed(1)}%</span>
        </div>
        <div className="proj-stat">
          <span className="lbl">Mediana en {horizon}d</span>
          <span className="val">{fmt(endRow?.cone_p50)}</span>
        </div>
        <div className="proj-stat">
          <span className="lbl">Rango 90% en {horizon}d</span>
          <span className="val" style={{ fontSize: 12 }}>{fmt(endRow?.cone_p5)} — {fmt(endRow?.cone_p95)}</span>
        </div>
        {garchFc && <div className="proj-stat">
          <span className="lbl">Vol GARCH(1,1) en {horizon}d</span>
          <span className="val">{(garchFc[garchFc.length - 1].vol * Math.sqrt(252) * 100).toFixed(1)}%</span>
        </div>}
        <div className="proj-stat">
          <span className="lbl">Vol EWMA actual (λ=0.94)</span>
          <span className="val">{(currentEwmaVol * 100).toFixed(1)}%</span>
        </div>
      </div>

      <p style={{
        marginTop: 14, fontSize: 11, color: '#6b6558',
        fontFamily: 'JetBrains Mono', lineHeight: 1.6, letterSpacing: 0.04
      }}>
        ⓘ Los conos asumen GBM con μ y σ históricos constantes. La banda dorada cubre 90% / 50% / 10% de probabilidad
        (p5-p95, p25-p75). La línea roja punteada es el benchmark <strong style={{ color: '#d97757' }}>naive (μ=0)</strong>:
        si la "tendencia" histórica fuera ruido, el cono se vería así. <strong style={{ color: '#82c5a4' }}>Monte Carlo</strong> y
        cono cerrado deben coincidir — son la misma matemática por dos caminos.
      </p>
    </div>
  );
}
