// server/src/backtest-cli.js
// Uso:
//   npm run backtest -- --symbol BTCUSDT --interval 15 --bars 1000 [--htf] [--rr1 1.5] [--json]
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { getKlines } from "./services/bybit.js";
import { higherTF } from "./services/strategy.js";
import { runBacktest, runGrid } from "./services/backtest.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) out[key] = true;
    else {
      out[key] = /^-?\d+(\.\d+)?$/.test(next) ? Number(next) : next;
      i++;
    }
  }
  return out;
}

const pct = (v) => (v == null ? "  —  " : `${(v * 100).toFixed(1)}%`);
const bar = (v, max, w = 24) => {
  if (v == null || max === 0) return "";
  const filled = Math.max(0, Math.round((v / max) * w));
  return "█".repeat(filled) + "·".repeat(Math.max(0, w - filled));
};

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const symbol = String(a.symbol || "BTCUSDT").toUpperCase();
  const interval = String(a.interval || "15");
  const bars = Math.min(Number(a.bars || 1000), 1000);
  const category = String(a.category || "linear");
  const useHtf = !!a.htf;

  process.stderr.write(
    `Baixando ${bars} velas ${symbol} ${interval}${useHtf ? ` (+HTF ${higherTF(interval)})` : ""}…\n`
  );
  const candles = await getKlines({ symbol, interval, limit: bars, category });
  const htfCandles = useHtf
    ? await getKlines({ symbol, interval: higherTF(interval), limit: 1000, category })
    : null;

  const stratOpts = {};
  for (const k of ["rr1", "rr2", "lookback", "emaFast", "emaSlow", "rsiPeriod", "stPeriod", "stMult"]) {
    if (a[k] != null && a[k] !== true) stratOpts[k] = Number(a[k]);
  }

  if (a.grid) {
    const g = runGrid(candles, { htfCandles, meta: { symbol, interval }, ...stratOpts });
    const fp = (v) => (v == null ? "—" : String(v).padStart(4));
    const rows = g.variants.slice(0, 15).map((v) => {
      const p = v.params;
      const tag =
        `prob≥${p.minProbEntry}` +
        `${p.exitOnReverse ? " +rev" : ""}` +
        `${p.breakevenAfterTp1 ? " +be" : ""}` +
        `${p.trailAtr ? ` trail${p.trailAtr}` : ""}` +
        `${p.singleTarget ? " tp1only" : ""}`;
      return `  ${tag.padEnd(34)} n=${String(v.trades).padStart(3)}  win ${pct(v.winRate).padStart(6)}  expR ${(v.expectancyR >= 0 ? "+" : "") + v.expectancyR}  PF ${fp(v.profitFactor)}  ret ${(v.totalReturnPct >= 0 ? "+" : "") + v.totalReturnPct}%  DD -${v.maxDrawdownPct}%`;
    });
    const b = g.best?.params;
    console.log(
      [
        "",
        `═══ GRID DE SAÍDAS  ${symbol} ${interval}  (${g.meta.combos} combinações, ${g.meta.candles} velas) ═══`,
        "",
        "  variante                            trades   win      expR       PF     retorno   drawdown",
        ...rows,
        "",
        g.note ? `⚠️  ${g.note}` : "",
        b
          ? `▶  MELHOR: prob≥${b.minProbEntry}${b.exitOnReverse ? " +reverse" : ""}${b.breakevenAfterTp1 ? " +breakeven" : ""}${b.trailAtr ? ` trail${b.trailAtr}×ATR` : ""}${b.singleTarget ? " só-TP1" : ""}` +
            `  →  ${g.best.trades} trades, expectativa ${(g.best.expectancyR >= 0 ? "+" : "") + g.best.expectancyR} R, retorno ${(g.best.totalReturnPct >= 0 ? "+" : "") + g.best.totalReturnPct}%`
          : "sem variantes válidas",
        "",
      ].join("\n")
    );
    return;
  }

  const report = runBacktest(candles, {
    htfCandles,
    meta: { symbol, interval },
    feePct: a.fee != null ? Number(a.fee) : undefined,
    slippagePct: a.slip != null ? Number(a.slip) : undefined,
    ...stratOpts,
  });

  const { meta, trades, calibration, byForwardBar } = report;

  const L = [];
  L.push("");
  L.push(`═══ BACKTEST  ${meta.symbol} ${meta.interval}  ═══`);
  L.push(`período: ${meta.from?.slice(0, 16)} → ${meta.to?.slice(0, 16)}  ·  ${meta.candles} velas  ·  HTF: ${meta.htf ? "sim" : "não"}`);
  L.push(`sinais não-neutros: ${meta.signals}`);
  L.push("");
  L.push("── SIMULAÇÃO DE TRADE ──");
  L.push(`trades............: ${trades.n}   (${trades.wins} ganhos)`);
  L.push(`win rate..........: ${pct(trades.winRate)}`);
  L.push(`expectativa.......: ${trades.expectancyR >= 0 ? "+" : ""}${trades.expectancyR} R / trade`);
  L.push(`profit factor.....: ${trades.profitFactor ?? "—"}`);
  L.push(`retorno total.....: ${trades.totalReturnPct >= 0 ? "+" : ""}${trades.totalReturnPct}%  (risco ${meta.params.riskPerTradePct}%/trade)`);
  L.push(`max drawdown......: -${trades.maxDrawdownPct}%`);
  L.push(`perdas seguidas...: ${trades.maxConsecLoss}`);
  L.push(`duração média.....: ${trades.avgBarsHeld} velas`);
  L.push(`saídas por.........: ${Object.entries(trades.byReason).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  L.push("");
  L.push("── CALIBRAÇÃO (o que 'X%' significou de verdade) ──");
  L.push("  faixa      N   acerto(20v)  retorno médio   R médio(trades)");
  const maxWin = Math.max(...calibration.map((c) => c.winRate ?? 0), 0.01);
  for (const c of calibration) {
    if (!c.n) continue;
    L.push(
      `  ${c.range.padEnd(8)} ${String(c.n).padStart(4)}   ` +
        `${pct(c.winRate).padStart(6)}     ` +
        `${((c.avgFwd20Pct ?? 0) >= 0 ? "+" : "")}${(c.avgFwd20Pct ?? 0).toFixed(2)}%`.padStart(8) +
        `        ${c.avgR == null ? "—" : (c.avgR >= 0 ? "+" : "") + c.avgR}  ${bar(c.winRate, maxWin, 16)}`
    );
  }
  L.push("");
  L.push("── RETORNO FUTURO (todos os sinais) ──");
  for (const [k, v] of Object.entries(byForwardBar)) {
    L.push(`  ${String(k).padStart(3)} velas:  acerto ${pct(v.winRate)}   retorno médio ${(v.avgReturnPct >= 0 ? "+" : "")}${v.avgReturnPct}%   (n=${v.n})`);
  }
  L.push("");
  L.push("⚠️  amostra pequena (~1000 velas). Indicativo, não garantia. Não é recomendação de investimento.");
  L.push("");

  console.log(L.join("\n"));

  if (a.json) {
    const dir = new URL("../backtests/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    const file = new URL(`${symbol}-${interval}-${stamp}.json`, dir);
    writeFileSync(file, JSON.stringify(report, null, 2));
    process.stderr.write(`\nJSON salvo em ${file.pathname}\n`);
  }
}

main().catch((e) => {
  console.error("Erro:", e.message || e);
  process.exit(1);
});
