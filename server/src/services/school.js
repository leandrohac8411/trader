// server/src/services/school.js
// Escola de traders: variantes ("alunos") da MESMA estratégia de consenso, avaliadas
// em papel. Nada aqui envia ordens. A promoção para o bot demo é opt-in
// (BOT_SCHOOL_PROMOTE=1) e só acontece quando o aluno passa nas três etapas:
//   1) estudo  — primeiros 70% das velas (escolhe o candidato)
//   2) prova   — últimos 30% (fora da amostra usada na escolha; só confirma/nega)
//   3) papel   — trades que começaram DEPOIS que a escola abriu (forward real)
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { runBacktest } from "./backtest.js";

const round = (n, p = 3) => (Number.isFinite(+n) ? Number(Number(n).toFixed(p)) : 0);

// Só parâmetros que o bot honra (entrada + níveis); saída sempre stop/TP1 como o bot.
export const PARAM_BOUNDS = {
  minProbEntry: [60, 95],
  rr1: [0.8, 3],
  stMult: [2, 5],
  emaFast: [5, 60],
  emaSlow: [20, 200],
  lookback: [3, 20],
};

export const STUDENTS = [
  { id: "base", name: "Bia", emoji: "📘", color: "#8fb3ff", style: "Faz exatamente o que o bot faz hoje", params: {} },
  { id: "rapido", name: "Caio", emoji: "⚡", color: "#ffcf5a", style: "Entra mais cedo (score ≥ 75)", params: { minProbEntry: 75 } },
  { id: "curto", name: "Duda", emoji: "🎯", color: "#ff8fb1", style: "Alvo curto, 1R", params: { rr1: 1 } },
  { id: "alvo", name: "Hugo", emoji: "🏹", color: "#7fe0a6", style: "Alvo longo, 2R", params: { rr1: 2 } },
  { id: "lento", name: "Nina", emoji: "🐢", color: "#c7a0ff", style: "Médias lentas (EMA 30/100)", params: { emaFast: 30, emaSlow: 100 } },
  { id: "largo", name: "Theo", emoji: "🧱", color: "#ffa66b", style: "Stop mais largo (SuperTrend 4×, swing 10)", params: { stMult: 4, lookback: 10 } },
];

export const SCHOOL_RULES = { split: 0.7, minStudy: 15, minExam: 6, minPaper: 10 };

/** Limita e filtra parâmetros (nunca passa nada fora da lista para o bot). */
export function sanitizeParams(params = {}) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(PARAM_BOUNDS)) {
    const v = Number(params[k]);
    if (params[k] != null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  if (out.emaFast != null && out.emaSlow != null && out.emaFast >= out.emaSlow) {
    delete out.emaFast;
    delete out.emaSlow;
  }
  return out;
}

/** Estatística em R de uma lista de trades ({netR}). */
export function statsR(trades) {
  const rs = trades.map((t) => Number(t.netR) || 0);
  const wins = rs.filter((r) => r > 0);
  const gw = wins.reduce((s, r) => s + r, 0);
  const gl = Math.abs(rs.filter((r) => r <= 0).reduce((s, r) => s + r, 0));
  let cum = 0, peak = 0, dd = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return {
    n: rs.length,
    wins: wins.length,
    winRate: round(rs.length ? wins.length / rs.length : 0),
    expectancyR: round(rs.length ? cum / rs.length : 0),
    totalR: round(cum, 2),
    profitFactor: gl > 0 ? round(gw / gl, 2) : null,
    maxDrawdownR: round(dd, 2),
  };
}

/**
 * Roda o aluno em cada mercado e separa os trades em estudo/prova pela vela de entrada.
 * @param {{params:object}} student
 * @param {Array<{symbol:string,candles:Array,htfCandles?:Array}>} datasets
 */
export function gradeStudent(student, datasets, { split = SCHOOL_RULES.split, baseParams = {}, backtest = runBacktest } = {}) {
  const params = { ...sanitizeParams(baseParams), ...sanitizeParams(student.params) };
  const trades = [];
  const errors = [];
  for (const d of datasets) {
    if (!d?.candles?.length) continue;
    const cut = Math.floor(d.candles.length * split);
    let r;
    try {
      r = backtest(d.candles, { htfCandles: d.htfCandles || null, singleTarget: true, ...params, meta: { symbol: d.symbol } });
    } catch (e) {
      errors.push(`${d.symbol}: ${e.message}`);
      continue;
    }
    for (const t of r.tradeList) {
      trades.push({
        symbol: d.symbol,
        dir: t.dir,
        netR: t.netR,
        reason: t.reason,
        entryTs: Number(d.candles[t.entryIdx]?.ts),
        exitTs: Number(d.candles[t.exitIdx]?.ts),
        phase: t.entryIdx < cut ? "study" : "exam",
      });
    }
  }
  return {
    params,
    trades,
    errors,
    study: statsR(trades.filter((t) => t.phase === "study")),
    exam: statsR(trades.filter((t) => t.phase === "exam")),
  };
}

/** Situação de um aluno (texto curto para a UI). */
export function studentStatus({ study, exam }, rules = SCHOOL_RULES) {
  if (study.n < rules.minStudy) return { code: "amostra", label: "Poucos trades no estudo" };
  if (study.expectancyR <= 0) return { code: "reprovado", label: "Reprovado no estudo" };
  if (exam.n < rules.minExam) return { code: "aguardando", label: "Aguardando prova" };
  if (exam.expectancyR <= 0) return { code: "reprovado-prova", label: "Reprovado na prova" };
  return { code: "aprovado", label: "Aprovado na prova" };
}

/**
 * Ranking + decisão de promoção.
 * O candidato é escolhido SÓ pelo estudo (evita escolher pelo resultado da prova).
 * Pronto para promoção = aprovado na prova + papel com amostra e expectativa > 0 +
 * melhor que a turma base no estudo.
 */
export function rankSchool(graded, { paper = {}, rules = SCHOOL_RULES, baseId = "base" } = {}) {
  const rows = graded.map((g) => {
    const p = statsR(paper[g.id] || []);
    return { ...g, paper: p, status: studentStatus(g, rules) };
  });
  const eligible = rows.filter((r) => r.study.n >= rules.minStudy);
  const ordered = [
    ...eligible.sort((a, b) => b.study.expectancyR - a.study.expectancyR),
    ...rows.filter((r) => r.study.n < rules.minStudy).sort((a, b) => b.study.n - a.study.n),
  ].map((r, i) => ({ ...r, rank: i + 1 }));

  const candidate = ordered.find((r) => r.study.n >= rules.minStudy && r.study.expectancyR > 0) || null;
  const base = rows.find((r) => r.id === baseId);
  const reasons = [];
  if (!candidate) reasons.push("Nenhum aluno teve expectativa positiva no estudo com amostra suficiente.");
  else {
    if (candidate.status.code !== "aprovado") reasons.push(`${candidate.name}: ${candidate.status.label.toLowerCase()}.`);
    if (candidate.paper.n < rules.minPaper) reasons.push(`${candidate.name}: ${candidate.paper.n}/${rules.minPaper} trades em papel desde a abertura da escola.`);
    else if (candidate.paper.expectancyR <= 0) reasons.push(`${candidate.name}: expectativa negativa em papel (${candidate.paper.expectancyR} R).`);
    if (candidate.id === baseId) reasons.push("A turma base (o bot atual) é a melhor: nada a trocar.");
    else if (base && candidate.study.expectancyR <= base.study.expectancyR) reasons.push("Não supera a turma base no estudo.");
  }
  return {
    students: ordered,
    candidateId: candidate?.id || null,
    promotion: { ready: !!candidate && reasons.length === 0, studentId: candidate?.id || null, reasons },
  };
}

// ─────────────────────────── persistência (data/) ───────────────────────────
const fileIn = (dataDir, name) => new URL(name, dataDir);

export function readSchoolState(dataDir) {
  const f = fileIn(dataDir, "school.json");
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

/** Parâmetros promovidos, se a promoção estiver pronta. Usado pelo bot só com BOT_SCHOOL_PROMOTE=1. */
export function readPromotion(dataDir) {
  const s = readSchoolState(dataDir);
  if (!s?.promotion?.ready || !s.promotion.studentId) return null;
  const st = s.students?.find((x) => x.id === s.promotion.studentId);
  if (!st) return null;
  return { studentId: st.id, name: st.name, params: sanitizeParams(st.params), at: s.lastRun };
}

/**
 * Executor periódico (impuro): busca velas, avalia, grava papel e estado.
 * @param {object} o
 * @param {(symbol:string)=>Promise<{candles:Array,htfCandles?:Array}>} o.loadInputs
 */
export function createSchool({ loadInputs, dataDir, symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
  interval = "60", baseParams = {}, everyMs = 30 * 60_000, now = Date.now, onChange = () => {}, onEvent = () => {},
  rules = SCHOOL_RULES, promoteEnabled = false, backtest = runBacktest } = {}) {
  const stateFile = fileIn(dataDir, "school.json");
  const paperFile = fileIn(dataDir, "school-paper.jsonl");
  let saved = readSchoolState(dataDir);
  let startedAt = saved?.startedAt || now();
  let running = false, timer = null, lastError = null, nextRun = null;
  let result = saved?.students ? saved : null;

  function readPaper() {
    if (!existsSync(paperFile)) return [];
    return readFileSync(paperFile, "utf8").split(/\r?\n/).filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    });
  }

  async function run() {
    if (running) return false;
    running = true;
    lastError = null;
    onChange();
    try {
      const datasets = [];
      for (const symbol of symbols) {
        try { datasets.push({ symbol, ...(await loadInputs(symbol)) }); } catch { /* mercado indisponível */ }
      }
      if (!datasets.length) throw Error("Sem velas para avaliar.");
      const graded = STUDENTS.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, style: s.style,
        ...gradeStudent(s, datasets, { split: rules.split, baseParams, backtest }) }));

      // papel: grava trades encerrados que COMEÇARAM depois da abertura da escola
      const seen = new Set(readPaper().map((p) => p.key));
      mkdirSync(dataDir, { recursive: true });
      for (const g of graded) {
        for (const t of g.trades) {
          if (!(t.entryTs >= startedAt)) continue;
          const key = `${g.id}|${t.symbol}|${t.entryTs}`;
          if (seen.has(key)) continue;
          seen.add(key);
          appendFileSync(paperFile, JSON.stringify({ key, student: g.id, ...t, phase: "paper", recordedAt: now() }) + "\n");
        }
      }
      const paper = {};
      for (const p of readPaper()) (paper[p.student] ||= []).push(p);

      const ranked = rankSchool(graded, { paper, rules });
      const wasReady = result?.promotion?.ready ? result.promotion.studentId : null;
      result = {
        startedAt, lastRun: now(), interval, symbols: datasets.map((d) => d.symbol),
        candles: datasets[0]?.candles?.length || 0, rules,
        candidateId: ranked.candidateId, promotion: ranked.promotion,
        // eslint-disable-next-line no-unused-vars
        students: ranked.students.map(({ trades, errors, ...rest }) => ({ ...rest, errors: errors.slice(0, 3) })),
      };
      writeFileSync(stateFile, JSON.stringify(result, null, 2));
      const nowReady = result.promotion.ready ? result.promotion.studentId : null;
      if (nowReady !== wasReady) {
        const st = result.students.find((s) => s.id === (nowReady || wasReady));
        onEvent({ type: nowReady ? "school.promoted" : "school.demoted",
          message: nowReady ? `${st?.name} pronto para promoção ao bot demo` : `${st?.name} perdeu a vaga de promoção` });
      }
      onEvent({ type: "school.graded", message: `Escola avaliada: ${graded.length} alunos em ${datasets.length} mercados`, quiet: true });
      return true;
    } catch (e) {
      lastError = "A avaliação da escola falhou; tenta de novo no próximo ciclo.";
      onEvent({ type: "school.failed", message: e.message });
      return false;
    } finally {
      running = false;
      onChange();
    }
  }

  function schedule(delay = everyMs) {
    clearTimeout(timer);
    nextRun = now() + delay;
    timer = setTimeout(async () => { await run(); schedule(); }, delay);
    timer.unref?.();
  }

  function snapshot() {
    return {
      running, lastError, nextRun: nextRun ? new Date(nextRun).toISOString() : null,
      startedAt: new Date(startedAt).toISOString(), rules, interval, symbols,
      lastRun: result?.lastRun ? new Date(result.lastRun).toISOString() : null,
      candles: result?.candles || 0,
      candidateId: result?.candidateId || null,
      promotion: result ? { ...result.promotion, appliedToBot: promoteEnabled && !!result.promotion.ready } : null,
      students: result?.students || [],
    };
  }

  return {
    run, snapshot,
    start: (delay = 5_000) => schedule(delay),
    stop: () => { clearTimeout(timer); timer = null; nextRun = null; },
  };
}
