import React from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, ComposedChart, Cell
} from 'recharts';

export default function IndicatorsRow({ enriched, hist, latest, statsN }) {
  const interval = Math.floor(enriched.length / 6);

  return (
    <div className="grid-indicators">
      {/* RSI */}
      <div className="panel">
        <div className="panel-title">
          <span>RSI <span className="accent">14</span></span>
          <span><strong>{latest.rsi?.toFixed(1) ?? '—'}</strong></span>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={enriched} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} tickFormatter={d => d.slice(5)} interval={interval} />
            <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} width={28} />
            <Tooltip contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }} labelStyle={{ color: '#e8b86a' }} formatter={v => v?.toFixed(1) ?? '—'} />
            <ReferenceLine y={70} stroke="#d97757" strokeDasharray="3 3" strokeWidth={0.8} strokeOpacity={0.7} />
            <ReferenceLine y={30} stroke="#82c5a4" strokeDasharray="3 3" strokeWidth={0.8} strokeOpacity={0.7} />
            <ReferenceLine y={50} stroke="#2a2620" strokeWidth={0.6} />
            <Line type="monotone" dataKey="rsi" stroke="#e8b86a" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* MACD */}
      <div className="panel">
        <div className="panel-title">
          <span>MACD <span className="accent">12/26/9</span></span>
          <span>Hist: <strong style={{ color: (latest.macdHist ?? 0) >= 0 ? '#82c5a4' : '#d97757' }}>{latest.macdHist?.toFixed(3) ?? '—'}</strong></span>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={enriched} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} tickFormatter={d => d.slice(5)} interval={interval} />
            <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} width={36} />
            <Tooltip contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }} labelStyle={{ color: '#e8b86a' }} formatter={v => v?.toFixed(3) ?? '—'} />
            <ReferenceLine y={0} stroke="#2a2620" strokeWidth={0.8} />
            <Bar dataKey="macdHist">
              {enriched.map((d, i) => (
                <Cell key={i} fill={(d.macdHist ?? 0) >= 0 ? '#82c5a4' : '#d97757'} fillOpacity={0.45} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="macd" stroke="#e8b86a" strokeWidth={1.4} dot={false} />
            <Line type="monotone" dataKey="macdSig" stroke="#e8e3d8" strokeWidth={1} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Distribución de retornos */}
      <div className="panel">
        <div className="panel-title">
          <span>Distribución retornos</span>
          <span>n=<strong>{statsN}</strong></span>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="pct" stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} tickFormatter={v => v.toFixed(1) + '%'} interval={Math.floor(hist.length / 6)} />
            <YAxis stroke="#3a3530" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: '#6b6558' }} width={28} />
            <Tooltip contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }} labelStyle={{ color: '#e8b86a' }} formatter={v => v + ' días'} labelFormatter={v => v.toFixed(2) + '%'} />
            <ReferenceLine x={0} stroke="#e8b86a" strokeWidth={1} strokeDasharray="2 2" />
            <Bar dataKey="count">
              {hist.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.55} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
