import { useEffect, useRef } from "react";

export default function TVChart({ exchange = "BINANCE", symbol = "BTCUSDT", interval = "60" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!window.TradingView) {
      console.error("TradingView tv.js não carregou.");
      return;
    }
    const tvSymbol = String(symbol).includes(":") ? symbol : `${exchange}:${symbol}`;
    const id = `tv_${Math.random().toString(36).slice(2)}`;
    containerRef.current.id = id;

    const widget = new window.TradingView.widget({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: "Etc/UTC",
      theme: "light",
      style: "1",
      locale: "en",
      container_id: id,
    });

    return () => {
      try {
        widget.remove?.();
      } catch {
        /* widget já removido */
      }
    };
  }, [exchange, symbol, interval]);

  return <div ref={containerRef} className="w-full h-full" />;
}
