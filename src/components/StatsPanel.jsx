import React from 'react';

function Row({ k, v, color = '' }) {
  return (
    <div className="stat-row">
      <span className="k">{k}</span>
      <span className={`v ${color}`}>{v}</span>
    </div>
  );
}

export default function StatsPanel({ stats, yearChg }) {
  if (!stats) return null;
  return (
    <div className="panel">
      <div className="panel-title">
        <span>Estadísticas</span>
        <span className="accent">{stats.n + 1}d</span>
      </div>
      <div className="stats-table">
        <Row k="Retorno (1Y)" v={`${(yearChg * 100).toFixed(2)}%`} color={yearChg >= 0 ? 'up' : 'down'} />
        <Row k="Retorno anual. (aritm.)" v={`${(stats.annReturn * 100).toFixed(2)}%`} color={stats.annReturn >= 0 ? 'up' : 'down'} />
        <Row k="Volatilidad anual." v={`${(stats.annVol * 100).toFixed(2)}%`} />
        <Row k="Sharpe (rf=4%)" v={stats.sharpe.toFixed(2)} color={stats.sharpe >= 1 ? 'up' : stats.sharpe < 0 ? 'down' : ''} />
        <Row k="Sortino" v={isFinite(stats.sortino) ? stats.sortino.toFixed(2) : '—'} />
        <Row k="Calmar" v={isFinite(stats.calmar) ? stats.calmar.toFixed(2) : '—'} />
        <Row k="Max Drawdown" v={`${(stats.maxDD * 100).toFixed(2)}%`} color="down" />
        <Row k="VaR 95% diario" v={`${(stats.var95 * 100).toFixed(2)}%`} color="down" />
        <Row k="CVaR 95% diario" v={`${(stats.cvar95 * 100).toFixed(2)}%`} color="down" />
        <Row k="Skewness" v={stats.skew.toFixed(2)} color={stats.skew > 0.2 ? 'up' : stats.skew < -0.2 ? 'down' : ''} />
        <Row k="Kurtosis (exc.)" v={stats.kurt.toFixed(2)} />
      </div>
    </div>
  );
}
