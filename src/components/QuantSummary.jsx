import React, { useMemo } from 'react';

// ============================================================
// SUMMARY CUANTITATIVO RULE-BASED
//
// En lugar de llamar a una API de LLM (que requiere key + CORS),
// generamos análisis estructurado a partir de reglas estadísticas.
// Es determinístico, sin costo, y verificable.
//
// Para integrar IA real: añadir un endpoint serverless en
// /api/analyze (Vercel/Netlify Functions) que proxee a Anthropic.
// ============================================================

function classifyRegime(stats, ticker) {
  const tags = [];
  if (stats.annVol < 0.20) tags.push('baja_vol');
  else if (stats.annVol > 0.40) tags.push('alta_vol');
  if (stats.sharpe > 1) tags.push('sharpe_fuerte');
  else if (stats.sharpe < 0) tags.push('sharpe_negativo');
  if (stats.skew < -0.5) tags.push('skew_negativa');
  else if (stats.skew > 0.5) tags.push('skew_positiva');
  if (stats.kurt > 2) tags.push('colas_gordas');
  if (stats.maxDD < -0.30) tags.push('dd_severo');
  return tags;
}

function regimeText(stats, tags) {
  const parts = [];

  // Caracterización de vol/retorno
  if (tags.includes('alta_vol') && tags.includes('sharpe_fuerte')) {
    parts.push(`Perfil de **alto crecimiento con riesgo asumido**: vol anualizada de ${(stats.annVol * 100).toFixed(0)}% es elevada, pero el Sharpe de ${stats.sharpe.toFixed(2)} indica que el retorno compensa esa varianza.`);
  } else if (tags.includes('baja_vol') && stats.sharpe > 0.5) {
    parts.push(`Perfil **defensivo y eficiente**: vol baja (${(stats.annVol * 100).toFixed(0)}%) con Sharpe positivo de ${stats.sharpe.toFixed(2)}. Típico de utilities, bancos grandes, o consumo básico.`);
  } else if (tags.includes('alta_vol') && tags.includes('sharpe_negativo')) {
    parts.push(`Perfil **especulativo destructor de valor** en el período: alta vol (${(stats.annVol * 100).toFixed(0)}%) sin compensación — Sharpe ${stats.sharpe.toFixed(2)}.`);
  } else if (tags.includes('sharpe_negativo')) {
    parts.push(`El activo **no compensa su riesgo** en este período: Sharpe ${stats.sharpe.toFixed(2)}. Retornar lo invertido en un instrumento sin riesgo habría sido mejor.`);
  } else {
    parts.push(`Vol anual de ${(stats.annVol * 100).toFixed(0)}% con Sharpe ${stats.sharpe.toFixed(2)}. Perfil **intermedio**, sin extremos.`);
  }

  // Forma de la distribución
  if (tags.includes('skew_negativa') && tags.includes('colas_gordas')) {
    parts.push(`Distribución con **asimetría negativa** (skew ${stats.skew.toFixed(2)}) y **colas gordas** (kurtosis ${stats.kurt.toFixed(2)}). Esto significa: pérdidas grandes son más comunes y más severas que las ganancias grandes — un patrón típico de activos pre-crisis.`);
  } else if (tags.includes('skew_negativa')) {
    parts.push(`**Skewness negativa** (${stats.skew.toFixed(2)}): la cola izquierda (pérdidas) es más larga que la derecha. Espera más eventos negativos que el promedio sugeriría.`);
  } else if (tags.includes('colas_gordas')) {
    parts.push(`**Colas gordas** (kurtosis ${stats.kurt.toFixed(2)}): los movimientos extremos son más frecuentes que en una normal. VaR/CVaR computados asumiendo normalidad subestimarían el peor caso.`);
  } else if (tags.includes('skew_positiva')) {
    parts.push(`Skewness positiva (${stats.skew.toFixed(2)}): cola derecha más larga — ganancias extremas más probables que pérdidas extremas. Patrón poco común; verificar si no es artefacto.`);
  }

  return parts;
}

function technicalText(latest) {
  const parts = [];
  const tags = [];

  // RSI
  const rsi = latest.rsi;
  if (rsi != null) {
    if (rsi > 70) {
      parts.push(`**RSI ${rsi.toFixed(0)}** en zona de sobrecompra (>70). Históricamente esto antecede pausas o correcciones, aunque puede sostenerse en tendencias fuertes.`);
      tags.push({ label: 'RSI sobrecompra', cls: 'warn' });
    } else if (rsi < 30) {
      parts.push(`**RSI ${rsi.toFixed(0)}** en zona de sobreventa (<30). Lectura de exceso bajista; suele anteceder rebotes técnicos.`);
      tags.push({ label: 'RSI sobreventa', cls: 'bullish' });
    } else {
      parts.push(`RSI en ${rsi.toFixed(0)} — zona neutra.`);
    }
  }

  // MACD
  if (latest.macd != null && latest.macdSig != null) {
    const macdAboveSig = latest.macd > latest.macdSig;
    const macdAbove0 = latest.macd > 0;
    if (macdAboveSig && macdAbove0) {
      parts.push(`**MACD por sobre signal y sobre cero**: momentum alcista activo.`);
      tags.push({ label: 'MACD alcista', cls: 'bullish' });
    } else if (!macdAboveSig && !macdAbove0) {
      parts.push(`**MACD bajo signal y bajo cero**: momentum bajista vigente.`);
      tags.push({ label: 'MACD bajista', cls: 'bearish' });
    } else if (macdAboveSig && !macdAbove0) {
      parts.push(`MACD sobre signal pero aún bajo cero: posible **giro alcista incipiente**.`);
      tags.push({ label: 'Giro alcista?', cls: 'warn' });
    } else {
      parts.push(`MACD bajo signal pero sobre cero: posible **debilitamiento de tendencia alcista**.`);
      tags.push({ label: 'Debilitamiento', cls: 'warn' });
    }
  }

  // Posición vs MAs
  if (latest.sma20 != null && latest.sma50 != null) {
    const aboveSma20 = latest.close > latest.sma20;
    const aboveSma50 = latest.close > latest.sma50;
    const ma20AboveMa50 = latest.sma20 > latest.sma50;

    if (aboveSma20 && aboveSma50 && ma20AboveMa50) {
      parts.push(`Precio sobre SMA20 y SMA50, con SMA20 sobre SMA50: **estructura técnica alcista limpia**.`);
      tags.push({ label: 'Estructura alcista', cls: 'bullish' });
    } else if (!aboveSma20 && !aboveSma50 && !ma20AboveMa50) {
      parts.push(`Precio bajo ambas medias móviles con SMA20 < SMA50: **estructura bajista**.`);
      tags.push({ label: 'Estructura bajista', cls: 'bearish' });
    } else {
      parts.push(`Estructura técnica **mixta** entre medias móviles — sin sesgo claro.`);
    }
  }

  // Bollinger
  if (latest.bbUp != null && latest.bbLo != null) {
    const bbPos = (latest.close - latest.bbLo) / (latest.bbUp - latest.bbLo);
    if (bbPos > 0.95) {
      parts.push(`Precio tocando **banda superior de Bollinger**: lectura de extremo. Si la tendencia es fuerte, puede caminar la banda; si no, retroceso esperable.`);
    } else if (bbPos < 0.05) {
      parts.push(`Precio tocando **banda inferior de Bollinger**: lectura de extremo bajista.`);
    }
  }

  return { parts, tags };
}

function riskText(stats, latest) {
  const parts = [];

  // VaR/CVaR interpretation
  const varBps = stats.var95 * 10000;
  const cvarBps = stats.cvar95 * 10000;
  parts.push(`Bajo distribución histórica: con 95% de confianza, la pérdida diaria no debería superar **${Math.abs(varBps).toFixed(0)} bps** (VaR). Pero en el 5% peor de los días, la pérdida promedio es **${Math.abs(cvarBps).toFixed(0)} bps** (CVaR) — esa es la magnitud de un día verdaderamente malo.`);

  // Max DD context
  parts.push(`El **drawdown máximo observado** fue ${(stats.maxDD * 100).toFixed(1)}%. Recuperarse de un -${Math.abs(stats.maxDD * 100).toFixed(0)}% requiere subir +${(stats.maxDD / (1 + stats.maxDD) * -100).toFixed(1)}% sobre el piso. Considera esto al dimensionar.`);

  // Kurtosis warning
  if (stats.kurt > 2) {
    const factor = Math.sqrt((stats.kurt + 3) / 3);
    parts.push(`⚠️ La kurtosis (${stats.kurt.toFixed(1)}) indica que el VaR paramétrico (normal) subestimaría las pérdidas extremas. Ajuste empírico sugerido: usa el CVaR histórico, no fórmulas cerradas con σ.`);
  }

  // ATR como % del precio
  if (latest.atr && latest.close) {
    const atrPct = (latest.atr / latest.close) * 100;
    parts.push(`ATR actual: **${atrPct.toFixed(2)}% del precio**. Un stop a 2×ATR equivale a ${(atrPct * 2).toFixed(1)}% — verifica que esté fuera del ruido pero dentro de tu tesis.`);
  }

  return parts;
}

export default function QuantSummary({ stats, latest, tickerSymbol }) {
  const analysis = useMemo(() => {
    if (!stats || !latest) return null;
    const regimeTags = classifyRegime(stats);
    const regime = regimeText(stats, regimeTags);
    const tech = technicalText(latest);
    const risk = riskText(stats, latest);
    return { regime, tech, risk };
  }, [stats, latest]);

  if (!analysis) return null;

  return (
    <div className="panel">
      <div className="panel-title">
        <span>Resumen cuantitativo <span className="accent">{tickerSymbol}</span></span>
        <span>rule-based · deterministic</span>
      </div>

      <div className="summary-body">
        <h4>1 — Régimen estadístico</h4>
        {analysis.regime.map((p, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: markdownToHtml(p) }} />
        ))}

        <h4>2 — Lectura técnica</h4>
        {analysis.tech.parts.map((p, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: markdownToHtml(p) }} />
        ))}
        {analysis.tech.tags.length > 0 && (
          <div className="signal-badges">
            {analysis.tech.tags.map((t, i) => (
              <span key={i} className={`badge ${t.cls}`}>{t.label}</span>
            ))}
          </div>
        )}

        <h4>3 — Riesgo asimétrico</h4>
        {analysis.risk.map((p, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: markdownToHtml(p) }} />
        ))}
      </div>
    </div>
  );
}

function markdownToHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
