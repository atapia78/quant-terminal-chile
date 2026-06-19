# Metodología de análisis financiero — referencia del proyecto
Convenciones que sigue Quant Terminal. Autocontenido: implementar desde acá, sin material externo.
## Retornos
- Aritmético: r = P_t / P_(t-1) − 1
- Logarítmico: r = ln(P_t / P_(t-1)). Aditivos en el tiempo; coinciden con el aritmético en períodos cortos y divergen al alargar el horizonte. Para distribución/estadística, log por defecto.
- Totales: idealmente con dividendos (precio ajustado). Para comparar mercados, misma moneda.
## CAGR / media geométrica
- CAGR = (P_final / P_inicial)^(1/años) − 1, años = Δfecha/365.25.
- Es la media geométrica de los retornos = el compuesto REAL. El aritmético anualizado (media·252) lo SOBREESTIMA.
- Brecha (aritmético − geométrico) ≈ drag por volatilidad ≈ σ²/2 anual. Mostrar ambos y la brecha en pb.
## Tendencia central y dispersión
- Centrales: media aritmética, media geométrica, mediana.
- Dispersión: varianza muestral s² = Σ(x−x̄)²/(n−1) y poblacional σ² = Σ(x−μ)²/N; desviación estándar; rango.
## Distribución de retornos
- Histograma de frecuencias MENSUAL y ANUAL (ambos a la vez).
- Ajuste Normal X ~ N(μ, σ): μ = media, σ = s muestral de la serie elegida (default mensual log). Superponer la curva.
## Intervalos de confianza (regla empírica Normal)
- IC68 = [μ−σ, μ+σ] (68,26%)
- IC95 = [μ−2σ, μ+2σ] (95,44%)
- IC99 = [μ−3σ, μ+3σ] (99,74%)
## Estacionalidad
- Retorno medio por mes calendario (Ene…Dic) y % de meses positivos.
- Mes alcista (mayor media) y bajista (menor); mejor y peor mes individual con su fecha.
## Cartera (Markowitz) — módulo de riesgo de cartera
- Covarianza muestral: s_xy = Σ(x−x̄)(y−ȳ)/(n−1). Matriz de varianza-covarianza Ω.
- Retorno de cartera: R_P = wᵀμ (w = pesos). Riesgo: σ_P = √(wΩwᵀ). Correlación entre pares.
## Money-weighted vs time-weighted — módulo de TIR
- CAGR = time-weighted (buy-and-hold); no pondera aportes.
- TIR/IRR = money-weighted: tasa que hace VAN=0 sobre los flujos (aportes/retiros con fecha). Refleja el timing real de las compras.
- Cautelas TIR: supone reinversión a la propia TIR, puede haber múltiples TIR, no da tamaño relativo, ranking puede diferir del VAN.
## Honestidad (transversal)
- Mostrar distribución/incertidumbre, no certezas puntuales. Comparar contra naive (μ=0) para separar señal de ruido.
- Data viva (↻ LIVE) > bundle sintético; marcar "ilustrativo" si es bundle.
- Flags de robustez: "histórico corto" (<5 años para anual/estacionalidad); "serie acotada por discontinuidad" ante quiebres estructurales (ej. LTM: reestructuración Chapter 11, salida 3-nov-2022, dilución masiva — histórico previo no comparable).

## TIR de cartera con FX (money-weighted, base CLP)
- Un único retorno money-weighted de toda la cartera: se juntan los flujos de TODAS las posiciones (cada lote = −cantidad×precio en su fecha; hoy = +valor de mercado total) y se convierten a una moneda base (CLP) con el tipo de cambio USD/CLP de CADA fecha (`fxAt`), no con el TC de hoy. La TIR sale de `xirr` sobre esos flujos en CLP.
- Referencia time-weighted: promedio de las CAGR por activo ponderado por valor de mercado en CLP — es aproximación, NO un NAV reconstruido.
- Cautela: al convertir con TC histórico, el tipo de cambio aporta su PROPIO retorno y riesgo a la TIR en CLP (no es solo el de los activos). Si falta la serie FX, se reporta TIR por moneda por separado, sin consolidar.
