// ============================================================
// useYahooQuotes — Hook React para consumir /api/quotes
//
// En producción (Vercel): /api/quotes funciona porque Vercel
//   monta la función serverless en el mismo dominio.
//
// En dev (npm run dev): por defecto Vite no corre las funciones
//   serverless. Dos opciones:
//   1) Usar `vercel dev` en vez de `npm run dev` — corre Vite
//      + las funciones de /api juntas
//   2) Hacer la app funcionar offline con el bundle (fallback)
// ============================================================

import { useState, useCallback, useRef } from 'react';

// Cache en memoria — evita re-fetchear lo mismo en la misma sesión
const cache = new Map();

export function useYahooQuotes() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetchSymbol = useCallback(async (symbol, range = '2y', force = false) => {
    const cacheKey = `${symbol}:${range}`;
    if (!force && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    // Aborta fetch anterior si existe
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const url = `/api/quotes?symbol=${encodeURIComponent(symbol)}&range=${range}`;
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      cache.set(cacheKey, data);
      setLoading(false);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        return null;
      }
      setError(e.message);
      setLoading(false);
      throw e;
    }
  }, []);

  const clearCache = useCallback(() => cache.clear(), []);

  return { fetchSymbol, loading, error, clearCache };
}

// Mapeo de nemo → ticker Yahoo Finance.
// Centralizado en el universo multi-mercado: CL → NEMO.SN, US → NEMO directo.
import { yfSymbol } from '../data/universe.js';

export function yahooSymbolFor(nemo) {
  return yfSymbol(nemo);
}
