// Faixa de cotações (visual 2): as 10 maiores moedas por valor de mercado, passando devagar,
// com preço e variação de 24h da Bybit, mais o resultado realizado da mesa.
// Passar o mouse pausa; clicar numa moeda abre ela no gráfico.
import useTickers, { pickChartSymbol } from './useTickers.js';
import { Coin } from './coins.jsx';

const fmt = p => p.toLocaleString('pt-BR', { minimumFractionDigits: p < 1 ? 4 : 2, maximumFractionDigits: p < 1 ? 4 : 2 });
const FALLBACK = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT'];

export default function Ticker({ monitor, desk }) {
  const tickers = useTickers();
  const symbols = tickers?.top?.length ? tickers.top : monitor?.symbols || FALLBACK;
  const row = <>
    {symbols.map(symbol => {
      const t = tickers?.bySymbol?.[symbol];
      const it = monitor?.items?.find(i => i.symbol === symbol);
      const price = Number.isFinite(t?.price) ? t.price : Number.isFinite(it?.price) ? it.price : null;
      const ch = t?.change24hPct;
      return <button type="button" className="tick" key={symbol} onClick={() => pickChartSymbol(symbol)} title={`${t?.name || symbol}: abrir no gráfico`}>
        <Coin symbol={symbol} /><b>{symbol}</b><span>{price != null ? fmt(price) : '—'}</span>
        {Number.isFinite(ch) && <em className={ch >= 0 ? 'up' : 'down'}>{ch >= 0 ? '+' : '−'}{Math.abs(ch).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</em>}
      </button>;
    })}
    {desk && <span className="tick tick-desk"><b>Mesa</b><span>{desk}</span></span>}
  </>;
  return <div className="ticker" aria-label="Cotações das maiores moedas">
    <div className="ticker-track">{row}<span aria-hidden="true" className="ticker-copy">{row}</span></div>
  </div>;
}
