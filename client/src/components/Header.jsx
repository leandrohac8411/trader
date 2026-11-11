import React, { useEffect, useState } from "react";
import { getGlobalMetrics, getEthGas, getFearGreed } from "../services/api.js";

const compactUsd = (v) =>
  v == null
    ? "-"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(v);
const num = (v) => (v == null ? "-" : new Intl.NumberFormat("en-US").format(v));
const pct = (v) => (v == null || isNaN(v) ? "" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

export default function Header() {
  const [loading, setLoading] = useState(true);
  const [gm, setGm] = useState(null);
  const [gas, setGas] = useState(null);
  const [fng, setFng] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [g, ga, f] = await Promise.allSettled([
        getGlobalMetrics(),
        getEthGas(),
        getFearGreed(),
      ]);
      if (!mounted) return;
      if (g.status === "fulfilled") setGm(g.value?.data || null);
      if (ga.status === "fulfilled") setGas(ga.value?.data || null);
      if (f.status === "fulfilled") setFng(f.value?.data || null);
      setLoading(false);
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const q = gm?.quote?.USD || {};
  const cryptos = gm?.active_cryptocurrencies ?? null;
  const exchanges = gm?.active_exchanges ?? null;
  const totalMktCap = q.total_market_cap ?? null;
  const mktCapPct = q.total_market_cap_yesterday_percentage_change ?? null;
  const vol24h = q.total_volume_24h ?? null;
  const volPct = q.total_volume_24h_yesterday_percentage_change ?? null;
  const btcDom = gm?.btc_dominance ?? null;
  const ethDom = gm?.eth_dominance ?? null;

  return (
    <header className="w-full bg-white border-b border-gray-200">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8">
        <div className="w-full flex items-center justify-between py-2 text-xs sm:text-sm overflow-x-auto whitespace-nowrap gap-6">
          <div className="flex items-center gap-2">
            <span>🪙</span>
            <span className="text-gray-600">Cryptos:</span>
            <span className="font-semibold">{loading ? "…" : num(cryptos)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🏛️</span>
            <span className="text-gray-600">Exchanges:</span>
            <span className="font-semibold">{loading ? "…" : num(exchanges)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>📈</span>
            <span className="text-gray-600">Market Cap:</span>
            <span className="font-semibold">{loading ? "…" : compactUsd(totalMktCap)}</span>
            {!loading && mktCapPct != null && (
              <span className={mktCapPct >= 0 ? "text-green-600" : "text-red-600"}>{pct(mktCapPct)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span>🔊</span>
            <span className="text-gray-600">24h Vol:</span>
            <span className="font-semibold">{loading ? "…" : compactUsd(vol24h)}</span>
            {!loading && volPct != null && (
              <span className={volPct >= 0 ? "text-green-600" : "text-red-600"}>{pct(volPct)}</span>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            <span className="text-gray-600">⛽ Gas:</span>
            <span className="font-semibold">{gas?.gwei != null ? `${gas.gwei} gwei` : "…"}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">BTC:</span>
            <span className="font-semibold">
              {loading || btcDom == null ? "…" : `${btcDom.toFixed(2)}%`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">ETH:</span>
            <span className="font-semibold">
              {loading || ethDom == null ? "…" : `${ethDom.toFixed(2)}%`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">F&amp;G:</span>
            <span className="font-semibold">
              {loading ? "…" : fng?.value != null ? `${fng.value} ${fng.classification}` : "-"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
