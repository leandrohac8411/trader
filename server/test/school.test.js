import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  STUDENTS, SCHOOL_VERSION, sanitizeParams, statsR, gradeStudent, studentStatus, rankSchool, createSchool, readPromotion,
} from "../src/services/school.js";

const T0 = 1_700_000_000_000;
const tr = (...rs) => rs.map((netR) => ({ netR }));
const tmpDir = () => pathToFileURL(mkdtempSync(join(tmpdir(), "school-")) + "/");

// backtest falso: devolve trades em índices fixos, com R dependente dos parâmetros
function fakeBacktest(candles, opts) {
  const sign = opts.minProbEntry === 75 ? 1 : -1;
  return { tradeList: [
    { entryIdx: 10, exitIdx: 12, dir: "LONG", netR: 0.5 * sign, reason: "tp1" },
    { entryIdx: 90, exitIdx: 95, dir: "SHORT", netR: 1 * sign, reason: "tp1" },
  ] };
}
const candles = (n = 100, start = T0) => Array.from({ length: n }, (_, i) => ({ ts: start + i * 3_600_000, open: 1, high: 1, low: 1, close: 1 }));

test("sanitizeParams aceita só a lista e limita os valores", () => {
  assert.deepEqual(sanitizeParams({ minProbEntry: 10, rr1: 9, leverage: 50, riskPct: 5 }), { minProbEntry: 60, rr1: 3 });
  assert.deepEqual(sanitizeParams({ emaFast: 80, emaSlow: 40 }), {}); // rápida >= lenta: descarta
  assert.ok(STUDENTS.some((s) => s.id === "base" && Object.keys(s.params).length === 0));
});

test("statsR calcula expectativa, PF e drawdown em R", () => {
  const s = statsR(tr(1, -1, -1, 2));
  assert.equal(s.n, 4);
  assert.equal(s.expectancyR, 0.25);
  assert.equal(s.profitFactor, 1.5);
  assert.equal(s.maxDrawdownR, 2);
  assert.equal(statsR([]).expectancyR, 0);
});

test("gradeStudent separa estudo e prova pela vela de entrada", () => {
  const g = gradeStudent({ params: { minProbEntry: 75 } }, [{ symbol: "BTCUSDT", candles: candles() }], { backtest: fakeBacktest });
  assert.equal(g.study.n, 1);
  assert.equal(g.exam.n, 1);
  assert.equal(g.trades[0].entryTs, T0 + 10 * 3_600_000);
  assert.equal(g.params.minProbEntry, 75);
});

test("studentStatus exige amostra e expectativa positiva nas duas fases", () => {
  const rules = { minStudy: 2, minExam: 1 };
  assert.equal(studentStatus({ study: statsR(tr(1)), exam: statsR(tr(1)) }, rules).code, "amostra");
  assert.equal(studentStatus({ study: statsR(tr(1, -2)), exam: statsR(tr(1)) }, rules).code, "reprovado");
  assert.equal(studentStatus({ study: statsR(tr(1, 1)), exam: statsR([]) }, rules).code, "aguardando");
  assert.equal(studentStatus({ study: statsR(tr(1, 1)), exam: statsR(tr(-1)) }, rules).code, "reprovado-prova");
  assert.equal(studentStatus({ study: statsR(tr(1, 1)), exam: statsR(tr(1)) }, rules).code, "aprovado");
});

test("rankSchool escolhe pelo estudo e só promove com prova + papel + melhor que a base", () => {
  const rules = { minStudy: 2, minExam: 1, minPaper: 2 };
  const graded = [
    { id: "base", name: "Bia", study: statsR(tr(0.2, 0.2)), exam: statsR(tr(1)) },
    { id: "rapido", name: "Caio", study: statsR(tr(1, 1)), exam: statsR(tr(-1)) }, // melhor no estudo, cai na prova
    { id: "curto", name: "Duda", study: statsR(tr(0.5, 0.5)), exam: statsR(tr(5)) }, // ótima prova, não é escolhida por ela
  ];
  let r = rankSchool(graded, { rules });
  assert.equal(r.candidateId, "rapido");
  assert.equal(r.students[0].rank, 1);
  assert.equal(r.promotion.ready, false);
  assert.ok(r.promotion.reasons.some((x) => /prova/.test(x)));

  graded[1].exam = statsR(tr(1));
  r = rankSchool(graded, { rules, paper: { rapido: tr(0.4) } });
  assert.equal(r.promotion.ready, false); // papel com 1/2
  r = rankSchool(graded, { rules, paper: { rapido: tr(0.4, 0.3) } });
  assert.equal(r.promotion.ready, true);
  assert.deepEqual(r.promotion.reasons, []);

  // se a base é a melhor, não há nada a promover
  r = rankSchool([{ ...graded[0], study: statsR(tr(2, 2)) }, graded[1]], { rules, paper: { base: tr(1, 1) } });
  assert.equal(r.candidateId, "base");
  assert.equal(r.promotion.ready, false);
});

test("createSchool grava papel só depois da abertura, sem duplicar, e persiste o ranking", async () => {
  const dataDir = tmpDir();
  try {
    let now = T0 + 50 * 3_600_000; // escola abre no meio da série: só o trade da vela 90 conta em papel
    const school = createSchool({ dataDir, symbols: ["BTCUSDT"], now: () => now,
      loadInputs: async () => ({ candles: candles() }), backtest: fakeBacktest,
      rules: { split: 0.7, minStudy: 1, minExam: 1, minPaper: 1 } });
    assert.equal(await school.run(), true);
    const snap = school.snapshot();
    assert.equal(snap.students.length, STUDENTS.length);
    assert.ok(snap.lastRun);
    assert.ok(existsSync(new URL("school.json", dataDir)));
    now += 1000;
    await school.run();
    const paperFile = new URL("school-paper.jsonl", dataDir);
    const lines = existsSync(paperFile) ? readFileSync(paperFile, "utf8").trim().split("\n").filter(Boolean) : [];
    assert.equal(new Set(lines).size, lines.length);
    for (const l of lines) assert.ok(JSON.parse(l).entryTs >= T0 + 50 * 3_600_000);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("createSchool busca as velas do período de cada aluno (1h e 4h)", async () => {
  const dataDir = tmpDir();
  try {
    const asked = [];
    const school = createSchool({ dataDir, symbols: ["BTCUSDT"], now: () => T0,
      loadInputs: async (symbol, interval) => { asked.push(interval); return { candles: candles() }; }, backtest: fakeBacktest,
      students: [{ id: "base", name: "Bia", params: {} }, { id: "q", name: "Lia", interval: "240", params: { rr1: 2 } }] });
    assert.equal(await school.run(), true);
    assert.deepEqual(asked.sort(), ["240", "60"]);
    const snap = school.snapshot();
    assert.equal(snap.students.find((s) => s.id === "q").interval, "240");
    assert.equal(snap.students.find((s) => s.id === "base").interval, "60");
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("o arquivo de papel da turma atual persiste no Upstash (DATA_FILES)", async () => {
  const { PAPER_FILE } = await import("../src/services/school.js");
  const { DATA_FILES } = await import("../src/services/datafs.js");
  assert.ok(DATA_FILES.includes(PAPER_FILE));
  assert.ok(DATA_FILES.includes("school.json"));
});

test("STUDENTS: ids únicos e a turma base é o bot", () => {
  assert.equal(new Set(STUDENTS.map((s) => s.id)).size, STUDENTS.length);
  assert.deepEqual(STUDENTS.find((s) => s.id === "base").params, {});
});

test("readPromotion só devolve parâmetros saneados quando pronto", async () => {
  const dataDir = tmpDir();
  try {
    const { writeFileSync } = await import("node:fs");
    const write = (o) => writeFileSync(new URL("school.json", dataDir), JSON.stringify(o));
    assert.equal(readPromotion(dataDir), null);
    write({ promotion: { ready: false, studentId: "rapido" }, students: [{ id: "rapido", params: { minProbEntry: 75 } }] });
    assert.equal(readPromotion(dataDir), null);
    write({ version: SCHOOL_VERSION, promotion: { ready: true, studentId: "rapido" }, students: [{ id: "rapido", name: "Caio", params: { minProbEntry: 75, leverage: 20 } }] });
    assert.deepEqual(readPromotion(dataDir).params, { minProbEntry: 75 });
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
