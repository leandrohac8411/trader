// server/scripts/validate.mjs
// Validação da estratégia ANTES de qualquer dinheiro real.
//
// Simula a CARTEIRA como o bot opera: 5 ativos × [1h, 4h], no máximo BOT_MAX_OPEN posições,
// uma por ativo, risco de 1% limitado a 20% de notional, saída inteira no alvo (TP1) ou no stop,
// decisões só com velas fechadas, taxas e slippage da Bybit. Depois:
//   - resultado por ano, por direção, por ativo e por período (1h/4h);
//   - teste de estresse de custos (taxas e slippage em dobro);
//   - Monte Carlo: 10.000 anos sorteados a partir dos trades → chance de perder, quedas, sequências.
//
// Uso: node scripts/validate.mjs [--out ../docs/validacao-estrategia.md] [--years 3]
// Só lê dados públicos da Bybit. Não envia ordens.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../src/services/backtest.js";
import { higherTF } from "../src/services/strategy.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", fileURLToPath(new URL("../../docs/validacao-estrategia.md", import.meta.url)));
const YEARS = Number(arg("--years", 3));
const SYMBOLS = (process.env.BOT_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT").split(",");
const TFS = (process.env.BOT_TIMEFRAMES || "60,240").split(",");
const CFG = { riskPct: 1, maxNotionalPct: 0.2, maxOpen: Number(process.env.BOT_MAX_OPEN || 5) };
const CACHE = new URL("../data/.cache/", import.meta.url);
const tfMin = (tf) => (tf === "D" ? 1440 : tf === "W" ? 10080 : Number(tf));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v, d = 2) => (v > 0 ? "+" : "") + v.toFixed(d).replace(".", ",");
const pct = (v, d = 1) => `${fmt(v, d)}%`;

async function klines(symbol, interval, sinceTs) {
  const file = new URL(`${symbol}-${interval}.json`, CACHE);
  let rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  if (rows.length && rows[0].ts <= sinceTs && Date.now() - rows.at(-1).ts < 2 * tfMin(interval) * 60_000) return rows;
  rows = [];
  let end;
  for (;;) {
    const q = new URLSearchParams({ category: "linear", symbol, interval, limit: "1000", ...(end ? { end: String(end) } : {}) });
    let j;
    for (let k = 0; k < 6; k++) {
      j = await (await fetch(`https://api.bybit.com/v5/market/kline?${q}`)).json().catch(() => ({}));
      if (j?.result?.list) break;
      await sleep(1500);
    }
    const page = (j?.result?.list || []).map((r) => ({ ts: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
    if (!page.length) break;
    rows = page.concat(rows);
    end = page.at(-1).ts - 1;
    if (page.at(-1).ts <= sinceTs) break;
    await sleep(120);
  }
  rows.sort((a, b) => a.ts - b.ts);
  const closed = rows.filter((c) => c.ts + tfMin(interval) * 60_000 <= Date.now()); // só velas fechadas
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(closed));
  return closed;
}

/** Todos os trades que a regra do bot faria em cada ativo/período (com horários reais). */
export async function collectTrades(costs = {}, params = {}, tfs = TFS) {
  const since = Date.now() - YEARS * 365 * 864e5;
  const warm = 400; // velas de aquecimento antes do início
  const out = [];
  for (const symbol of SYMBOLS) for (const tf of tfs) {
    const c = (await klines(symbol, tf, since - warm * tfMin(tf) * 60_000)).filter((x) => x.ts >= since - warm * tfMin(tf) * 60_000);
    const h = await klines(symbol, higherTF(tf), since - 400 * tfMin(higherTF(tf)) * 60_000);
    const bt = runBacktest(c, { htfCandles: h, singleTarget: true, warmup: warm, ...params, ...costs });
    for (const t of bt.tradeList) {
      out.push({
        symbol, tf, dir: t.dir, netR: t.netR, reason: t.reason,
        openTs: c[t.entryIdx].ts, closeTs: c[t.exitIdx].ts,
        stopPct: Math.abs(t.entry - t.stop) / t.entry,
      });
    }
  }
  return out.sort((a, b) => a.openTs - b.openTs);
}

/** A carteira do bot: vagas, um por ativo, risco 1% com teto de notional, juros compostos. */
export function portfolio(trades, start = 100_000) {
  let equity = start, peak = start, maxDD = 0;
  const open = []; const taken = [];
  const events = [];
  for (const t of trades) {
    // fecha o que terminou antes desta entrada
    for (let i = open.length - 1; i >= 0; i--) if (open[i].closeTs <= t.openTs) {
      equity += open[i].pnl; events.push({ ts: open[i].closeTs, equity });
      peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak);
      open.splice(i, 1);
    }
    if (open.length >= CFG.maxOpen || open.some((o) => o.symbol === t.symbol)) continue;
    const riskUsd = Math.min(equity * CFG.riskPct / 100, equity * CFG.maxNotionalPct * t.stopPct);
    const pos = { ...t, riskUsd, pnl: t.netR * riskUsd };
    open.push(pos); taken.push(pos);
  }
  for (const o of open.sort((a, b) => a.closeTs - b.closeTs)) { equity += o.pnl; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak); }
  return { start, end: equity, retPct: (equity / start - 1) * 100, maxDDPct: maxDD * 100, trades: taken };
}

export function stats(list) {
  const n = list.length, rs = list.map((t) => t.netR);
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r <= 0);
  const mean = n ? rs.reduce((s, r) => s + r, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rs.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)) : 0;
  const gw = wins.reduce((s, r) => s + r, 0), gl = -losses.reduce((s, r) => s + r, 0);
  let run = 0, streak = 0; for (const r of rs) { run = r > 0 ? 0 : run + 1; streak = Math.max(streak, run); }
  return { n, winPct: n ? (wins.length / n) * 100 : 0, expR: mean, ci: n > 1 ? [mean - 1.96 * sd / Math.sqrt(n), mean + 1.96 * sd / Math.sqrt(n)] : null,
    pf: gl ? gw / gl : null, streak, pnl: list.reduce((s, t) => s + (t.pnl || 0), 0) };
}

/** 10.000 anos sorteados (com reposição) a partir dos trades da carteira, risco efetivo de cada um. */
export function monteCarlo(trades, perYear, runs = 10_000) {
  const riskFrac = trades.map((t) => t.netR * (t.riskUsd / (t.equityAt || 1)));
  let seed = 19; const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rets = [], dds = [], streaks = [];
  for (let k = 0; k < runs; k++) {
    let eq = 1, peak = 1, dd = 0, run = 0, st = 0;
    for (let i = 0; i < perYear; i++) {
      const r = riskFrac[Math.floor(rand() * riskFrac.length)];
      eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
      run = r > 0 ? 0 : run + 1; st = Math.max(st, run);
    }
    rets.push((eq - 1) * 100); dds.push(dd * 100); streaks.push(st);
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  return { perYear, pLoss: (rets.filter((r) => r < 0).length / runs) * 100, ret: [q(rets, 0.05), q(rets, 0.5), q(rets, 0.95)],
    dd: [q(dds, 0.5), q(dds, 0.95)], streak: [q(streaks, 0.5), q(streaks, 0.95)] };
}

const row = (label, s) => `| ${label} | ${s.n} | ${s.winPct.toFixed(0)}% | ${fmt(s.expR, 3)} R | ${s.ci ? `${fmt(s.ci[0], 2)} a ${fmt(s.ci[1], 2)}` : "—"} | ${s.pf ? s.pf.toFixed(2).replace(".", ",") : "—"} | ${s.streak} |`;
const head = "| Grupo | Trades | Acerto | Por trade | 95% (R) | Fator de lucro | Pior sequência de perdas |\n|---|---|---|---|---|---|---|";
const groupBy = (list, key) => Object.entries(list.reduce((m, t) => ((m[key(t)] ||= []).push(t), m), {})).sort();

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import("node:path")).resolve(process.argv[1])) await main();

async function main() {
console.log(`Baixando ${YEARS} anos de velas e simulando…`);
const base = await collectTrades({});
const stress = await collectTrades({ feePct: 0.11, slippagePct: 0.05 });
const pf = portfolio(base), pfS = portfolio(stress);
// risco de cada trade em fração do saldo no momento (para o Monte Carlo)
{ let eq = pf.start; for (const t of [...pf.trades].sort((a, b) => a.closeTs - b.closeTs)) { t.equityAt = eq; eq += t.pnl; } }
const spanYears = (pf.trades.at(-1).closeTs - pf.trades[0].openTs) / (365 * 864e5);
const perYear = Math.round(pf.trades.length / spanYears);
const mc = monteCarlo(pf.trades, perYear);
const all = stats(pf.trades), allS = stats(pfS.trades);
const cagr = (Math.pow(pf.end / pf.start, 1 / spanYears) - 1) * 100;

const years = groupBy(pf.trades, (t) => new Date(t.closeTs).getUTCFullYear());
const yearRows = years.map(([y, l]) => { const s = stats(l); return `| ${y} | ${s.n} | ${s.winPct.toFixed(0)}% | ${fmt(s.expR, 3)} R | ${pct((s.pnl / pf.start) * 100)} |`; });
const checks = [
  ["Por trade positivo no período todo", all.expR > 0, `${fmt(all.expR, 3)} R`],
  ["Intervalo de 95% acima de zero", all.ci && all.ci[0] > 0, all.ci ? `${fmt(all.ci[0], 2)} a ${fmt(all.ci[1], 2)} R` : "—"],
  ["Lucro em todos os anos", yearRows.length && years.every(([, l]) => stats(l).expR > 0), years.map(([y, l]) => `${y}: ${fmt(stats(l).expR, 2)}`).join(" · ")],
  ["Compras e vendas lucrativas", groupBy(pf.trades, (t) => t.dir).every(([, l]) => stats(l).expR > 0), groupBy(pf.trades, (t) => t.dir).map(([d, l]) => `${d === "LONG" ? "compra" : "venda"} ${fmt(stats(l).expR, 2)}`).join(" · ")],
  ["Aguenta taxas e slippage em dobro", allS.expR > 0, `${fmt(allS.expR, 3)} R`],
  ["Chance de perder no ano < 10%", mc.pLoss < 10, `${mc.pLoss.toFixed(1).replace(".", ",")}%`],
  ["Queda típica (95%) no ano < 20%", mc.dd[1] < 20, `${mc.dd[1].toFixed(1).replace(".", ",")}%`],
];
const passed = checks.filter((c) => c[1]).length;

const md = `# Validação da estratégia

Gerado em ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC por \`node scripts/validate.mjs\` (só dados públicos da Bybit, nenhuma ordem).

**Como o bot opera na simulação:** ${SYMBOLS.map((s) => s.replace("USDT", "")).join(", ")} × ${TFS.map((t) => (t === "60" ? "1h" : "4h")).join(" e ")}, no máximo ${CFG.maxOpen} posições e uma por ativo, risco de ${CFG.riskPct}% por trade limitado a ${CFG.maxNotionalPct * 100}% de notional, saída inteira no alvo (1,5R) ou no stop, decisão só com velas fechadas, taxa 0,055% + slippage 0,02% por lado. Juros compostos a partir de US$ ${pf.start.toLocaleString("pt-BR")}.

Período: ${new Date(pf.trades[0].openTs).toISOString().slice(0, 10)} a ${new Date(pf.trades.at(-1).closeTs).toISOString().slice(0, 10)} (${spanYears.toFixed(1).replace(".", ",")} anos). Os parâmetros da estratégia foram calibrados em set/2026, então quase todo esse período está **fora** da amostra da calibração.

## Resultado: ${passed} de ${checks.length} critérios

| Critério | Passou? | Valor |
|---|---|---|
${checks.map(([l, ok, v]) => `| ${l} | ${ok ? "✅" : "❌"} | ${v} |`).join("\n")}

## Carteira

| | Valor |
|---|---|
| Trades executados (com as vagas) | ${all.n} (~${perYear} por ano) |
| Retorno total | ${pct(pf.retPct)} (US$ ${pf.start.toLocaleString("pt-BR")} → US$ ${Math.round(pf.end).toLocaleString("pt-BR")}) |
| Retorno médio por ano | ${pct(cagr)} |
| Maior queda do saldo | ${pct(-pf.maxDDPct)} |
| Com taxas e slippage em dobro | ${pct(pfS.retPct)} no total · ${fmt(allS.expR, 3)} R por trade |

${head}
${row("Todos", all)}
${groupBy(pf.trades, (t) => (t.tf === "60" ? "1h" : "4h")).map(([k, l]) => row(k, stats(l))).join("\n")}
${groupBy(pf.trades, (t) => t.dir).map(([k, l]) => row(k === "LONG" ? "Compras" : "Vendas", stats(l))).join("\n")}
${groupBy(pf.trades, (t) => t.symbol.replace("USDT", "")).map(([k, l]) => row(k, stats(l))).join("\n")}

## Por ano

| Ano | Trades | Acerto | Por trade | Resultado no ano (sobre o saldo inicial) |
|---|---|---|---|---|
${yearRows.join("\n")}

## Monte Carlo: 10.000 anos sorteados

Cada "ano" sorteia ${perYear} trades (com reposição) entre os trades da carteira, com o risco de cada um.

| | Valor |
|---|---|
| Chance de terminar o ano no prejuízo | ${mc.pLoss.toFixed(1).replace(".", ",")}% |
| Retorno no ano: pior 5% · mediana · melhor 5% | ${pct(mc.ret[0])} · ${pct(mc.ret[1])} · ${pct(mc.ret[2])} |
| Maior queda no ano: típica · ruim (95%) | ${pct(-mc.dd[0])} · ${pct(-mc.dd[1])} |
| Pior sequência de perdas seguidas: típica · ruim (95%) | ${mc.streak[0]} · ${mc.streak[1]} |

## Limitações

- Backtest não é futuro: o mercado pode mudar de comportamento.
- Stop em mercado rápido pode sair pior que o preço do stop (a simulação usa o preço exato).
- Cada ativo/período é simulado separadamente e depois encaixado nas vagas da carteira; o tempo de espera entre entradas pode diferir um pouco do bot.
- Não considera a Máquina do Tempo (ela só filtra entradas; o efeito dela precisa ser medido na demo).
- Não é recomendação de investimento.
`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);
console.log(md);
}
