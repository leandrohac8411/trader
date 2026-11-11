import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeStrategy, aiAnalyze, runBacktest } from "../services/api.js";
import { probZone } from "../services/probZone.js";

const WATCH = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const TF_OPTIONS = ["1", "3", "5", "15", "30", "60", "240", "D"];
// consenso mínimo (de 4 votos) para "alerta forte"
const ALERT_CONSENSUS = Number(import.meta?.env?.VITE_ALERT_CONSENSUS ?? 3);
// probabilidade técnica mínima (%) para "alerta forte" / notificação
const ALERT_PROB = Number(import.meta?.env?.VITE_ALERT_PROB ?? 65);

const fnum = (v, d = 2) =>
  v == null || Number.isNaN(+v)
    ? "—"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ftime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { hour12: false });
  } catch {
    return iso;
  }
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const votesOf = (d) => Number(String(d?.consensus || "0/4").split("/")[0]) || 0;

function makeTrigger(d) {
  const sig = String(d?.signal || "NEUTRAL").toUpperCase();
  const atr = Number(d?.indicators?.atr14 ?? 0);
  if (sig === "LONG")
    return `Comprar no pullback (~0,2×ATR ≈ ${fnum(0.2 * atr, 5)}) com candle acima da EMA20 e RSI entre 45–70. Evitar se RSI > 72.`;
  if (sig === "SHORT")
    return `Vender no repique (~0,2×ATR ≈ ${fnum(0.2 * atr, 5)}) com candle abaixo da EMA20 e RSI entre 30–55. Evitar se RSI < 28.`;
  const raw = String(d?.rawSignal || "NEUTRAL").toUpperCase();
  const p = Number(d?.probability ?? 0);
  if (raw !== "NEUTRAL" && p >= 50)
    return `Consenso a favor de ${raw === "LONG" ? "alta" : "baixa"} (${p}%), mas abaixo do gate de 85%. Deixe a ordem montada e espere confirmar.`;
  return "Sem entrada: alinhamento insuficiente. Aguardar.";
}

export default function AIAssistant({
  initialSymbol = "BTCUSDT",
  initialInterval = "1",
  initialLimit = 200,
  autoRefresh = true,
  refreshMs = 60_000,
  scanMs = 45_000,
  onSymbolChange,
  onIntervalChange,
}) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [tf, setTf] = useState(initialInterval);
  const [limit, setLimit] = useState(initialLimit);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(null);

  const [watchMap, setWatchMap] = useState({});

  const [ai, setAi] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState(null);

  const [calib, setCalib] = useState(null); // array de calibração do backtest
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState(null);

  const canNotify = typeof window !== "undefined" && "Notification" in window;
  const lastNotifiedRef = useRef({ key: null, ts: 0 });

  useEffect(() => {
    onSymbolChange?.(symbol);
  }, [symbol, onSymbolChange]);
  useEffect(() => {
    onIntervalChange?.(tf);
  }, [tf, onIntervalChange]);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const json = await analyzeStrategy({ symbol, interval: tf, limit });
      setData(json?.data || null);
      setLastRunAt(new Date().toISOString());
    } catch (e) {
      setErr(e.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, tf, limit]);

  useEffect(() => {
    run();
    if (!autoRefresh) return;
    const t = setInterval(run, refreshMs);
    return () => clearInterval(t);
  }, [run, autoRefresh, refreshMs]);

  // varredura das WATCH para badges/notificações
  useEffect(() => {
    let alive = true;
    async function scan() {
      const results = await Promise.allSettled(
        WATCH.map((s) => analyzeStrategy({ symbol: s, interval: tf, limit }))
      );
      if (!alive) return;
      const next = {};
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const d = r.value?.data;
        if (!d) return;
        next[WATCH[i]] = {
          signal: d.signal,
          votes: votesOf(d),
          consensus: d.consensus,
          probability: Number(d.probability ?? 0),
        };
        maybeNotify(WATCH[i], d.signal, votesOf(d), Number(d.probability ?? 0));
      });
      setWatchMap(next);
    }
    if (canNotify && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    scan();
    const t = setInterval(scan, scanMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf, limit, scanMs]);

  function maybeNotify(sym, sig, votes, prob) {
    if (!canNotify || Notification.permission !== "granted") return;
    if (sig !== "LONG" && sig !== "SHORT") return;
    if (votes < ALERT_CONSENSUS || prob < ALERT_PROB) return;
    const key = `${sym}-${sig}-${votes}`;
    const now = Date.now();
    if (lastNotifiedRef.current.key === key && now - lastNotifiedRef.current.ts < 5 * 60_000) return;
    lastNotifiedRef.current = { key, ts: now };
    new Notification(`${sym}: ${sig} • ${prob}% (${votes}/4)`, {
      body: "Alinhamento forte detectado. Revise no painel — não é recomendação de investimento.",
    });
  }

  async function askAi() {
    setAiLoading(true);
    setAiErr(null);
    setAi(null);
    try {
      const json = await aiAnalyze({ symbol, interval: tf, limit });
      setAi(json?.ai || null);
      if (json?.ai?.provider === "error") setAiErr(json.ai.error || "falha na IA");
      if (json?.ai?.provider === "mock") setAiErr("IA em modo mock (defina GROQ_API_KEY no servidor).");
    } catch (e) {
      setAiErr(e.message || String(e));
    } finally {
      setAiLoading(false);
    }
  }

  // ao trocar de par/timeframe OU quando o sinal muda: zera o histórico e, se o
  // sinal for acionável (COMPRA/VENDA), busca o acerto histórico sozinho — é o
  // número que importa na hora de agir
  useEffect(() => {
    setCalib(null);
    setHistErr(null);
    const s = String(data?.signal || "NEUTRAL").toUpperCase();
    if (s === "LONG" || s === "SHORT") askHist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, data?.signal]);

  async function askHist() {
    setHistLoading(true);
    setHistErr(null);
    try {
      const json = await runBacktest({ symbol, interval: tf, bars: 1000, htf: true });
      setCalib(json?.data?.calibration || []);
    } catch (e) {
      setHistErr(e.message || String(e));
    } finally {
      setHistLoading(false);
    }
  }

  // faixa histórica derivada da FORÇA atual (sempre consistente com o % exibido)
  function bucketFor(p) {
    if (!calib) return null;
    const b = calib.find((c) => {
      const [lo, hi] = c.range.split(/[^\d]+/).filter(Boolean).map(Number);
      return p >= lo && p <= hi;
    });
    return b && b.n > 0 ? b : null;
  }

  const signal = String(data?.signal || "NEUTRAL").toUpperCase();
  const rawSignal = String(data?.rawSignal || "NEUTRAL").toUpperCase();
  const lean = String(data?.lean || rawSignal || "NEUTRAL").toUpperCase();
  const votes = votesOf(data);
  const prob = Number(data?.probability ?? 0);
  const showLevels = signal === "LONG" || signal === "SHORT";
  const ind = data?.indicators || {};
  const lv = data?.levels || {};
  const reasons = data?.reasons || data?.why || [];
  const htf = ind.htf || null;

  const zone = probZone(prob, data?.stage);
  const leanTxt =
    lean === "LONG" ? "viés de alta" : lean === "SHORT" ? "viés de baixa" : "sem direção";
  const headline =
    signal === "LONG"
      ? "COMPRA"
      : signal === "SHORT"
      ? "VENDA"
      : zone.key === "ready" || zone.key === "watch"
      ? `${lean === "SHORT" ? "↓" : "↑"} ${leanTxt}`
      : "—";

  // "quente" = já virou sinal de entrada (gate 85% + consenso)
  const isHot = (w) => w?.signal === "LONG" || w?.signal === "SHORT";

  const badge = (sym) => {
    const w = sym === symbol && data ? { signal, votes, probability: prob } : watchMap[sym];
    const p = Number(w?.probability ?? 0);
    const z = probZone(p);
    return (
      <span
        className={
          "ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium " +
          (isHot(w) ? "bg-white/20 text-white" : z.chip)
        }
        title={`${w?.signal || "—"} • ${p}% • consenso ${w?.votes ?? 0}/4`}
      >
        {p}%
      </span>
    );
  };

  const queryStr = useMemo(
    () => `symbol=${symbol}&interval=${tf}&limit=${limit}`,
    [symbol, tf, limit]
  );

  return (
    <div className="bg-white rounded-xl shadow p-4 sm:p-6 h-full">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Assistente de sinais</h3>
          <div className="text-xs text-gray-500 mt-1">
            <code className="select-all">{queryStr}</code>
            {(data?.updatedAt || lastRunAt) && (
              <>
                {" · "}Última análise: <strong>{ftime(data?.updatedAt || lastRunAt)}</strong>
              </>
            )}
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm disabled:opacity-60"
        >
          {loading ? "Analisando…" : "Analisar agora"}
        </button>
      </div>

      {/* abas */}
      <div className="flex flex-wrap gap-2 mb-3">
        {WATCH.map((sym) => {
          const w =
            sym === symbol && data ? { signal, votes, probability: prob } : watchMap[sym];
          const hot = isHot(w);
          const active = sym === symbol;
          return (
            <button
              key={sym}
              onClick={() => setSymbol(sym)}
              className={
                "px-3 py-1.5 rounded border text-sm transition-colors " +
                (hot
                  ? "bg-red-600 text-white border-red-600 animate-pulse"
                  : active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200")
              }
            >
              {sym.replace("USDT", "")}
              {badge(sym)}
            </button>
          );
        })}
      </div>

      {/* controles */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <input
          className="border rounded px-3 py-2 text-sm"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="BTCUSDT"
        />
        <select
          className="border rounded px-3 py-2 text-sm"
          value={tf}
          onChange={(e) => setTf(e.target.value)}
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
          value={limit}
          min={120}
          max={1000}
          onChange={(e) => setLimit(clamp(Number(e.target.value || 0), 120, 1000))}
        />
      </div>

      {err && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          Erro: {err}
        </div>
      )}

      {/* contexto */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
          SuperTrend:{" "}
          <strong
            className={
              ind.supertrend === "up"
                ? "text-green-600"
                : ind.supertrend === "down"
                ? "text-red-600"
                : "text-gray-800"
            }
          >
            {ind.supertrend || "—"}
          </strong>
        </span>
        {htf?.bias && (
          <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
            Timeframe maior:{" "}
            <strong className={htf.conflict ? "text-red-600" : "text-green-600"}>
              {htf.bias}
              {htf.conflict ? " (conflito)" : ""}
            </strong>
          </span>
        )}
      </div>

      {/* métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="border rounded p-3 text-sm">
          <div className="font-medium mb-2 text-gray-700">Preço</div>
          <div>
            <span className="text-gray-500">Last:</span> <strong>{fnum(data?.price, 5)}</strong>
          </div>
          <div>
            <span className="text-gray-500">ATR14:</span> <strong>{fnum(ind.atr14, 5)}</strong>
          </div>
        </div>
        <div className="border rounded p-3 text-sm">
          <div className="font-medium mb-2 text-gray-700">Médias / RSI</div>
          <div>
            <span className="text-gray-500">EMA20:</span> <strong>{fnum(ind.ema20, 5)}</strong>
          </div>
          <div>
            <span className="text-gray-500">EMA50:</span> <strong>{fnum(ind.ema50, 5)}</strong>
          </div>
          <div>
            <span className="text-gray-500">RSI(14):</span> <strong>{fnum(ind.rsi14, 2)}</strong>
          </div>
        </div>
        <div className="border rounded p-3 text-sm">
          <div className="font-medium mb-2 text-gray-700">MACD</div>
          <div>
            <span className="text-gray-500">hist:</span> <strong>{fnum(ind.macdHist, 4)}</strong>
          </div>
        </div>
      </div>

      {/* sinal + acerto histórico + níveis */}
      <div className="border rounded p-3 mt-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-gray-500">Sinal (estudo)</div>
            <div className={"text-2xl font-bold leading-tight " + zone.text}>{headline}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              consenso {data?.consensus || "0/4"} · edge {fnum(data?.edge, 2)}
            </div>
          </div>
          <div className="text-right">
            <span className={"text-[11px] px-1.5 py-0.5 rounded font-medium " + zone.chip}>
              {zone.label}
            </span>
            {(() => {
              const hb = bucketFor(prob);
              if (hb) {
                return (
                  <>
                    <div className="text-[11px] text-gray-500 mt-1">
                      Acerto histórico · faixa {hb.range}%
                    </div>
                    <div
                      className={
                        "text-3xl font-extrabold leading-tight " +
                        (hb.winRate == null
                          ? "text-gray-700"
                          : hb.winRate >= 0.5
                          ? "text-green-600"
                          : "text-red-600")
                      }
                    >
                      {hb.winRate == null ? "—" : `${Math.round(hb.winRate * 100)}%`}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      o preço foi pro lado do sinal, 20 velas depois · n={hb.n}
                    </div>
                  </>
                );
              }
              return (
                <>
                  <div className="text-[11px] text-gray-500 mt-1">Força do sinal</div>
                  <div className={"text-3xl font-extrabold leading-tight " + zone.text}>
                    {data ? `${prob}%` : "—"}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {histLoading
                      ? "buscando acerto histórico…"
                      : histErr
                      ? histErr
                      : calib
                      ? "sem amostra nessa faixa"
                      : "alinhamento dos indicadores — não é chance de lucro"}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* barra da força do sinal (sempre visível, secundária) */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-24 shrink-0">Força: {prob}%</span>
          <div className="flex-1 h-2 bg-gray-200 rounded overflow-hidden relative">
            <div className={"h-full " + zone.bar} style={{ width: `${data ? prob : 0}%` }} />
            {[50, 75, 85].map((m) => (
              <span key={m} className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${m}%` }} />
            ))}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400 pl-[104px]">
          <span>50 Formando</span>
          <span>75 Prepare-se</span>
          <span>85 Entrada</span>
        </div>

        {!calib && !histLoading && !histErr && (
          <button
            onClick={askHist}
            disabled={!data}
            className="mt-2 text-[12px] text-blue-600 hover:underline disabled:opacity-50"
          >
            ver acerto histórico desta faixa →
          </button>
        )}

        <div className="mt-2 text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1.5">
          <strong>Força do sinal</strong>: quão alinhados os indicadores estão agora (0–100%).
          Não é chance de lucro. &nbsp;
          <strong>Acerto histórico</strong>: nessa mesma faixa de força, quantas vezes o preço
          andou a favor 20 velas depois — é o número mais próximo de "probabilidade de dar certo",
          mas com amostra pequena (~1000 velas).
        </div>

        {showLevels ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              {[
                ["Entrada", lv.entry, ""],
                ["Stop-loss", lv.stop, "text-red-600"],
                ["TP1", lv.tp1, "text-green-600"],
                ["TP2", lv.tp2, "text-green-600"],
              ].map(([label, val, c]) => (
                <div key={label} className="rounded border p-3">
                  <div className="text-[13px] text-gray-500 mb-1">{label}</div>
                  <div className={`text-lg font-semibold ${c}`}>{fnum(val, 5)}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              Gestão calibrada no backtest: sair só no stop ou no TP (não sair por sinal oposto).
              Opcional: mover o stop para a entrada ao bater o TP1.
            </div>
          </>
        ) : (
          <div className="mt-3 rounded border border-dashed p-3 text-[13px] text-gray-600">
            {zone.key === "ready"
              ? "Perto do gatilho — sem entrada ainda. Prepare a ordem e espere a probabilidade cruzar 85%."
              : zone.key === "watch"
              ? "Cenário se formando. Só observe; nada a fazer até chegar em ~75%+."
              : "Sem viés claro. Aguarde."}
          </div>
        )}

        <div className="mt-4">
          <div className="text-[13px] font-medium text-gray-700 mb-1">Momento sugerido</div>
          <div className="text-[13px] text-gray-700">{makeTrigger(data)}</div>
        </div>

        <div className="mt-4">
          <div className="text-[13px] font-medium text-gray-700 mb-1">Por quê?</div>
          {reasons.length ? (
            <ul className="list-disc pl-5 text-[13px] text-gray-700 space-y-1">
              {reasons.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[13px] text-gray-500">Sem justificativas.</div>
          )}
        </div>
      </div>

      {/* comentário de IA */}
      <div className="border rounded p-3 mt-3">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium text-gray-700">Comentário da IA (Groq)</div>
          <button
            onClick={askAi}
            disabled={aiLoading || !data}
            className="text-sm bg-gray-800 hover:bg-black text-white rounded px-3 py-1.5 disabled:opacity-60"
          >
            {aiLoading ? "Consultando…" : "Comentar com IA"}
          </button>
        </div>
        {aiErr && <div className="mt-2 text-[12px] text-amber-700 bg-amber-50 rounded px-2 py-1">{aiErr}</div>}
        {ai?.text && (
          <p className="mt-2 text-[13px] text-gray-700 whitespace-pre-wrap">{ai.text}</p>
        )}
        {!ai && !aiErr && (
          <p className="mt-2 text-[12px] text-gray-500">
            Comenta os números acima. Não recalcula nada e não é recomendação de investimento.
          </p>
        )}
      </div>
    </div>
  );
}
