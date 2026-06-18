import React, { useState } from 'react';

export default function PositionSizing({ latest, currency = 'CLP' }) {
  const [account, setAccount] = useState(currency === 'CLP' ? 50_000_000 : 50_000);
  const [riskPct, setRiskPct] = useState(1);
  const [atrMult, setAtrMult] = useState(2);

  const stopDist = latest.atr ? latest.atr * atrMult : 0;
  const riskAmt = account * (riskPct / 100);
  const shares = stopDist > 0 ? Math.floor(riskAmt / stopDist) : 0;
  const posValue = shares * latest.close;
  const leverage = account > 0 ? posValue / account : 0;

  const fmt = (v) => currency === 'CLP'
    ? '$' + v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });

  return (
    <div className="panel">
      <div className="panel-title">
        <span>Position Sizing <span className="accent">ATR-based</span></span>
      </div>

      <div className="field">
        <label>Cuenta ({currency})</label>
        <input type="number" value={account} onChange={e => setAccount(Math.max(0, +e.target.value || 0))} />
      </div>
      <div className="field">
        <label>Riesgo por trade (%)</label>
        <input type="number" step="0.1" value={riskPct} onChange={e => setRiskPct(Math.max(0.01, +e.target.value || 0))} />
      </div>
      <div className="field">
        <label>Stop loss (× ATR)</label>
        <input type="number" step="0.5" value={atrMult} onChange={e => setAtrMult(Math.max(0.5, +e.target.value || 0))} />
      </div>

      <div className="sizing-output">
        <div className="sizing-row">
          <span className="k">ATR(14)</span>
          <span className="v">{fmt(latest.atr ?? 0)}</span>
        </div>
        <div className="sizing-row">
          <span className="k">Distancia stop</span>
          <span className="v">{fmt(stopDist)}</span>
        </div>
        <div className="sizing-row">
          <span className="k">Riesgo $</span>
          <span className="v">{fmt(riskAmt)}</span>
        </div>
        <div className="sizing-row highlight">
          <span className="k">Tamaño</span>
          <span className="v">{shares.toLocaleString()} sh</span>
        </div>
        <div className="sizing-row">
          <span className="k">Capital empleado</span>
          <span className="v">{fmt(posValue)}</span>
        </div>
        <div className="sizing-row">
          <span className="k">Apalancamiento</span>
          <span className="v">{leverage.toFixed(2)}x</span>
        </div>
      </div>
    </div>
  );
}
