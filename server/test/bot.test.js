// isola o log de eventos do teste do log real do bot (server/data/bot-events.jsonl) —
// precisa ser setado ANTES do import de bot.js, então usamos import() dinâmico
// (imports estáticos são hoisted e rodariam antes desta linha).
process.env.BOT_EVENTS_FILE = "bot-events.test.jsonl";

import test from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  roundToStep,
  tfMinutes,
  cooldownMs,
  isFreshSignal,
  sizePosition,
  aggregateTrades,
  appendEvent,
  readEvents,
  closedCandles,
  entryStillValid,
  liveRR,
  MIN_LIVE_RR_SHARE,
} = await import("../src/services/bot.js");
const { signV5, assertDemoBase, DEMO_BASE } = await import("../src/services/bybit-demo.js");

test("roundToStep arredonda pra baixo no passo", () => {
  assert.equal(roundToStep(0.12345, 0.001), 0.123);
  assert.equal(roundToStep(7.9, 1), 7);
  assert.equal(roundToStep(5, 0), 5);
});

test("tfMinutes / cooldownMs", () => {
  assert.equal(tfMinutes("60"), 60);
  assert.equal(tfMinutes("D"), 1440);
  assert.equal(cooldownMs("60", 10), 60 * 10 * 60_000);
});

test("isFreshSignal: transição dispara, repetido não, cooldown re-permite", () => {
  const now = 1_000_000_000;
  assert.equal(isFreshSignal({ signal: "LONG", lastSignal: "NEUTRAL", now, cd: 1000 }), true);
  assert.equal(
    isFreshSignal({ signal: "LONG", lastSignal: "LONG", lastExitTs: now - 500, now, cd: 1000 }),
    false
  );
  assert.equal(
    isFreshSignal({ signal: "LONG", lastSignal: "LONG", lastExitTs: now - 2000, now, cd: 1000 }),
    true
  );
  assert.equal(isFreshSignal({ signal: "NEUTRAL", lastSignal: "LONG", now, cd: 0 }), false);
});

test("sizePosition: risco fixo quando o stop é largo o bastante", () => {
  // equity 10000, risco 1% = $100; stop 20% longe (100000->80000) => dist 20000 => qty 0.005
  // notional 0.005*100000 = $500 = 5% da conta < teto 20% => risco fica exato
  const ok = sizePosition({
    equity: 10000, riskPct: 1, entry: 100000, stop: 80000,
    qtyStep: 0.001, minOrderQty: 0.001, leverage: 2, maxNotionalPct: 0.2,
  });
  assert.equal(ok.ok, true);
  assert.ok(Math.abs(ok.qty - 0.005) < 1e-9, `qty ${ok.qty}`);
  assert.equal(ok.capped, false);
  assert.ok(Math.abs(ok.riskUsd - 100) < 1, `risco ${ok.riskUsd}`);
});

test("sizePosition: TETO de notional morde com stop apertado (risco fica menor)", () => {
  // stop a 1% => risco 1% pediria posição de 100% da conta; teto de 20% corta
  const r = sizePosition({
    equity: 100000, riskPct: 1, entry: 2000, stop: 2020,
    qtyStep: 0.01, minOrderQty: 0.01, leverage: 2, maxNotionalPct: 0.2,
  });
  assert.equal(r.ok, true);
  assert.equal(r.capped, true);
  assert.ok(r.notional <= 100000 * 0.2 + 1, `notional ${r.notional} passou do teto`);
  assert.ok(r.riskUsd < 1000, `risco ${r.riskUsd} deveria ser < 1% por causa do teto`);
});

test("sizePosition: respeita maxOrderQty do instrumento", () => {
  const r = sizePosition({
    equity: 1_000_000, riskPct: 1, entry: 700, stop: 680,
    qtyStep: 0.01, minOrderQty: 0.01, maxOrderQty: 370, leverage: 2, maxNotionalPct: 1,
  });
  assert.ok(r.qty <= 370, `qty ${r.qty} passou do maxOrderQty`);
  assert.equal(r.capped, true);
});

test("sizePosition: rejeita stop nulo/inválido e equity zerada", () => {
  assert.equal(sizePosition({ equity: 10000, riskPct: 1, entry: 100, stop: null }).ok, false);
  assert.equal(sizePosition({ equity: 0, riskPct: 1, entry: 100, stop: 90 }).ok, false);
  assert.equal(sizePosition({ equity: 10000, riskPct: 1, entry: 100, stop: 100 }).ok, false);
});

test("aggregateTrades bate com cálculo manual", () => {
  const trades = [
    { netR: 1.5, netPnlPct: 1.2, reason: "tp", symbol: "BTCUSDT" },
    { netR: -1, netPnlPct: -0.8, reason: "stop", symbol: "BTCUSDT" },
    { netR: 1.5, netPnlPct: 1.1, reason: "tp", symbol: "ETHUSDT" },
    { netR: -1, netPnlPct: -0.9, reason: "stop", symbol: "SOLUSDT" },
  ];
  const r = aggregateTrades(trades);
  assert.equal(r.n, 4);
  assert.equal(r.wins, 2);
  assert.equal(r.winRate, 0.5);
  assert.equal(r.expectancyR, 0.25); // (1.5-1+1.5-1)/4
  assert.equal(r.profitFactor, 1.5); // 3 / 2
  assert.equal(r.byReason.tp, 2);
  assert.equal(r.bySymbol.BTCUSDT, 2);
});

test("signV5 é determinístico e hex de 64 chars", () => {
  const a = signV5({ apiKey: "k", apiSecret: "s", timestamp: "1700000000000", payload: "x=1" });
  const b = signV5({ apiKey: "k", apiSecret: "s", timestamp: "1700000000000", payload: "x=1" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  const c = signV5({ apiKey: "k", apiSecret: "s", timestamp: "1700000000001", payload: "x=1" });
  assert.notEqual(a, c);
});

test("appendEvent/readEvents: escreve e lê na ordem, respeita limit (arquivo isolado)", () => {
  const before = readEvents(0).length;
  appendEvent({ type: "watching", symbol: "TESTUSDT", tf: "60", stage: "watch" });
  appendEvent({ type: "stage", symbol: "TESTUSDT", tf: "60", stage: "ready", prevStage: "watch" });
  const all = readEvents(0);
  assert.equal(all.length, before + 2);
  const last2 = readEvents(2);
  assert.equal(last2.length, 2);
  assert.equal(last2[1].stage, "ready");
  assert.ok(Number.isFinite(last2[0].ts));
});

test("assertDemoBase só aceita a URL da demo", () => {
  assert.equal(assertDemoBase(DEMO_BASE), DEMO_BASE);
  assert.throws(() => assertDemoBase("https://api.bybit.com"), /proibida/);
  assert.throws(() => assertDemoBase("https://api-testnet.bybit.com"), /proibida/);
});

test("limpeza: remove o arquivo de eventos de teste", () => {
  const path = fileURLToPath(new URL("../data/bot-events.test.jsonl", import.meta.url));
  if (existsSync(path)) unlinkSync(path);
  assert.ok(true);
});

test('effectiveRiskPct uses the base risk unless the 10W/5L ladder is opted in', async () => {
  const { effectiveRiskPct } = await import('../src/services/bot.js');
  const wins = Array.from({ length: 10 }, (_, i) => ({ pnlUsd: 5, closedAt: 1_000 + i }));
  assert.equal(effectiveRiskPct({ trades: wins, cfg: { riskPct: 1, ladder: false } }), 1);
  assert.equal(effectiveRiskPct({ trades: wins, cfg: { riskPct: 1, ladder: true } }), 1.5);
});

test("strategyParams só usa o aluno promovido com BOT_SCHOOL_PROMOTE", async () => {
  const { strategyParams } = await import("../src/services/bot.js");
  const promotion = { params: { minProbEntry: 75, rr1: 2 } };
  assert.deepEqual(strategyParams({ cfg: { minProb: 85, schoolPromote: false }, promotion }), { minProbEntry: 85 });
  assert.deepEqual(strategyParams({ cfg: { minProb: 85, schoolPromote: true }, promotion: null }), { minProbEntry: 85 });
  assert.deepEqual(strategyParams({ cfg: { minProb: 85, schoolPromote: true }, promotion }), { minProbEntry: 75, rr1: 2 });
});

test("perfil v3 é o padrão: 1h, score ≥ 90, alvo 2R, SuperTrend 4, empate em 1,5R", async () => {
  const { profileParams, strategyParams, CFG } = await import("../src/services/bot.js");
  assert.deepEqual(profileParams("v3"), { minProb: 90, rr1: 2, stMult: 4, breakevenAtR: 1.5, timeframes: ["60"] });
  assert.deepEqual(profileParams("v2"), { minProb: 90, rr1: 3, stMult: 4, breakevenAtR: null });
  assert.deepEqual(profileParams("v1"), { minProb: 85, rr1: 1.5, stMult: 3, breakevenAtR: null });
  assert.deepEqual(profileParams("desconhecido"), profileParams("v3"));
  // BOT_MIN_PROB antigo só vale no perfil custom
  assert.deepEqual(profileParams("custom", { BOT_MIN_PROB: "88", BOT_RR1: "2" }), { minProb: 88, rr1: 2, stMult: 4, breakevenAtR: null });
  if (!process.env.BOT_PROFILE) {
    assert.deepEqual(strategyParams({ cfg: { ...CFG, schoolPromote: false } }), { minProbEntry: 90, rr1: 2, stMult: 4 });
    assert.deepEqual(CFG.timeframes, ["60"]);
    assert.equal(CFG.breakevenAtR, 1.5);
  }
  assert.deepEqual(strategyParams({ cfg: { minProb: 90, rr1: 3, stMult: 4, schoolPromote: true }, promotion: { params: { rr1: 2 } } }),
    { minProbEntry: 90, rr1: 2, stMult: 4 });
});

test("reachedBreakeven: só conta velas fechadas depois da entrada", async () => {
  const { reachedBreakeven } = await import("../src/services/bot.js");
  const base = { side: "Sell", entry: 100, stop0: 104, openedAt: 1000, atR: 1.5 }; // risco 4 → empate em 94
  const c = (ts, low, high) => ({ ts, low, high });
  assert.equal(reachedBreakeven({ ...base, candles: [c(500, 90, 101), c(1000, 95, 101)] }), false); // a vela de 500 é antes da entrada
  assert.equal(reachedBreakeven({ ...base, candles: [c(1000, 95, 101), c(2000, 94, 99)] }), true);
  assert.equal(reachedBreakeven({ ...base, side: "Buy", stop0: 96, candles: [c(1000, 99, 105.9)] }), false);
  assert.equal(reachedBreakeven({ ...base, side: "Buy", stop0: 96, candles: [c(1000, 99, 106)] }), true);
  assert.equal(reachedBreakeven({ ...base, atR: null, candles: [c(2000, 50, 99)] }), false);
});

test("tickTimeframes: continua acompanhando posição aberta num período fora do perfil", async () => {
  const { tickTimeframes } = await import("../src/services/bot.js");
  const keys = { "SOLUSDT|240": { open: { side: "Sell" } }, "ETHUSDT|240": { open: null }, "SOLUSDT|60": { open: null } };
  assert.deepEqual(tickTimeframes("SOLUSDT", ["60"], keys), ["60", "240"]);
  assert.deepEqual(tickTimeframes("ETHUSDT", ["60"], keys), ["60"]);
});

test("isRecordedTrade descarta fechamentos não encontrados na corretora", async () => {
  const { isRecordedTrade } = await import("../src/services/bot.js");
  assert.equal(isRecordedTrade({ exit: null, reason: "unknown", netR: 0 }), false);
  assert.equal(isRecordedTrade({ exit: 709.2, reason: "tp", netR: 1.4 }), true);
  assert.equal(isRecordedTrade({ exit: 2433.26, reason: "stop", netR: -0.15 }), true);
});

test("roundToStep não deixa resíduo de ponto flutuante (Bybit recusa)", () => {
  assert.equal(roundToStep(0.4797, 0.001), 0.479);
  assert.equal(String(roundToStep(0.4797, 0.001)), "0.479");
  assert.equal(String(roundToStep(33319.75, 0.1)), "33319.7");
  assert.equal(String(roundToStep(417.73, 0.1)), "417.7");
  assert.equal(String(roundToStep(2121.770944, 0.01)), "2121.77");
  assert.equal(roundToStep(17.069, 0.01), 17.06);
});

test("closedCandles descarta a vela em formação (igual ao backtest)", () => {
  const h = 3_600_000, t0 = Date.UTC(2026, 10, 13, 10);
  const c = [0, 1, 2].map((i) => ({ ts: t0 + i * h, close: i }));
  // 12:20: as velas das 10h e 11h fecharam; a das 12h ainda está em formação
  assert.deepEqual(closedCandles(c, "60", t0 + 2 * h + 20 * 60_000).map((x) => x.close), [0, 1]);
  // 13:00 em ponto: a das 12h acabou de fechar
  assert.equal(closedCandles(c, "60", t0 + 3 * h).length, 3);
  assert.equal(closedCandles(c, "240", t0 + 3 * h).length, 0);
});

test("entryStillValid: só entra se o preço atual ainda estiver entre stop e alvo", () => {
  assert.equal(entryStillValid({ dir: "SHORT", live: 100, stop: 105, tp: 92 }), true);
  assert.equal(entryStillValid({ dir: "SHORT", live: 106, stop: 105, tp: 92 }), false); // passou do stop
  assert.equal(entryStillValid({ dir: "SHORT", live: 91, stop: 105, tp: 92 }), false); // já bateu o alvo
  assert.equal(entryStillValid({ dir: "LONG", live: 100, stop: 95, tp: 108 }), true);
  assert.equal(entryStillValid({ dir: "LONG", live: 94, stop: 95, tp: 108 }), false);
  assert.equal(entryStillValid({ dir: "LONG", live: NaN, stop: 95, tp: 108 }), false);
});

test("adoptPositions adota posições da corretora que o estado não conhece", async () => {
  const { adoptPositions } = await import("../src/services/bot.js");
  const state = { keys: { "ETHUSDT|60": { open: { side: "Sell" } } } };
  const positions = [
    { symbol: "ETHUSDT", side: "Sell", size: 1, entry: 1952, stopLoss: 1999.65, takeProfit: 1879.21, openedAt: 1 },
    { symbol: "SOLUSDT", side: "Sell", size: 100, entry: 79.86, stopLoss: 82.85, takeProfit: 75.69, openedAt: 2 },
    { symbol: "DOGEUSDT", side: "Buy", size: 5, entry: 1, stopLoss: 0.9, takeProfit: 1.2, openedAt: 3 },
  ];
  const adopted = adoptPositions({ state, positions, symbols: ["ETHUSDT", "SOLUSDT"], timeframes: ["60", "240"], now: 9 });
  assert.deepEqual(adopted.map((a) => a.key), ["SOLUSDT|240"]); // ETH já era nossa; DOGE fora da lista
  const o = state.keys["SOLUSDT|240"].open;
  assert.equal(o.side, "Sell");
  assert.equal(o.openedAt, 9); // hora da adoção, não o createdTime velho da Bybit
  // estado adotado antes da correção (sem adoptedAt) passa para a hora atual, uma vez só
  const old = { keys: { "BTCUSDT|240": { open: { side: "Sell", openedAt: 1, adopted: true } } } };
  adoptPositions({ state: old, positions: [], symbols: ["BTCUSDT"], timeframes: ["240"], now: 50 });
  assert.equal(old.keys["BTCUSDT|240"].open.openedAt, 50);
  adoptPositions({ state: old, positions: [], symbols: ["BTCUSDT"], timeframes: ["240"], now: 99 });
  assert.equal(old.keys["BTCUSDT|240"].open.openedAt, 50);
  assert.ok(Math.abs(o.riskUsd - 100 * (82.85 - 79.86)) < 1e-6);
  assert.equal(adoptPositions({ state, positions, symbols: ["ETHUSDT", "SOLUSDT"], timeframes: ["60", "240"] }).length, 0); // não adota duas vezes
});

test("matchClose e closeTradeLine: acha o fechamento depois da abertura, com a mesma quantidade", async () => {
  const { matchClose, closeTradeLine } = await import("../src/services/bot.js");
  const open = { side: "Sell", qty: 18.96, entry: 1911.33, stop: 1911.33, stop0: 1958.51, tp: 1817.75, riskUsd: 894.53, openedAt: 1000, beMoved: true };
  const closed = [
    { closedAt: 500, qty: 18.96, exit: 1900, closedPnl: 200 },       // antes da abertura
    { closedAt: 2000, qty: 5, exit: 1911.4, closedPnl: -3 },          // outra quantidade
    { closedAt: 3000, qty: 18.96, exit: 1911.4, closedPnl: -21.5 },
  ];
  const c = matchClose(closed, open);
  assert.equal(c.closedAt, 3000);
  const t = closeTradeLine({ symbol: "ETHUSDT", tf: "60", open, c });
  assert.equal(t.reason, "be");
  assert.equal(t.netR, Number((-21.5 / 894.53).toFixed(3)));
  assert.equal(matchClose([], open), null);
  // posição adotada (sem qty/riskUsd): risco pela quantidade do fechamento
  const adopted = { side: "Sell", entry: 1952, stop: 1999.65, tp: 1879.21, openedAt: 1000 };
  const t2 = closeTradeLine({ symbol: "ETHUSDT", tf: "240", open: adopted, c: { closedAt: 4000, qty: 18.18, exit: 1880, closedPnl: 1300 } });
  assert.equal(t2.reason, "tp");
  assert.ok(Math.abs(t2.netR - 1300 / (18.18 * 47.65)) < 0.001);
});

test("backfillPending: devolve os unreconciled recentes para a fila, sem repetir trade já registrado", async () => {
  const { backfillPending } = await import("../src/services/bot.js");
  const now = 10 * 86_400_000;
  const events = [
    { ts: now - 9000, type: "opened", symbol: "ETHUSDT", tf: "60", entry: 1911.33, stop: 1958.5, tp: 1817.75, qty: 18.96, riskUsd: 894.53, probability: 90 },
    { ts: now - 5000, type: "breakeven", symbol: "ETHUSDT", tf: "60", entry: 1911.33, stop: 1911.33 },
    { ts: now - 1000, type: "unreconciled", symbol: "ETHUSDT", tf: "60", dir: "SHORT", entry: 1911.33, openedAt: now - 9000 },
    { ts: now - 1000, type: "unreconciled", symbol: "BNBUSDT", tf: "60", dir: "SHORT", entry: 610.1, openedAt: now - 8000 },
    { ts: now - 9 * 86_400_000, type: "unreconciled", symbol: "XRPUSDT", tf: "60", dir: "SHORT", entry: 1, openedAt: 1 },
  ];
  const out = backfillPending({ events, trades: [], now });
  assert.equal(out.length, 1); // BNB sem evento de abertura; XRP antigo demais
  assert.deepEqual([out[0].open.stop, out[0].open.stop0, out[0].open.beMoved, out[0].open.qty], [1911.33, 1958.5, true, 18.96]);
  assert.equal(backfillPending({ events, trades: [{ symbol: "ETHUSDT", openedAt: now - 9000 }], now }).length, 0);
});

test("entrada atrasada: só entra se ainda sobrar ganho/risco mínimo a partir do preço atual", () => {
  // XRP de 14/11: stop 1.002685, alvo 0.853029, entrou a 0.9236 → sobravam 0,89R
  const xrp = { dir: "SHORT", live: 0.9236, stop: 1.002685, tp: 0.853029 };
  assert.ok(Math.abs(liveRR(xrp) - 0.89) < 0.01);
  assert.equal(entryStillValid(xrp), true); // sem mínimo: dentro da faixa
  assert.equal(entryStillValid({ ...xrp, minRR: 2 * MIN_LIVE_RR_SHARE }), false);
  // ETH de 14/11: entrou logo depois do sinal, 1,98R → passa
  const eth = { dir: "SHORT", live: 1911.33, stop: 1958.509767, tp: 1817.750466 };
  assert.equal(entryStillValid({ ...eth, minRR: 1.5 }), true);
  assert.equal(entryStillValid({ dir: "LONG", live: 100, stop: 95, tp: 108, minRR: 1.5 }), true); // 1,6R
  assert.equal(entryStillValid({ dir: "LONG", live: 102, stop: 95, tp: 108, minRR: 1.5 }), false); // 0,86R
});

test("closeFromExecutions: monta o fechamento pelas execuções quando o closed-pnl atrasa", async () => {
  const { closeFromExecutions, findClose, closeTradeLine } = await import("../src/services/bot.js");
  // SOL 1h de 14/11: vendida 332,4 a 75,51, alvo 69,00592
  const open = { side: "Sell", qty: 332.4, entry: 75.51, stop: 80.98204, tp: 69.00592, riskUsd: 1818.91, openedAt: 1_000_000 };
  const execs = [
    { side: "Buy", price: 79.0, qty: 300, fee: 1, closedSize: 300, time: 900_000 }, // fechamento de OUTRA posição, antes da abertura
    { side: "Sell", price: 75.51, qty: 332.4, fee: 13.8, closedSize: 0, time: 1_000_100 }, // abertura
    { side: "Buy", price: 69.0, qty: 200, fee: 7.6, closedSize: 200, time: 2_000_000 },
    { side: "Buy", price: 69.02, qty: 132.4, fee: 5.0, closedSize: 132.4, time: 2_000_050 },
  ];
  const c = closeFromExecutions(execs, open);
  assert.ok(c);
  assert.equal(c.closedAt, 2_000_050);
  assert.ok(Math.abs(c.exit - (200 * 69 + 132.4 * 69.02) / 332.4) < 1e-9);
  const gross = (75.51 - c.exit) * 332.4;
  assert.ok(Math.abs(c.closedPnl - (gross - 7.6 - 5.0 - 13.8)) < 1e-6);
  const line = closeTradeLine({ symbol: "SOLUSDT", tf: "60", open, c });
  assert.equal(line.reason, "tp");
  assert.equal(line.source, "executions");
  assert.ok(line.netR > 1.15 && line.netR < 1.2, String(line.netR));
  // fechamento parcial ainda não conta
  assert.equal(closeFromExecutions(execs.slice(0, 3), open), null);
  // sem quantidade conhecida não chuta
  assert.equal(closeFromExecutions(execs, { ...open, qty: null }), null);
  // findClose: usa o closed-pnl quando existe, senão as execuções
  const fromPnl = await findClose({ getClosedPnl: async () => [{ qty: 332.4, exit: 69, closedPnl: 2100, closedAt: 2_000_100 }], getExecutions: async () => { throw new Error("não deveria chamar"); } }, "SOLUSDT", open);
  assert.equal(fromPnl.closedPnl, 2100);
  const fromExec = await findClose({ getClosedPnl: async () => [], getExecutions: async () => execs }, "SOLUSDT", open);
  assert.equal(fromExec.source, "executions");
});

test("closeFromExecutions: a demo devolve closedSize 0 — o lado oposto depois da abertura é o fechamento", async () => {
  const { closeFromExecutions } = await import("../src/services/bot.js");
  // XRP 4h adotada (vendida 35966,3), fechou no alvo; depois abriu a XRP 1h (venda) — não pode confundir
  const open = { side: "Sell", qty: 35966.3, entry: 1.0004, stop: 1.0498, tp: 0.9284, openedAt: 1_000_000 };
  const execs = [
    { side: "Buy", price: 0.9284, qty: 35966.3, fee: 18.3, closedSize: 0, execType: "Trade", time: 2_000_000 },
    { side: "Sell", price: 0.9236, qty: 23693.1, fee: 12, closedSize: 0, execType: "Trade", time: 2_200_000 },
  ];
  const c = closeFromExecutions(execs, open);
  assert.ok(c);
  assert.equal(c.closedAt, 2_000_000);
  assert.ok(Math.abs(c.exit - 0.9284) < 1e-9);
  assert.ok(Math.abs(c.closedPnl - ((1.0004 - 0.9284) * 35966.3 - 18.3)) < 1e-6); // a abertura foi antes da adoção: sem taxa dela
});

test("parseSymbols: aceita a lista ou só a quantidade", async () => {
  const { parseSymbols, DEFAULT_SYMBOLS } = await import("../src/services/bot.js");
  assert.deepEqual(parseSymbols("10"), DEFAULT_SYMBOLS);
  assert.deepEqual(parseSymbols("5"), DEFAULT_SYMBOLS.slice(0, 5));
  assert.deepEqual(parseSymbols(" btcusdt , ethusdt "), ["BTCUSDT", "ETHUSDT"]);
  assert.deepEqual(parseSymbols(""), DEFAULT_SYMBOLS);
  assert.deepEqual(parseSymbols(undefined), DEFAULT_SYMBOLS);
  assert.deepEqual(parseSymbols("dez"), DEFAULT_SYMBOLS); // nada válido → padrão
});
