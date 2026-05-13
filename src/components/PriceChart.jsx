import React from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';

export default function PriceChart({ enriched, currency = 'CLP' }) {
  const interval = Math.floor(enriched.length / 8);
  const fmt = v => v == null ? '—' : currency === 'CLP'
    ? '$' + Math.round(v).toLocaleString('es-CL')
    : '$' + Number(v).toFixed(2);

  return (
    <div className="panel">
      <div className="panel-title">
        <span>Precio · <span className="accent">SMA20 / SMA50 / Bollinger 2σ</span></span>
        <span>{enriched.length} días</span>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={enriched} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            stroke="#3a3530"
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#6b6558' }}
            tickFormatter={d => d.slice(5)}
            interval={interval}
          />
          <YAxis
            stroke="#3a3530"
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#6b6558' }}
            domain={['auto', 'auto']}
            tickFormatter={v => currency === 'CLP' ? Math.round(v).toLocaleString('es-CL') : v.toFixed(0)}
            width={62}
          />
          <Tooltip
            contentStyle={{ background: '#0d0c0a', border: '1px solid #e8b86a', fontFamily: 'JetBrains Mono', fontSize: 11 }}
            labelStyle={{ color: '#e8b86a' }}
            itemStyle={{ color: '#e8e3d8' }}
            formatter={(v) => fmt(v)}
          />
          <Line type="monotone" dataKey="bbUp" stroke="#4a4338" strokeWidth={1} dot={false} strokeDasharray="3 4" name="BB +2σ" />
          <Line type="monotone" dataKey="bbLo" stroke="#4a4338" strokeWidth={1} dot={false} strokeDasharray="3 4" name="BB -2σ" />
          <Line type="monotone" dataKey="sma50" stroke="#82c5a4" strokeWidth={1.2} dot={false} name="SMA 50" />
          <Line type="monotone" dataKey="sma20" stroke="#e8b86a" strokeWidth={1.2} dot={false} name="SMA 20" />
          <Line type="monotone" dataKey="close" stroke="#e8e3d8" strokeWidth={1.6} dot={false} name="Close" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
