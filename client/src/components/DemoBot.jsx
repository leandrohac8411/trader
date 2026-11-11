import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getBotStatus,
  getBotReport,
  getBotTrades,
  getBotWatch,
  getBotLog,
  botPause,
  botResume,
  runBacktest,
} from "../services/api.js";
import { probZone } from "../services/probZone.js";

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const sgn = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(d)}`);
const ftime = (ms) => {
  try {
    return new Date(ms).toLocaleString("pt-BR", { hour12: false });
  } catch {
    return "—";
  }
};
const ftimeShort = (ms) => {
  try {
    return new Date(ms).toLocaleTimeString("pt-BR", { hour12: false });
  } catch {
    return "—";
  }
};

const EVENT_LABEL = {
  watching: "👀 começou a vigiar",
  stage: "↕ mudou de faixa",
  would_open: "🟡 abriria (dry-run)",
  opened: "🟢 ABRIU posição",
  closed: "🔵 fechou posição",
  blocked: "⛔ bloqueado",
  error: "⚠️ erro",
};

export default function DemoBot() {
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [trades, setTrades] = useState([]);
  const [watch, setWatch] = useState([]);
  const [events, setEvents] = useState([]);
  const [ref, setRef] = useState(null); // backtest de referência (BTC 1h)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const canNotify = typeof window !== "undefined" && "Notification" in window;
  const lastEventTsRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [s, r, t] = await Promise.all([getBotStatus(), getBotReport(), getBotTrades(50)]);
      setStatus(s);
      setReport(r?.live || null);
      setTrades(t?.trades || []);
      setErr(null);
    } catch (e) {
      setErr(e.message || String(e));
    }
  }, []);

  const refreshWatch = useCallback(async () => {
    try {
      const [w, l] = await Promise.all([getBotWatch(), getBotLog(60)]);
      setWatch(w?.items || []);
      const evs = l?.events || [];
      setEvents(evs);
      // notifica só eventos novos (aberto/fechado) desde a última checada
      if (canNotify && Notification.permission === "granted") {
        const fresh = evs.filter(
          (e) => e.ts > lastEventTsRef.current && (e.type === "opened" || e.type === "closed")
        );
        for (const e of fresh) {
          new Notification(
            e.type === "opened" ? `Bot abriu ${e.symbol} ${e.dir}` : `Bot fechou ${e.symbol}`,
            {
              body:
                e.type === "opened"
                  ? `${e.dir} @ ${e.entry} · prob ${e.probability}%`
                  : `${e.reason} · R ${sgn(e.netR)}`,
            }
          );
        }
      }
      if (evs.length) lastEventTsRef.current = Math.max(...evs.map((e) => e.ts));
    } catch {
      /* silencioso — não é crítico */
    }
  }, [canNotify]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!status?.enabled) return;
    if (canNotify && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    refreshWatch();
    const id = setInterval(refreshWatch, 20_000);
    return () => clearInterval(id);
  }, [status?.enabled, refreshWatch, canNotify]);

  useEffect(() => {
    if (status?.enabled && !ref) {
      runBacktest({ symbol: "BTCUSDT", interval: "60" })
        .then((j) => setRef(j?.data?.trades || null))
        .catch(() => {});
    }
  }, [status?.enabled, ref]);

  async function toggle() {
    setBusy(true);
    try {
      if (status?.paused) await botResume();
      else await botPause();
      await refresh();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="bg-white rounded-xl shadow p-4 sm:p-6 text-sm text-gray-500">
        Bot demo — carregando…
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <div className="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">
          Bot demo (forward-test) — desligado
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          Opera sozinho na <strong>Demo Trading da Bybit</strong> (dinheiro fake, preços reais) e
          registra cada trade pra comparar com o backtest. Zero risco financeiro.
        </p>
        <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1">
          <li>Na Bybit, entre em <strong>Demo Trading</strong> e gere uma API key/secret.</li>
          <li>
            No <code>server/.env</code>: <code>BYBIT_DEMO_KEY</code>, <code>BYBIT_DEMO_SECRET</code> e{" "}
            <code>DEMO_BOT=1</code>.
          </li>
          <li>Reinicie o servidor (<code>npm run dev</code>).</li>
        </ol>
      </div>
    );
  }

  const paused = status.paused;
  const dot =
    paused === "daily-loss"
      ? "bg-red-500"
      : paused
      ? "bg-amber-500"
      : "bg-green-500 animate-pulse";
  const dayPos = (status.todayPnlPct ?? 0) >= 0;

  const Cmp = ({ label, live, exp, fmt = (x) => x }) => (
    <tr className="border-t">
      <td className="py-1 pr-3 text-gray-600">{label}</td>
      <td className="py-1 pr-3 text-right font-semibold">{live == null ? "—" : fmt(live)}</td>
      <td className="py-1 pr-3 text-right text-gray-500">{exp == null ? "—" : fmt(exp)}</td>
    </tr>
  );

  return (
    <div className="bg-white rounded-xl shadow p-4 sm:p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
            Bot demo (forward-test)
            {status.config.dryRun && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                DRY-RUN · não manda ordem
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Demo Trading Bybit · {status.config.symbols.length} pares × [
            {status.config.timeframes.join(", ")}] · risco {status.config.riskPct}% · gate{" "}
            {status.config.minProb}% · notional máx{" "}
            {Math.round((status.config.maxNotionalPct ?? 0.2) * 100)}% · limite diário −
            {status.config.dailyLossLimitPct}%
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy || paused === "daily-loss"}
          className={
            "rounded px-3 py-2 text-sm text-white disabled:opacity-60 " +
            (paused ? "bg-green-600 hover:bg-green-700" : "bg-amber-600 hover:bg-amber-700")
          }
        >
          {paused === "daily-loss"
            ? "Pausado (limite diário)"
            : paused
            ? "Retomar"
            : "Pausar"}
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

      {/* equity */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="border rounded p-3">
          <div className="text-[11px] text-gray-500 mb-1">Equity demo</div>
          <div className="text-lg font-semibold">${status.equity?.toLocaleString("en-US")}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-[11px] text-gray-500 mb-1">PnL do dia</div>
          <div className={`text-lg font-semibold ${dayPos ? "text-green-600" : "text-red-600"}`}>
            {sgn(status.todayPnlPct)}%
          </div>
        </div>
        <div className="border rounded p-3">
          <div className="text-[11px] text-gray-500 mb-1">Posições abertas</div>
          <div className="text-lg font-semibold">{status.open?.length ?? 0}</div>
        </div>
      </div>

      {/* radar — tudo que o bot está de olho, ao vivo */}
      <div className="border rounded p-3 mb-4 overflow-x-auto">
        <div className="text-[13px] font-medium text-gray-700 mb-2">
          Radar — o que o bot está vigiando agora
        </div>
        {watch.length === 0 ? (
          <div className="text-sm text-gray-500">Carregando…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs">
                <th className="py-1 pr-3">Par/TF</th>
                <th className="py-1 pr-3">Direção</th>
                <th className="py-1 pr-3 text-right">Força do sinal</th>
                <th className="py-1 pr-3">Estágio</th>
                <th className="py-1 pr-3">Consenso</th>
                <th className="py-1 pr-3">Posição</th>
              </tr>
            </thead>
            <tbody>
              {watch.map((w) => {
                const z = probZone(w.probability, w.stage);
                return (
                  <tr key={`${w.symbol}|${w.tf}`} className="border-t">
                    <td className="py-1 pr-3 font-medium">
                      {w.symbol} {w.tf}m
                    </td>
                    <td
                      className={`py-1 pr-3 ${
                        w.lean === "LONG" ? "text-green-600" : w.lean === "SHORT" ? "text-red-600" : ""
                      }`}
                    >
                      {w.lean === "LONG" ? "↑" : w.lean === "SHORT" ? "↓" : "—"}
                    </td>
                    <td className={`py-1 pr-3 text-right font-semibold ${z.text}`}>
                      {w.probability}%
                    </td>
                    <td className="py-1 pr-3">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${z.chip}`}>
                        {z.label}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-gray-500">{w.consensus}</td>
                    <td className="py-1 pr-3">
                      {w.hasOpenPosition ? (
                        <span className="text-green-600 font-medium">aberta</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="text-[11px] text-gray-400 mt-2">
          Ordenado por força do sinal. Assim que algo passa dos {status.config.minProb}%
          (estágio "Entrada"), o bot abre sozinho — sem precisar você ficar olhando.
        </div>
      </div>

      {/* eventos — tudo que o bot fez/decidiu, em ordem */}
      <div className="border rounded p-3 mb-4 overflow-x-auto">
        <div className="text-[13px] font-medium text-gray-700 mb-2">Eventos recentes</div>
        {events.length === 0 ? (
          <div className="text-sm text-gray-500">Sem eventos ainda.</div>
        ) : (
          <ul className="text-sm space-y-1 max-h-72 overflow-y-auto">
            {events.map((e, i) => (
              <li key={i} className="flex items-start gap-2 border-t pt-1 first:border-t-0 first:pt-0">
                <span className="text-gray-400 text-[11px] w-16 shrink-0">{ftimeShort(e.ts)}</span>
                <span className="shrink-0">{EVENT_LABEL[e.type] || e.type}</span>
                <span className="text-gray-600">
                  {e.symbol} {e.tf}m
                  {e.type === "stage" &&
                    ` — ${e.prevStage ?? "?"} → ${e.stage} (${e.probability ?? "—"}%)`}
                  {e.type === "watching" && ` — ${e.stage} (${e.probability ?? "—"}%)`}
                  {e.type === "would_open" &&
                    ` — ${e.dir} @ ${e.entry} · notional $${(e.notional ?? 0).toLocaleString("en-US")} · risco $${e.riskUsd}${e.capped ? " (teto)" : ""}`}
                  {e.type === "opened" &&
                    ` — ${e.dir} @ ${e.entry} · notional $${(e.notional ?? 0).toLocaleString("en-US")} (prob ${e.probability}%)`}
                  {e.type === "closed" &&
                    ` — ${e.reason} · R ${sgn(e.netR)} · $${sgn(e.pnlUsd, 2)}`}
                  {e.type === "blocked" && ` — ${e.reason}`}
                  {e.type === "error" && ` — ${e.detail}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* live vs backtest */}
      <div className="border rounded p-3 mb-4 overflow-x-auto">
        <div className="text-[13px] font-medium text-gray-700 mb-2">
          Ao vivo (demo) × Backtest esperado{" "}
          <span className="text-gray-400 font-normal">(referência: BTC 1h)</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs">
              <th className="py-1 pr-3">Métrica</th>
              <th className="py-1 pr-3 text-right">Demo ao vivo</th>
              <th className="py-1 pr-3 text-right">Backtest</th>
            </tr>
          </thead>
          <tbody>
            <Cmp label="Trades" live={report?.n} exp={ref?.n} />
            <Cmp label="Win rate" live={report?.winRate} exp={ref?.winRate} fmt={pct} />
            <Cmp label="Expectativa (R)" live={report?.expectancyR} exp={ref?.expectancyR} fmt={(v) => sgn(v)} />
            <Cmp label="Profit factor" live={report?.profitFactor} exp={ref?.profitFactor} />
            <Cmp
              label="Retorno acumulado"
              live={report?.totalPnlPct}
              exp={ref?.totalReturnPct}
              fmt={(v) => `${sgn(v)}%`}
            />
          </tbody>
        </table>
        {(report?.n ?? 0) < 20 && (
          <div className="text-[11px] text-amber-700 mt-2">
            Ainda são {report?.n ?? 0} trades ao vivo — precisa de ~20+ pra a comparação significar
            algo. Forward-test é lento (semanas).
          </div>
        )}
      </div>

      {/* posições abertas */}
      {status.open?.length > 0 && (
        <div className="border rounded p-3 mb-4 overflow-x-auto">
          <div className="text-[13px] font-medium text-gray-700 mb-2">Posições abertas</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs">
                <th className="py-1 pr-3">Par</th>
                <th className="py-1 pr-3">Lado</th>
                <th className="py-1 pr-3 text-right">Entrada</th>
                <th className="py-1 pr-3 text-right">Stop</th>
                <th className="py-1 pr-3 text-right">TP</th>
                <th className="py-1 pr-3 text-right">PnL aberto</th>
              </tr>
            </thead>
            <tbody>
              {status.open.map((p) => (
                <tr key={p.symbol} className="border-t">
                  <td className="py-1 pr-3 font-medium">{p.symbol}</td>
                  <td className={`py-1 pr-3 ${p.side === "Buy" ? "text-green-600" : "text-red-600"}`}>
                    {p.side === "Buy" ? "LONG" : "SHORT"}
                  </td>
                  <td className="py-1 pr-3 text-right">{p.entry}</td>
                  <td className="py-1 pr-3 text-right text-red-600">{p.stopLoss ?? "—"}</td>
                  <td className="py-1 pr-3 text-right text-green-600">{p.takeProfit ?? "—"}</td>
                  <td
                    className={`py-1 pr-3 text-right ${p.unrealisedPnl >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {sgn(p.unrealisedPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* log */}
      <div className="border rounded p-3 overflow-x-auto">
        <div className="text-[13px] font-medium text-gray-700 mb-2">Trades fechados (ao vivo)</div>
        {trades.length === 0 ? (
          <div className="text-sm text-gray-500">Nenhum trade fechado ainda.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs">
                <th className="py-1 pr-3">Quando</th>
                <th className="py-1 pr-3">Par/TF</th>
                <th className="py-1 pr-3">Lado</th>
                <th className="py-1 pr-3 text-right">Prob.</th>
                <th className="py-1 pr-3">Saída</th>
                <th className="py-1 pr-3 text-right">R</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 pr-3 text-gray-500">{ftime(t.closedAt)}</td>
                  <td className="py-1 pr-3">{t.symbol} {t.tf}m</td>
                  <td className={`py-1 pr-3 ${t.dir === "LONG" ? "text-green-600" : "text-red-600"}`}>
                    {t.dir}
                  </td>
                  <td className="py-1 pr-3 text-right">{t.probability}%</td>
                  <td className="py-1 pr-3">{t.reason}</td>
                  <td
                    className={`py-1 pr-3 text-right font-semibold ${(t.netR ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {sgn(t.netR)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-[11px] text-gray-400 mt-3">
        Conta demo — sem dinheiro real. O bot só opera com o servidor ligado; quando o PC dorme,
        ele para (e retoma sozinho ao voltar).
      </div>
    </div>
  );
}
