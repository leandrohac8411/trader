import React, { useEffect, useMemo, useState } from "react";
import { getListingsLatest } from "../services/api.js";

export default function TradingPairs({ maxRows = 15 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const j = await getListingsLatest({ limit: maxRows });
        if (!alive) return;
        const list = Array.isArray(j?.data) ? j.data : [];
        setRows(
          list.map((c) => ({
            pair: `${c.symbol}/USDT`,
            price: c?.quote?.USD?.price ?? null,
            change24h: c?.quote?.USD?.percent_change_24h ?? null,
          }))
        );
        setErr(null);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [maxRows]);

  const body = useMemo(() => {
    if (loading)
      return (
        <tr>
          <td className="px-6 py-6 text-center text-gray-500" colSpan={3}>
            Carregando…
          </td>
        </tr>
      );
    if (err)
      return (
        <tr>
          <td className="px-6 py-6 text-center text-red-600" colSpan={3}>
            {err}
          </td>
        </tr>
      );
    if (!rows.length)
      return (
        <tr>
          <td className="px-6 py-6 text-center text-gray-500" colSpan={3}>
            Sem dados no momento.
          </td>
        </tr>
      );
    return rows.map((r) => {
      const up = (r.change24h ?? 0) >= 0;
      return (
        <tr key={r.pair} className="border-t">
          <td className="px-6 py-3 whitespace-nowrap font-medium">{r.pair}</td>
          <td className="px-6 py-3 whitespace-nowrap text-right font-semibold">
            {r.price != null
              ? r.price.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 6,
                })
              : "-"}
          </td>
          <td className="px-6 py-3 whitespace-nowrap text-right">
            <span className={up ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
              {r.change24h != null ? `${r.change24h.toFixed(2)}%` : "-"}
            </span>
          </td>
        </tr>
      );
    });
  }, [rows, loading, err]);

  return (
    <div className="bg-white rounded-xl shadow">
      <div className="px-4 sm:px-6 py-4 border-b">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800">Moedas populares</h2>
      </div>
      <div>
        <table className="w-full">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nome
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Preço
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Variação (24h)
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">{body}</tbody>
        </table>
      </div>
    </div>
  );
}
