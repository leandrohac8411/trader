// Relógio do cabeçalho (visual 2): hora local com segundos.
import { useEffect, useState } from 'react';

export default function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer;
    // alinha a troca com a virada do segundo
    const tick = () => { setNow(new Date()); timer = setTimeout(tick, 1000 - (Date.now() % 1000)); };
    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timer);
  }, []);
  return <time className="v2-clock" dateTime={now.toISOString()} title={now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}>
    {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
  </time>;
}
