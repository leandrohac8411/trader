import React, { useEffect, useState } from "react";
import {
  getGlobalMetrics,
  getFearGreed,
  getCategories,
  getListingsLatest,
  getNewListings,
} from "../services/api.js";

const fmtUsd = (n) => {
  if (n == null || isNaN(n)) return "--";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${Number(n).toPrecision(3)}`;
};
const pct = (v) =>
  v == null || isNaN(v) ? "--" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
const cls = (v) => (Number(v) >= 0 ? "text-green-600" : "text-red-600");

function fngLabel(v) {
  if (v == null) return "—";
  if (v <= 25) return "Extreme Fear";
  if (v <= 45) return "Fear";
  if (v < 55) return "Neutral";
  if (v < 75) return "Greed";
  return "Extreme Greed";
}

export default function MarketOverview() {
  const [gm, setGm] = useState(null);
  const [fng, setFng] = useState(null);
  const [sectors, setSectors] = useState([]);
  const [listings, setListings] = useState([]);
  const [fresh, setFresh] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [g, f, c, l, nl] = await Promise.allSettled([
          getGlobalMetrics(),
          getFearGreed(),
          getCategories(12),
          getListingsLatest({ limit: 50 }),
          getNewListings(6),
        ]);
        if (!alive) return;
        if (g.status === "fulfilled") setGm(g.value?.data || null);
        if (f.status === "fulfilled") setFng(f.value?.data || null);
        if (c.status === "fulfilled") setSectors(c.value?.data || []);
        if (l.status === "fulfilled") setListings(l.value?.data || []);
        if (nl.status === "fulfilled") setFresh(nl.value?.data || []);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const q = gm?.quote?.USD || {};
  const marketCap = q.total_market_cap ?? null;
  const volume24h = q.total_volume_24h ?? null;
  const btcDom = gm?.btc_dominance ?? null;
  const ethDom = gm?.eth_dominance ?? null;

  const fngVal = fng?.value ?? null;
  const fngClass = fng?.classification || fngLabel(fngVal);

  const topSectors = [...sectors]
    .filter((s) => s.market_cap_change_24h != null)
    .sort((a, b) => b.market_cap_change_24h - a.market_cap_change_24h)
    .slice(0, 5);

  const gainers = [...listings]
    .filter((c) => c?.quote?.USD?.percent_change_24h != null)
    .sort((a, b) => b.quote.USD.percent_change_24h - a.quote.USD.percent_change_24h)
    .slice(0, 3);

  const featured = listings.slice(0, 3);

  const newList = (fresh || [])
    .map((c) => ({
      name: c.name || c.symbol,
      symbol: c.symbol,
      price: c?.quote?.USD?.price ?? null,
      ch: c?.quote?.USD?.percent_change_24h ?? null,
    }))
    .slice(0, 3);

  const Card = ({ title, icon, children }) => (
    <div className="bg-white rounded-xl shadow p-6 card-hover flex flex-col border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <i className={icon}></i>
      </div>
      {children}
    </div>
  );

  const Row = ({ sym, name, sub, right, rightCls }) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          {String(sym || "?").slice(0, 4)}
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate">{name}</div>
          {sub != null && <div className="text-xs text-gray-500 truncate">{sub}</div>}
        </div>
      </div>
      <span className={`font-semibold ${rightCls || ""}`}>{right}</span>
    </div>
  );

  return (
    <section id="market-overview" className="mb-6 sm:mb-8">
      {err && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {err}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 sm:gap-6 auto-rows-fr items-stretch">
        {/* Sentimento — F&G real */}
        <Card title="Sentimento do mercado" icon="fa-solid fa-chart-pie text-blue-500">
          <div className="relative w-[120px] h-[120px] mx-auto mb-4">
            <svg width="120" height="120" className="-rotate-90">
              <circle cx="60" cy="60" r="45" stroke="#e5e7eb" strokeWidth="8" fill="none" />
              <circle
                cx="60"
                cy="60"
                r="45"
                stroke="#fb923c"
                strokeWidth="8"
                strokeDasharray={`${(2 * Math.PI * 45 * (fngVal ?? 0)) / 100} ${2 * Math.PI * 45}`}
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-500">
                  {loading ? "…" : fngVal ?? "--"}
                </div>
                <div className="text-xs text-gray-500">{fngClass}</div>
              </div>
            </div>
          </div>
          <div className="mt-auto text-center">
            <span className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-sm font-medium">
              {fngClass}
            </span>
          </div>
        </Card>

        {/* Dados do mercado */}
        <Card title="Dados do mercado" icon="fa-solid fa-chart-bar text-green-500">
          <div className="space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Market Cap</span>
              <span className="font-semibold">{loading ? "…" : fmtUsd(marketCap)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">24h Volume</span>
              <span className="font-semibold">{loading ? "…" : fmtUsd(volume24h)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">BTC Dominance</span>
              <span className="font-semibold">
                {btcDom != null ? `${btcDom.toFixed(2)}%` : "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">ETH Dominance</span>
              <span className="font-semibold">
                {ethDom != null ? `${ethDom.toFixed(2)}%` : "--"}
              </span>
            </div>
          </div>
        </Card>

        {/* Setores — categorias CMC reais */}
        <Card title="Setores em destaque" icon="fa-solid fa-layer-group text-purple-500">
          <div className="space-y-2 text-sm">
            {loading && <div className="text-gray-500">Carregando…</div>}
            {!loading && !topSectors.length && (
              <div className="text-gray-500">Sem dados de setores.</div>
            )}
            {topSectors.map((s) => (
              <div key={s.name} className="flex justify-between items-center">
                <span className="text-gray-700 truncate mr-2">{s.name}</span>
                <span className={`${cls(s.market_cap_change_24h)} font-semibold`}>
                  {pct(s.market_cap_change_24h)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Maiores ganhos — derivado das listagens */}
        <Card title="Maiores ganhos (24h)" icon="fa-solid fa-arrow-trend-up text-green-500">
          <div className="space-y-4">
            {loading && <div className="text-sm text-gray-500">Carregando…</div>}
            {gainers.map((c) => (
              <Row
                key={c.symbol}
                sym={c.symbol}
                name={c.name}
                sub={fmtUsd(c.quote.USD.price)}
                right={pct(c.quote.USD.percent_change_24h)}
                rightCls={cls(c.quote.USD.percent_change_24h)}
              />
            ))}
          </div>
        </Card>

        {/* Novas listagens */}
        <Card title="Novas listagens" icon="fa-solid fa-star text-yellow-500">
          <div className="space-y-4">
            {loading && <div className="text-sm text-gray-500">Carregando…</div>}
            {!loading && !newList.length && (
              <div className="text-sm text-gray-500">
                Indisponível no plano atual da API.
              </div>
            )}
            {newList.map((x) => (
              <Row
                key={x.symbol}
                sym={x.symbol}
                name={x.name}
                sub={fmtUsd(x.price)}
                right={pct(x.ch)}
                rightCls={cls(x.ch)}
              />
            ))}
          </div>
        </Card>

        {/* Em destaque — top market cap */}
        <Card title="Em destaque" icon="fa-solid fa-fire text-red-500">
          <div className="space-y-4">
            {loading && <div className="text-sm text-gray-500">Carregando…</div>}
            {featured.map((c) => (
              <Row
                key={c.symbol}
                sym={c.symbol}
                name={c.name}
                sub={`${c.symbol}/USDT`}
                right={fmtUsd(c.quote?.USD?.price)}
              />
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
