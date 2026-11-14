// Cotação 24h das 10 maiores moedas por valor de mercado (CoinMarketCap, só as que têm contrato
// USDT na Bybit) mais as que o bot acompanha. Um cache só para a faixa, a tabela e o gráfico:
// no máximo uma consulta a cada 25 s, e só com a aba visível.
import { useEffect, useState } from 'react';
import { API } from '../services/api.js';

let last = { at: 0, data: null, pending: null };
async function load() {
  if (last.pending) return last.pending;
  if (last.data && Date.now() - last.at < 25_000) return last.data;
  last.pending = Promise.all([API.get('/api/bybit/tickers?top=10'), API.get('/api/bybit/tickers')]).then(([top, bot]) => {
    const list = [...(top.data || [])];
    for (const t of bot.data || []) if (!list.some(x => x.symbol === t.symbol)) list.push(t);
    const data = { list, top: (top.data || []).map(t => t.symbol), bySymbol: Object.fromEntries(list.map(t => [t.symbol, t])) };
    last = { at: Date.now(), data, pending: null };
    return data;
  }).catch(e => { last.pending = null; throw e; });
  return last.pending;
}

/** { list, top, bySymbol } ou null enquanto carrega. */
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

// Clicar numa moeda da faixa abre ela no gráfico do dashboard.
export const pickChartSymbol = symbol => window.dispatchEvent(new CustomEvent('v2-chart-symbol', { detail: symbol }));
