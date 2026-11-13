import { useState } from 'react';
import MarketRadar from './MarketRadar.jsx';
import TraderChart from './TraderChart.jsx';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const INTERVALS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['60', '1h'], ['240', '4h']];

// Aba Mercado: o radar da Alice em cima e o gráfico de velas reais logo abaixo.
// Clicar num ativo do radar troca o gráfico (não sai da aba).
export default function MarketView({ snapshot, connected, onInterval, notifications, onNotifications }) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setTf] = useState('60');
  const [signal, setSignal] = useState(null);
  const fresh = connected && signal?.chartSymbol === symbol && signal?.chartInterval === interval;
  const reading = !fresh ? 'Consultando a estratégia…' : signal.signal === 'LONG' ? 'Sinal de compra' : signal.signal === 'SHORT' ? 'Sinal de venda' : 'Sem entrada agora';
  const pick = s => { setSymbol(s); setSignal(null); document.getElementById('market-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <>
    <MarketRadar monitor={snapshot?.monitor} connected={connected} onInterval={onInterval} notifications={notifications} onNotifications={onNotifications} onSelect={pick} />
    <section className="market-chart-panel" id="market-chart" aria-label="Gráfico de velas">
      <div className="market-chart-controls">
        <div className="market-symbols" role="tablist" aria-label="Ativo">{SYMBOLS.map(s => <button key={s} role="tab" aria-selected={symbol === s} className={symbol === s ? 'is-active' : ''} onClick={() => { setSymbol(s); setSignal(null); }}>{s.replace('USDT', '')}</button>)}</div>
        <div className="market-symbols" role="tablist" aria-label="Período">{INTERVALS.map(([v, l]) => <button key={v} role="tab" aria-selected={interval === v} className={interval === v ? 'is-active' : ''} onClick={() => { setTf(v); setSignal(null); }}>{l}</button>)}</div>
      </div>
      <TraderChart symbol={symbol} interval={interval} connected={connected} onSignal={setSignal} />
      <div className="market-reading"><small>LEITURA DA ESTRATÉGIA NESTE GRÁFICO</small><strong>{reading}</strong>
        <span>{fresh ? `Consenso ${signal.consensus} · score ${signal.probability}/100 · o bot opera em 1h e 4h` : `${symbol.replace('USDT', '')} · ${INTERVALS.find(i => i[0] === interval)?.[1]}`}</span></div>
    </section>
  </>;
}
