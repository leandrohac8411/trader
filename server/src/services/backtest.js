// server/src/services/backtest.js
// Motor de backtest — função pura, sem rede.
// Mede a estratégia de consenso de duas formas:
//   1) simulação de trade  -> R-múltiplo, win-rate, expectativa, drawdown, curva de capital
//   2) retorno futuro       -> variação de preço N velas depois de cada sinal (calibra o %)

import { computeIndicators, evaluateBar, trendBiasSeries, DEFAULTS } from "./strategy.js";

const round = (n, p = 2) => (Number.isFinite(+n) ? Number(Number(n).toFixed(p)) : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// faixas de probabilidade (limites inferiores; a última vai até 100)
const BUCKET_EDGES = [50, 55, 60, 65, 70, 75, 80, 85, 90];

/**
 * @param {Array} candles velas ascendentes do timeframe operado
 * @param {object} [opts]
 * @param {Array|null} [opts.htfCandles] velas do timeframe maior (ascendentes) ou null
 * @param {number} [opts.warmup=60] primeira vela avaliada
 * @param {number} [opts.feePct=0.055] taxa por lado (%)
 * @param {number} [opts.slippagePct=0.02] slippage por lado (%)
 * @param {number} [opts.riskPerTradePct=1] risco por trade na curva de capital (%)
 * @param {number[]} [opts.forwardBars=[10,20,50]]
 * @param {{symbol?:string,interval?:string}} [opts.meta]
 * @param {number} [opts.rr1] [opts.rr2] [opts.lookback] ... (repassados à estratégia)
 */
export function runBacktest(candles, opts = {}) {
  const {
    htfCandles = null,
    warmup = 60,
    feePct = 0.055,
    slippagePct = 0.02,
    riskPerTradePct = 1,
    forwardBars = [10, 20, 50],
    reentryCooldown = 10, // velas de espera para reentrar numa tendência que persiste
    // regras de saída — defaults calibrados na fase 3:
    //   gate de entrada em prob >= 85 (DEFAULTS.minProbEntry) + NÃO sair por sinal oposto.
    //   BE/trailing ficam disponíveis mas desligados (resultado misto no grid).
    exitOnReverse = false,
    breakevenAfterTp1 = false,
    trailAtr = null,
    singleTarget = false,
    meta = {},
  } = opts;

  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < warmup + 30) {
    throw new Error(`Poucas velas para backtest (tem ${n}, precisa de ${warmup + 30}).`);
  }

  const stratOpts = pick(opts, [
    "emaFast", "emaSlow", "rsiPeriod", "atrPeriod", "stPeriod", "stMult",
    "rr1", "rr2", "lookback", "minProbEntry",
  ]);
  const ind = computeIndicators(candles, stratOpts);
  const atrArr = ind.atr;
  const open = candles.map((c) => Number(c.open ?? c.close ?? 0));
  const close = ind.close;
  const high = ind.high;
  const low = ind.low;

  // Viés HTF pré-calculado uma vez (evita recomputar EMA/RSI/MACD por vela → O(n²))
  const htfTs = htfCandles?.map((c) => Number(c.ts)) ?? null;
  const htfBiasArr = htfCandles
    ? trendBiasSeries(htfCandles.map((c) => Number(c.close)))
    : null;

  // ── passo 1: avalia TODA vela uma vez (usado pelos dois modos) ──────────────
  const evAll = new Array(n).fill(null);
  let hPtr = -1;
  for (let i = warmup; i < n; i++) {
    let htfBias = null;
    if (htfTs) {
      while (hPtr + 1 < htfTs.length && htfTs[hPtr + 1] <= Number(candles[i].ts)) hPtr++;
      if (hPtr >= 54) htfBias = htfBiasArr[hPtr];
    }
    evAll[i] = evaluateBar(candles, ind, i, { ...stratOpts, htfBias });
  }

  // ── passo 2: retorno futuro por sinal (usa o sinal BRUTO do consenso, sem gate,
  //    para que todas as faixas de probabilidade apareçam na calibração) ─────────
  const fwdSamples = [];
  for (let i = warmup; i < n; i++) {
    const ev = evAll[i];
    const rs = ev?.rawSignal ?? ev?.signal;
    if (!ev || rs === "NEUTRAL" || !rs) continue;
    const dir = rs === "LONG" ? 1 : -1;
    const fwd = {};
    for (const k of forwardBars) {
      fwd[k] = i + k < n ? round(dir * (close[i + k] / close[i] - 1) * 100, 4) : null;
    }
    fwdSamples.push({ i, probability: ev.probability, signal: rs, fwd });
  }

  // ── passo 3: simulação de trade ────────────────────────────────────────────
  const costPct = 2 * (feePct + slippagePct); // entrada + saída
  const trades = [];
  let pos = null;
  let lastExit = -Infinity;

  for (let i = warmup; i < n - 1; i++) {
    const ev = evAll[i];
    const prev = evAll[i - 1];

    if (pos) {
      const j = i; // avalia a vela atual como candidata a saída

      // trailing stop (ratchet: só anda a favor)
      if (trailAtr) {
        const ts =
          pos.dir === 1
            ? close[j] - trailAtr * atrArr[j]
            : close[j] + trailAtr * atrArr[j];
        if (pos.dir === 1 ? ts > pos.stop : ts < pos.stop) {
          pos.stop = ts;
          pos.stopReason = "trail";
        }
      }

      const hitStop = pos.dir === 1 ? low[j] <= pos.stop : high[j] >= pos.stop;
      const hitTp2 = pos.dir === 1 ? high[j] >= pos.tp2 : low[j] <= pos.tp2;
      const hitTp1 = pos.dir === 1 ? high[j] >= pos.tp1 : low[j] <= pos.tp1;
      const reversed =
        exitOnReverse && ev && ev.signal !== "NEUTRAL" && ev.signal !== pos.signal;

      // excursão (em R)
      const favExc = pos.dir === 1 ? high[j] - pos.entry : pos.entry - low[j];
      const advExc = pos.dir === 1 ? pos.entry - low[j] : high[j] - pos.entry;
      pos.mfe = Math.max(pos.mfe, favExc / pos.risk);
      pos.mae = Math.max(pos.mae, advExc / pos.risk);

      let exitPrice = null;
      let reason = null;
      if (hitStop) {
        exitPrice = pos.stop;
        reason = pos.stopReason || "stop";
      } else if (singleTarget && hitTp1) {
        exitPrice = pos.tp1;
        reason = "tp1";
      } else if (hitTp2) {
        exitPrice = pos.tp2;
        reason = "tp2";
      } else if (hitTp1 && !breakevenAfterTp1) {
        exitPrice = pos.tp1;
        reason = "tp1";
      } else if (hitTp1 && breakevenAfterTp1 && !pos.beMoved) {
        // toca o TP1 → trava o stop no preço de entrada e deixa correr até o TP2
        pos.stop = pos.entry;
        pos.beMoved = true;
        pos.stopReason = "be";
      } else if (reversed) {
        exitPrice = close[j];
        reason = "reverse";
      }

      if (exitPrice != null) {
        const grossR = (pos.dir * (exitPrice - pos.entry)) / pos.risk;
        const grossPnlPct = pos.dir * (exitPrice / pos.entry - 1) * 100;
        const riskPct = (pos.risk / pos.entry) * 100;
        const netR = grossR - costPct / riskPct;
        const netPnlPct = grossPnlPct - costPct;
        trades.push({
          entryIdx: pos.entryIdx,
          exitIdx: j,
          dir: pos.dir === 1 ? "LONG" : "SHORT",
          entry: round(pos.entry, 6),
          exit: round(exitPrice, 6),
          stop: round(pos.stop, 6),
          reason,
          grossR: round(grossR, 3),
          netR: round(netR, 3),
          netPnlPct: round(netPnlPct, 3),
          barsHeld: j - pos.entryIdx,
          mae: round(pos.mae, 2),
          mfe: round(pos.mfe, 2),
          probability: pos.probability,
        });
        pos = null;
        lastExit = j;
      }
    }

    // abre numa TRANSIÇÃO de sinal, OU reentra numa tendência que persiste após
    // o cooldown (evita reentrar a cada vela na mesma tendência)
    const freshSignal = prev && prev.signal !== ev?.signal;
    const canReenter = i - lastExit >= reentryCooldown;
    if (
      !pos &&
      i > lastExit &&
      ev &&
      ev.signal !== "NEUTRAL" &&
      ev.levels.stop != null &&
      (freshSignal || canReenter)
    ) {
      const dir = ev.signal === "LONG" ? 1 : -1;
      const entry = open[i + 1];
      const risk = Math.abs(entry - ev.levels.stop);
      if (risk > 1e-9) {
        pos = {
          entryIdx: i + 1,
          signal: ev.signal,
          dir,
          entry,
          stop: ev.levels.stop,
          tp1: ev.levels.tp1,
          tp2: ev.levels.tp2,
          risk,
          mae: 0,
          mfe: 0,
          probability: ev.probability,
        };
      }
    }
  }

  // ── passo 4: estatísticas de trade + curva de capital ─────────────────────
  const rs = trades.map((t) => t.netR);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));

  let equity = 1;
  const equityCurve = [1];
  let peak = 1;
  let maxDD = 0;
  for (const t of trades) {
    equity *= 1 + (t.netR * riskPerTradePct) / 100;
    equityCurve.push(round(equity, 5));
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
  }

  let maxConsecLoss = 0;
  let run = 0;
  for (const r of rs) {
    if (r <= 0) {
      run++;
      maxConsecLoss = Math.max(maxConsecLoss, run);
    } else run = 0;
  }

  const tradeStats = {
    n: trades.length,
    wins: wins.length,
    winRate: round(trades.length ? wins.length / trades.length : 0, 3),
    avgR: round(mean(rs), 3),
    expectancyR: round(mean(rs), 3),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    maxConsecLoss,
    avgBarsHeld: round(mean(trades.map((t) => t.barsHeld)), 1),
    totalReturnPct: round((equity - 1) * 100, 2),
    maxDrawdownPct: round(maxDD * 100, 2),
    equityCurve,
    byReason: countBy(trades.map((t) => t.reason)),
  };

  // ── passo 5: calibração (retorno futuro por faixa de probabilidade) ────────
  const calibration = [];
  for (let b = 0; b < BUCKET_EDGES.length; b++) {
    const lo = BUCKET_EDGES[b];
    const hi = b + 1 < BUCKET_EDGES.length ? BUCKET_EDGES[b + 1] : 101;
    const inBucket = fwdSamples.filter((s) => s.probability >= lo && s.probability < hi);
    const withF20 = inBucket.filter((s) => s.fwd[20] != null);
    const tradesInBucket = trades.filter(
      (t) => t.probability >= lo && t.probability < hi
    );
    calibration.push({
      range: `${lo}–${hi === 101 ? 100 : hi}`,
      n: inBucket.length,
      winRate: withF20.length
        ? round(withF20.filter((s) => s.fwd[20] > 0).length / withF20.length, 3)
        : null,
      avgFwd20Pct: withF20.length ? round(mean(withF20.map((s) => s.fwd[20])), 3) : null,
      trades: tradesInBucket.length,
      avgR: tradesInBucket.length
        ? round(mean(tradesInBucket.map((t) => t.netR)), 3)
        : null,
    });
  }

  const byForwardBar = {};
  for (const k of forwardBars) {
    const withK = fwdSamples.filter((s) => s.fwd[k] != null);
    byForwardBar[k] = {
      n: withK.length,
      winRate: withK.length
        ? round(withK.filter((s) => s.fwd[k] > 0).length / withK.length, 3)
        : null,
      avgReturnPct: withK.length ? round(mean(withK.map((s) => s.fwd[k])), 3) : null,
    };
  }

  return {
    meta: {
      symbol: meta.symbol ?? null,
      interval: meta.interval ?? null,
      candles: n,
      from: candles[0]?.ts ? new Date(Number(candles[0].ts)).toISOString() : null,
      to: candles[n - 1]?.ts ? new Date(Number(candles[n - 1].ts)).toISOString() : null,
      htf: !!htfCandles,
      signals: fwdSamples.length,
      params: {
        ...DEFAULTS,
        ...stratOpts,
        feePct,
        slippagePct,
        riskPerTradePct,
        warmup,
        exit: { exitOnReverse, breakevenAfterTp1, trailAtr, singleTarget },
      },
    },
    trades: tradeStats,
    tradeList: trades,
    calibration,
    byForwardBar,
  };
}

// ─────────────────────────── grid de regras de saída ───────────────────────────
const GRID = {
  minProbEntry: [0, 75, 85],
  exitOnReverse: [false, true],
  breakevenAfterTp1: [false, true],
  trailAtr: [null, 2, 3],
  singleTarget: [false, true],
};

/**
 * Roda o backtest para várias combinações de saída e devolve o ranking por
 * expectativa (R/trade), preferindo variantes com amostra suficiente.
 * @returns {{ variants: Array, best: object|null, note: string|null, meta: object }}
 */
export function runGrid(candles, opts = {}) {
  const { minTrades = 12 } = opts;
  const base = pick(opts, [
    "htfCandles", "warmup", "feePct", "slippagePct", "riskPerTradePct",
    "reentryCooldown", "emaFast", "emaSlow", "rsiPeriod", "atrPeriod",
    "stPeriod", "stMult", "rr1", "rr2", "lookback", "meta",
  ]);

  const variants = [];
  for (const minProbEntry of GRID.minProbEntry) {
    for (const exitOnReverse of GRID.exitOnReverse) {
      for (const breakevenAfterTp1 of GRID.breakevenAfterTp1) {
        for (const trailAtr of GRID.trailAtr) {
          for (const singleTarget of GRID.singleTarget) {
            let r;
            try {
              r = runBacktest(candles, {
                ...base,
                minProbEntry,
                exitOnReverse,
                breakevenAfterTp1,
                trailAtr,
                singleTarget,
              });
            } catch {
              continue;
            }
            variants.push({
              params: { minProbEntry, exitOnReverse, breakevenAfterTp1, trailAtr, singleTarget },
              trades: r.trades.n,
              winRate: r.trades.winRate,
              expectancyR: r.trades.expectancyR,
              profitFactor: r.trades.profitFactor,
              totalReturnPct: r.trades.totalReturnPct,
              maxDrawdownPct: r.trades.maxDrawdownPct,
            });
          }
        }
      }
    }
  }

  variants.sort((a, b) => b.expectancyR - a.expectancyR);
  const eligible = variants.filter((v) => v.trades >= minTrades);
  const best = eligible[0] || variants[0] || null;
  const note = eligible.length
    ? null
    : `nenhuma variante atingiu ${minTrades} trades no período — 'best' é a de maior expectativa mesmo com amostra pequena`;

  return {
    variants,
    best,
    note,
    meta: {
      symbol: opts.meta?.symbol ?? null,
      interval: opts.meta?.interval ?? null,
      candles: candles.length,
      combos: variants.length,
      minTrades,
    },
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}
function countBy(arr) {
  const out = {};
  for (const x of arr) out[x] = (out[x] || 0) + 1;
  return out;
}
