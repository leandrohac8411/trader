// Cotação 24h dos mercados (visual 2). Um cache só para a faixa e a tabela: no máximo uma
// consulta a cada 25 s, e só com a aba visível.
import { useEffect, useState } from 'react';
import { API } from '../services/api.js';

let last = { at: 0, data: null, pending: null };
async function load() {
  if (last.pending) return last.pending;
  if (last.data && Date.now() - last.at < 25_000) return last.data;
  last.pending = API.get('/api/bybit/tickers').then(j => {
    last = { at: Date.now(), data: Object.fromEntries((j.data || []).map(t => [t.symbol, t])), pending: null };
    return last.data;
  }).catch(e => { last.pending = null; throw e; });
  return last.pending;
}

export default function useTickers() {
  const [tickers, setTickers] = useState(last.data);
  useEffect(() => {
    let alive = true;
    const run = () => { if (!document.hidden) load().then(d => alive && setTickers(d)).catch(() => {}); };
    run();
    const timer = setInterval(run, 30_000);
    document.addEventListener('visibilitychange', run);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', run); };
  }, []);
  return tickers;
}
