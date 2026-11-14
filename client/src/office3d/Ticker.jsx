// Faixa de cotações (visual 2): os mercados que a Alice lê, com preço e variação de 24h da Bybit,
// mais o resultado realizado da mesa. Sem cotação, mostra o mercado sem preço.
import useTickers from './useTickers.js';
import { Coin } from './coins.jsx';

const fmt = p => p.toLocaleString('pt-BR', { minimumFractionDigits: p < 10 ? 4 : 2, maximumFractionDigits: p < 10 ? 4 : 2 });

export default function Ticker({ monitor, desk }) {
  const tickers = useTickers();
  const symbols = monitor?.symbols || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  const row = <>
    {symbols.map(symbol => {
      const t = tickers?.[symbol];
      const it = monitor?.items?.find(i => i.symbol === symbol);
      const price = Number.isFinite(t?.price) ? t.price : Number.isFinite(it?.price) ? it.price : null;
      const ch = t?.change24hPct;
      return <span className="tick" key={symbol}>
        <Coin symbol={symbol} /><b>{symbol}</b><span>{price != null ? fmt(price) : '—'}</span>
        {Number.isFinite(ch) && <em className={ch >= 0 ? 'up' : 'down'}>{ch >= 0 ? '+' : '−'}{Math.abs(ch).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</em>}
      </span>;
    })}
    {desk && <span className="tick tick-desk"><b>Mesa</b><span>{desk}</span></span>}
  </>;
  return <div className="ticker" aria-label="Cotações acompanhadas pela equipe">
    <div className="ticker-track">{row}<span aria-hidden="true" className="ticker-copy">{row}</span></div>
  </div>;
}
