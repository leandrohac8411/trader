// Ícones simples das moedas (círculo na cor de cada uma + símbolo). Desenho próprio, sem logos oficiais.
const COINS = {
  BTC: { bg: '#F7931A', glyph: '₿' },
  ETH: { bg: '#6F7CF0', glyph: 'Ξ' },
  SOL: { bg: '#1B1D24', glyph: '≡', fg: '#5BE3B8' },
  BNB: { bg: '#F0B90B', glyph: '◆', fg: '#fff' },
  XRP: { bg: '#23292F', glyph: '✕' },
};

export function Coin({ symbol, size = 20 }) {
  const c = symbol?.replace('USDT', '') || '';
  const k = COINS[c] || { bg: '#8a8f98', glyph: c.slice(0, 1) };
  return <span className="v2-coin" aria-hidden="true"
    style={{ '--coin': k.bg, color: k.fg || '#fff', width: size, height: size, fontSize: Math.round(size * 0.55) }}>{k.glyph}</span>;
}
