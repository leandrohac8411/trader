import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createManager, managerContext, normalizeReview, REVIEW_SCHEMA } from "../src/services/manager.js";

const tmp = () => pathToFileURL(mkdtempSync(join(tmpdir(), "mgr-")) + "/");
const snap = {
  mode: "demo",
  bot: { enabled: false, dryRun: true, paused: false, positions: [], summary: { n: 2 }, config: { riskPct: 1 }, token: "SEGREDO" },
  crew: { trader: { mood: "normal", reason: "ok", streak: 1, today: { wins: 1, losses: 0 }, lossUsage: 0, cooldown: false } },
  game: { ladder: { name: "Base", riskPct: 1, wins: 1, winsToUp: 10, losses: 1, lossesToDown: 5, appliedToBot: false },
    goal: { totalUsd: 10, targetUsd: 1000 }, achievements: [{ label: "Primeiro trade", done: true }, { label: "x", done: false }] },
  school: { lastRun: "2026-11-11T16:00:00Z", candidateId: null, promotion: { ready: false, reasons: ["nenhum"] },
    students: [{ name: "Bia", style: "base", status: { label: "Reprovado" }, study: { n: 40 }, exam: { n: 5 }, paper: { n: 0 }, params: {} }] },
  monitor: { items: [{ symbol: "BTCUSDT", decision: "Aguardar", probability: 40, stale: false }] },
  events: [{ message: "evento" }],
};
const good = { resumo: "Tudo calmo.", pontos: [{ area: "escola", status: "atencao", texto: "Ninguém aprovado." }, { area: "nada", status: "ok", texto: "x" }], proximos_passos: ["a", "b", "c", "d"] };
function fakeClient(reply, capture = {}) {
  return { beta: { messages: { create: async (req) => { Object.assign(capture, req); return reply(req); } } } };
}
const ok = (obj) => () => ({ stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify(obj) }] });

test("managerContext não leva segredos e resume a escola", () => {
  const c = managerContext(snap);
  assert.ok(!JSON.stringify(c).includes("SEGREDO"));
  assert.equal(c.escola.alunos[0].nome, "Bia");
  assert.deepEqual(c.conquistas, ["Primeiro trade"]);
});

test("normalizeReview filtra áreas inválidas e limita passos", () => {
  const r = normalizeReview(good);
  assert.equal(r.pontos.length, 1);
  assert.equal(r.proximos_passos.length, 3);
  assert.throws(() => normalizeReview({ pontos: [] }));
  assert.equal(REVIEW_SCHEMA.additionalProperties, false);
});

test("review chama o modelo com schema, fallbacks e sem ferramentas; grava o parecer", async () => {
  const dataDir = tmp();
  try {
    const cap = {};
    const m = createManager({ client: fakeClient(ok(good), cap), dataDir, enabled: true });
    const r = await m.review(snap);
    assert.equal(r.resumo, "Tudo calmo.");
    assert.equal(cap.model, "claude-opus-5-5");
    assert.equal(cap.fallbacks, "default");
    assert.equal(cap.output_config.format.type, "json_schema");
    assert.equal(cap.tools, undefined);
    assert.ok(existsSync(new URL("manager-review.json", dataDir)));
    assert.equal(m.snapshot().last.resumo, "Tudo calmo.");
    await assert.rejects(m.review(snap), /Aguarde/); // intervalo mínimo
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("review falha de forma clara: desligado, recusa e JSON inválido", async () => {
  const dataDir = tmp();
  try {
    await assert.rejects(createManager({ dataDir, enabled: false }).review(snap), /ANTHROPIC_API_KEY/);
    const refused = createManager({ client: fakeClient(() => ({ stop_reason: "refusal", content: [] })), dataDir, enabled: true });
    await assert.rejects(refused.review(snap), /recusou/);
    assert.match(refused.snapshot().error, /recusou/);
    const bad = createManager({ client: fakeClient(() => ({ stop_reason: "end_turn", content: [{ type: "text", text: "oi" }] })), dataDir, enabled: true });
    await assert.rejects(bad.review(snap));
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
