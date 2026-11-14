// server/src/services/school.js
// Escola de traders: variantes ("alunos") da MESMA estratégia de consenso, avaliadas
// em papel. Nada aqui envia ordens. A promoção para o bot demo é opt-in
// (BOT_SCHOOL_PROMOTE=1) e só acontece quando o aluno passa nas três etapas:
//   1) estudo  — primeiros 70% das velas (escolhe o candidato)
//   2) prova   — últimos 30% (fora da amostra usada na escolha; só confirma/nega)
//   3) papel   — trades que começaram DEPOIS que a escola abriu (forward real)
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from "./datafs.js";
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
  breakevenAtR: [0.5, 3],
};

// Base fixa da escola: perfil v2 (score ≥ 90, alvo 3R, SuperTrend 4). Os parâmetros de cada aluno se somam a ela,
// então trocar o perfil do bot não muda o que cada aluno testa.
export const SCHOOL_BASE = { minProbEntry: 90, rr1: 3, stMult: 4 };
// interval: período das velas do aluno (padrão: o da escola, 1h).
export const STUDENTS = [
  { id: "base", name: "Bia", emoji: "📘", color: "#8fb3ff", style: "Perfil v2, o bot até 13/11 (score ≥ 90, alvo 3R, SuperTrend 4)", params: {} },
  { id: "antigo", name: "Rafa", emoji: "🕰️", color: "#9aa7ad", style: "O bot antigo (score ≥ 85, alvo 1,5R, SuperTrend 3), para comparar", params: { minProbEntry: 85, rr1: 1.5, stMult: 3 } },
  { id: "alvo", name: "Hugo", emoji: "🏹", color: "#7fe0a6", style: "Candidata: alvo 2R", params: { rr1: 2 } },
  { id: "quatro", name: "Lia", emoji: "🌙", color: "#6fd3e0", style: "Candidata 4h: alvo 2R, SuperTrend 3", interval: "240", params: { rr1: 2, stMult: 3 } },
  { id: "quatro3", name: "Gil", emoji: "🦉", color: "#e0c36f", style: "Candidata 4h: alvo 3R, SuperTrend 3", interval: "240", params: { stMult: 3 } },
  { id: "rapido", name: "Caio", emoji: "⚡", color: "#ffcf5a", style: "Entra mais cedo (score ≥ 85)", params: { minProbEntry: 85 } },
  { id: "curto", name: "Duda", emoji: "🎯", color: "#ff8fb1", style: "Alvo curto, 1,5R", params: { rr1: 1.5 } },
  { id: "lento", name: "Nina", emoji: "🐢", color: "#c7a0ff", style: "Médias lentas (EMA 30/100)", params: { emaFast: 30, emaSlow: 100 } },
  { id: "largo", name: "Theo", emoji: "🧱", color: "#ffa66b", style: "Stop no swing de 10 velas", params: { lookback: 10 } },
  { id: "empate", name: "Vera", emoji: "🛡️", color: "#9fd8c4", style: "Igual ao bot, mas sobe o stop para a entrada quando chega a 50% do alvo (1,5R)", params: { breakevenAtR: 1.5 } },
  { id: "atual", name: "Lara", emoji: "🧭", color: "#f2b56b", style: "O bot de hoje (perfil v3): 1h, alvo 2R, stop no empate em 1,5R", params: { rr1: 2, breakevenAtR: 1.5 } },
];

// Troca de turma (13/11/2026: bot passou ao perfil v2). Mudar a turma zera o papel:
// trades em papel da turma antiga não valem para alunos com outros parâmetros.
// O arquivo de papel precisa estar em DATA_FILES (datafs.js) para persistir no Upstash.
export const SCHOOL_VERSION = "v2";
export const PAPER_FILE = `school-paper-${SCHOOL_VERSION}.jsonl`;

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
  if (!s?.promotion?.ready || !s.promotion.studentId || s.version !== SCHOOL_VERSION) return null;
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
  rules = SCHOOL_RULES, promoteEnabled = false, backtest = runBacktest, students = STUDENTS } = {}) {
  const stateFile = fileIn(dataDir, "school.json");
  const paperFile = fileIn(dataDir, PAPER_FILE);
  let saved = readSchoolState(dataDir);
  if (saved && saved.version !== SCHOOL_VERSION) saved = null; // turma nova: começa do zero
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
      // velas por período (1h para a maioria; 4h para quem pede)
      const byInterval = {};
      for (const iv of [...new Set(students.map((s) => s.interval || interval))]) {
        const list = [];
        for (const symbol of symbols) {
          try { list.push({ symbol, ...(await loadInputs(symbol, iv)) }); } catch { /* mercado indisponível */ }
        }
        byInterval[iv] = list;
      }
      const datasets = byInterval[interval] || Object.values(byInterval)[0] || [];
      if (!datasets.length) throw Error("Sem velas para avaliar.");
      const graded = students.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, style: s.style,
        interval: s.interval || interval,
        ...gradeStudent(s, byInterval[s.interval || interval] || [], { split: rules.split, baseParams, backtest }) }));

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
        version: SCHOOL_VERSION, startedAt, lastRun: now(), interval, symbols: datasets.map((d) => d.symbol),
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

  // Serverless: recarrega o que outra execução gravou e diz se já é hora de reavaliar.
  function reload() {
    saved = readSchoolState(dataDir);
    if (saved && saved.version !== SCHOOL_VERSION) saved = null;
    if (saved?.startedAt) startedAt = saved.startedAt;
    result = saved?.students ? saved : null;
  }
  const due = () => !result?.lastRun || now() - result.lastRun >= everyMs;

  return {
    run, snapshot, reload, due,
    start: (delay = 5_000) => schedule(delay),
    stop: () => { clearTimeout(timer); timer = null; nextRun = null; },
  };
}
