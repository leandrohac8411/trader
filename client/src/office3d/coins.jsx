// Ícones simples das moedas (círculo na cor de cada uma + símbolo). Desenho próprio, sem logos oficiais.
const COINS = {
  BTC: { bg: '#F7931A', glyph: '₿' },
  ETH: { bg: '#6F7CF0', glyph: 'Ξ' },
  SOL: { bg: '#1B1D24', glyph: '≡', fg: '#5BE3B8' },
  BNB: { bg: '#F0B90B', glyph: '◆', fg: '#fff' },
  XRP: { bg: '#23292F', glyph: '✕' },
  TRX: { bg: '#EB0029', glyph: '▼' },
  DOGE: { bg: '#C2A633', glyph: 'Ð' },
  ADA: { bg: '#0033AD', glyph: '₳' },
  LINK: { bg: '#2A5ADA', glyph: '⬡' },
  HYPE: { bg: '#0F3D36', glyph: 'H', fg: '#97FCE4' },
  ZEC: { bg: '#ECB244', glyph: 'ⓩ' },
  XMR: { bg: '#FF6600', glyph: 'ɱ' },
  XLM: { bg: '#14161B', glyph: '✦' },
  LTC: { bg: '#345D9D', glyph: 'Ł' },
  BCH: { bg: '#0AC18E', glyph: '₿' },
  AVAX: { bg: '#E84142', glyph: 'A' },
  SUI: { bg: '#4DA2FF', glyph: 'S' },
};
const PALETTE = ['#5B6CFF', '#E0763A', '#2BA07A', '#B0488F', '#3C8DBC', '#8A6D3B'];

export function Coin({ symbol, size = 20 }) {
  const c = symbol?.replace('USDT', '') || '';
  const k = COINS[c] || { bg: PALETTE[[...c].reduce((s, ch) => s + ch.charCodeAt(0), 0) % PALETTE.length], glyph: c.slice(0, 1) };
  return <span className="v2-coin" aria-hidden="true"
    style={{ '--coin': k.bg, color: k.fg || '#fff', width: size, height: size, fontSize: Math.round(size * 0.55) }}>{k.glyph}</span>;
}
