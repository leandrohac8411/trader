import React, { useState } from "react";
import { runBacktest, runBacktestGrid } from "../services/api.js";
import { probZone, ZONE_LEGEND } from "../services/probZone.js";

const TF_OPTIONS = ["5", "15", "30", "60", "240", "D"];
const pctv = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const sgn = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(d)}`);

function variantTag(p) {
  return (
    `prob≥${p.minProbEntry}` +
    (p.exitOnReverse ? " +reverse" : "") +
    (p.breakevenAfterTp1 ? " +BE" : "") +
    (p.trailAtr ? ` trail${p.trailAtr}×ATR` : "") +
    (p.singleTarget ? " só-TP1" : "")
  );
}

function Equity({ curve }) {
  if (!curve || curve.length < 2) return null;
  const w = 560;
  const h = 90;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const span = max - min || 1;
  const pts = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = curve[curve.length - 1] >= curve[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
      <line x1="0" y1={h - ((1 - min) / span) * (h - 8) - 4} x2={w} y2={h - ((1 - min) / span) * (h - 8) - 4} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
      <polyline points={pts} fill="none" stroke={up ? "#16a34a" : "#dc2626"} strokeWidth="1.5" />
    </svg>
  );
}

export default function Backtest({ initialSymbol = "BTCUSDT", initialInterval = "60" }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [interval, setInterval] = useState(
    TF_OPTIONS.includes(String(initialInterval)) ? String(initialInterval) : "60"
  );
  const [bars, setBars] = useState(1000);
  const [htf, setHtf] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [rep, setRep] = useState(null);

  const [grid, setGrid] = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridErr, setGridErr] = useState(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setGrid(null);
    try {
      const json = await runBacktest({ symbol, interval, bars, htf });
      setRep(json?.data || null);
    } catch (e) {
      setErr(e.message || String(e));
      setRep(null);
    } finally {
      setLoading(false);
    }
  }

  async function compare() {
    setGridLoading(true);
    setGridErr(null);
    try {
      const json = await runBacktestGrid({ symbol, interval, bars, htf });
      setGrid(json?.data || null);
    } catch (e) {
      setGridErr(e.message || String(e));
    } finally {
      setGridLoading(false);
    }
  }

  const t = rep?.trades;

  return (
    <div className="bg-white rounded-xl shadow p-4 sm:p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
            Backtest — o que a “probabilidade” valeu no histórico
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Roda a mesma estratégia sobre ~{bars} velas passadas. Amostra pequena: use como
            indicativo, não garantia. Não é recomendação de investimento.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <input
          className="border rounded px-3 py-2 text-sm"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="BTCUSDT"
        />
        <select
          className="border rounded px-3 py-2 text-sm"
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
        >
          {TF_OPTIONS.map((i) => (
            <option key={i} value={i}>
              {i === "D" ? "1d" : `${i}m`}
            </option>
          ))}
        </select>
        <input
          type="number"
          className="border rounded px-3 py-2 text-sm"
          value={bars}
          min={200}
          max={1000}
          onChange={(e) => setBars(Math.min(1000, Math.max(200, Number(e.target.value || 0))))}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700 px-1">
          <input type="checkbox" checked={htf} onChange={(e) => setHtf(e.target.checked)} />
          filtro HTF
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm disabled:opacity-60"
        >
          {loading ? "Rodando…" : "Rodar backtest"}
        </button>
      </div>

      {err && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {err}
        </div>
      )}

      {!rep && !loading && !err && (
        <div className="text-sm text-gray-500">
          Escolha o par e o timeframe e clique em “Rodar backtest”.
        </div>
      )}

      {rep && (
        <>
          <div className="text-xs text-gray-500 mb-3">
            {rep.meta.symbol} {rep.meta.interval} · {rep.meta.from?.slice(0, 10)} →{" "}
            {rep.meta.to?.slice(0, 10)} · {rep.meta.candles} velas · {rep.meta.signals} sinais ·
            HTF {rep.meta.htf ? "on" : "off"}
          </div>

          {/* stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {[
              ["Win rate", pctv(t.winRate), t.winRate >= 0.5 ? "text-green-600" : "text-gray-800"],
              ["Expectativa", `${sgn(t.expectancyR)} R`, t.expectancyR >= 0 ? "text-green-600" : "text-red-600"],
              ["Profit factor", t.profitFactor ?? "—", (t.profitFactor ?? 0) >= 1 ? "text-green-600" : "text-red-600"],
              ["Retorno total", `${sgn(t.totalReturnPct)}%`, t.totalReturnPct >= 0 ? "text-green-600" : "text-red-600"],
              ["Max drawdown", `-${t.maxDrawdownPct}%`, "text-red-600"],
              ["Trades", `${t.n} (${t.wins}✓)`, "text-gray-800"],
            ].map(([k, v, c]) => (
              <div key={k} className="border rounded p-3">
                <div className="text-[11px] text-gray-500 mb-1">{k}</div>
                <div className={`text-lg font-semibold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          {/* curva de capital */}
          <div className="border rounded p-3 mb-4">
            <div className="text-[13px] font-medium text-gray-700 mb-1">
              Curva de capital (risco {rep.meta.params.riskPerTradePct}% por trade)
            </div>
            <Equity curve={t.equityCurve} />
          </div>

          {/* calibração */}
          <div className="border rounded p-3 mb-4 overflow-x-auto">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-[13px] font-medium text-gray-700">
                Calibração — o que cada faixa de “força do sinal” significou de verdade
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                {ZONE_LEGEND.map((z) => (
                  <span key={z.key} className="flex items-center gap-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${z.dot}`} />
                    {z.label}
                  </span>
                ))}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs">
                  <th className="py-1 pr-3">Faixa</th>
                  <th className="py-1 pr-3 text-right">N</th>
                  <th className="py-1 pr-3 text-right">Acerto (20 velas)</th>
                  <th className="py-1 pr-3 text-right">Retorno médio</th>
                  <th className="py-1 pr-3 text-right">R médio (trades)</th>
                </tr>
              </thead>
              <tbody>
                {rep.calibration
                  .filter((c) => c.n > 0)
                  .map((c) => {
                    const lo = Number(c.range.split(/[^\d]+/).filter(Boolean)[0]);
                    const z = probZone(lo);
                    return (
                    <tr key={c.range} className="border-t">
                      <td className="py-1 pr-3 font-medium">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${z.dot}`} />
                        <span className={z.text}>{c.range}%</span>
                      </td>
                      <td className="py-1 pr-3 text-right">{c.n}</td>
                      <td className="py-1 pr-3 text-right">
                        <span
                          className={
                            c.winRate == null
                              ? ""
                              : c.winRate >= 0.5
                              ? "text-green-600 font-semibold"
                              : "text-red-600"
                          }
                        >
                          {pctv(c.winRate)}
                        </span>
                      </td>
                      <td className={`py-1 pr-3 text-right ${(c.avgFwd20Pct ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {sgn(c.avgFwd20Pct)}%
                      </td>
                      <td className={`py-1 pr-3 text-right ${(c.avgR ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {c.avgR == null ? "—" : sgn(c.avgR)}
                      </td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
            <div className="text-[11px] text-gray-400 mt-2">
              “Acerto (20 velas)” = quantas vezes o preço estava a favor do sinal 20 velas depois.
              É a leitura mais direta do que o % do painel de sinais representou.
            </div>
          </div>

          {/* retorno futuro */}
          <div className="border rounded p-3">
            <div className="text-[13px] font-medium text-gray-700 mb-2">
              Retorno futuro — todos os sinais
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              {Object.entries(rep.byForwardBar).map(([k, v]) => (
                <div key={k}>
                  <div className="text-[11px] text-gray-500">{k} velas</div>
                  <div className="font-semibold">
                    {pctv(v.winRate)}{" "}
                    <span className={v.avgReturnPct >= 0 ? "text-green-600" : "text-red-600"}>
                      ({sgn(v.avgReturnPct)}%)
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400">n={v.n}</div>
                </div>
              ))}
            </div>
          </div>

          {/* grid de variantes de saída */}
          <div className="border rounded p-3 mt-4 overflow-x-auto">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-[13px] font-medium text-gray-700">
                Variantes de regra de saída (comparação)
              </div>
              <button
                onClick={compare}
                disabled={gridLoading}
                className="text-sm bg-gray-800 hover:bg-black text-white rounded px-3 py-1.5 disabled:opacity-60"
              >
                {gridLoading ? "Comparando (72 combinações)…" : "Comparar variantes"}
              </button>
            </div>
            {gridErr && <div className="text-[12px] text-red-600 mb-2">{gridErr}</div>}
            {grid && (
              <>
                {grid.note && (
                  <div className="text-[12px] text-amber-700 bg-amber-50 rounded px-2 py-1 mb-2">
                    {grid.note}
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs">
                      <th className="py-1 pr-3">Variante</th>
                      <th className="py-1 pr-3 text-right">Trades</th>
                      <th className="py-1 pr-3 text-right">Win</th>
                      <th className="py-1 pr-3 text-right">Expect. (R)</th>
                      <th className="py-1 pr-3 text-right">PF</th>
                      <th className="py-1 pr-3 text-right">Retorno</th>
                      <th className="py-1 pr-3 text-right">Drawdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.variants.slice(0, 12).map((v, i) => {
                      const isBest =
                        grid.best && variantTag(v.params) === variantTag(grid.best.params);
                      return (
                        <tr
                          key={i}
                          className={"border-t " + (isBest ? "bg-green-50 font-medium" : "")}
                        >
                          <td className="py-1 pr-3">
                            {isBest && "▶ "}
                            {variantTag(v.params)}
                          </td>
                          <td className="py-1 pr-3 text-right">{v.trades}</td>
                          <td className="py-1 pr-3 text-right">{pctv(v.winRate)}</td>
                          <td
                            className={
                              "py-1 pr-3 text-right " +
                              (v.expectancyR >= 0 ? "text-green-600" : "text-red-600")
                            }
                          >
                            {sgn(v.expectancyR)}
                          </td>
                          <td className="py-1 pr-3 text-right">{v.profitFactor ?? "—"}</td>
                          <td
                            className={
                              "py-1 pr-3 text-right " +
                              (v.totalReturnPct >= 0 ? "text-green-600" : "text-red-600")
                            }
                          >
                            {sgn(v.totalReturnPct)}%
                          </td>
                          <td className="py-1 pr-3 text-right text-red-600">-{v.maxDrawdownPct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="text-[11px] text-gray-400 mt-2">
                  “prob≥85” é o gate de entrada. As colunas mostram cada regra de saída sobre a
                  mesma janela. O padrão do sistema hoje é a linha destacada.
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
