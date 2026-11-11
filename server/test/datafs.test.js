import test from "node:test";
import assert from "node:assert/strict";
import * as datafs from "../src/services/datafs.js";

// Redis falso: só os comandos que o datafs usa.
function fakeRedis() {
  const db = new Map(); const calls = [];
  const run = ([cmd, ...a]) => {
    calls.push(cmd);
    if (cmd === "MGET") return a.map((k) => db.get(k) ?? null);
    if (cmd === "GET") return db.get(a[0]) ?? null;
    if (cmd === "DEL") return db.delete(a[0]) ? 1 : 0;
    if (cmd === "SET") { if (a.includes("NX") && db.has(a[0])) return null; db.set(a[0], a[1]); return "OK"; }
    throw new Error(cmd);
  };
  return { db, calls, exec: async (c) => run(c), pipeline: async (cs) => cs.map(run) };
}
const DATA = new URL("file:///tmp/fake-data/");

test("modo Redis: lê/grava em memória e persiste só o que mudou", async (t) => {
  const r = fakeRedis();
  r.db.set("crypto:bot-state.json", '{"paused":false}');
  r.db.set("crypto:school.json", "{}");
  datafs.configure({ client: r });
  t.after(() => datafs.configure({ client: null }));
  assert.equal(datafs.existsSync(new URL("bot-state.json", DATA)), false); // antes do hydrate: vazio
  assert.throws(() => datafs.writeFileSync(new URL("bot-state.json", DATA), "x"), /hydrate/);
  await datafs.hydrate();
  assert.equal(datafs.readFileSync(new URL("bot-state.json", DATA), "utf8"), '{"paused":false}');
  assert.equal(datafs.existsSync(new URL("bot-trades.jsonl", DATA)), false);
  datafs.appendFileSync(new URL("bot-trades.jsonl", DATA), "a\n");
  datafs.appendFileSync(new URL("bot-trades.jsonl", DATA), "b\n");
  datafs.writeFileSync("C:/x/bot-state.json", '{"paused":"manual"}');
  assert.equal(await datafs.persist(), 2);
  assert.equal(r.db.get("crypto:bot-trades.jsonl"), "a\nb\n");
  assert.equal(r.db.get("crypto:bot-state.json"), '{"paused":"manual"}');
  assert.equal(r.db.get("crypto:school.json"), "{}"); // não tocado
  assert.equal(await datafs.persist(), 0);
  assert.throws(() => datafs.readFileSync(new URL("manager-review.json", DATA)), /ENOENT/);
});

test("withLock impede duas execuções ao mesmo tempo e libera depois", async (t) => {
  const r = fakeRedis();
  datafs.configure({ client: r });
  t.after(() => datafs.configure({ client: null }));
  let inner;
  const outer = await datafs.withLock("tick", 60, async () => {
    inner = await datafs.withLock("tick", 60, async () => "duplicado");
    return "primeiro";
  });
  assert.deepEqual(outer, { ran: true, value: "primeiro" });
  assert.deepEqual(inner, { ran: false });
  assert.equal(r.db.has("crypto:lock:tick"), false);
  assert.equal((await datafs.withLock("tick", 60, async () => 1)).ran, true);
});

test("configureFromEnv só liga o Redis no Vercel/STORAGE=redis com credenciais", (t) => {
  t.after(() => datafs.configure({ client: null }));
  assert.equal(datafs.configureFromEnv({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }).redis, false);
  assert.equal(datafs.configureFromEnv({ VERCEL: "1" }).redis, false);
  assert.equal(datafs.configureFromEnv({ VERCEL: "1", KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }).redis, true);
});

test("cliente Upstash não repassa o corpo de erro", async () => {
  const c = datafs.upstashClient({ url: "https://u", token: "t", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "SEGREDO" }) }) });
  await assert.rejects(c.exec(["GET", "x"]), (e) => !e.message.includes("SEGREDO"));
  const ok = datafs.upstashClient({ url: "https://u/", token: "t", fetchImpl: async (u, o) => ({ ok: true, json: async () => (u.endsWith("/pipeline") ? [{ result: "OK" }] : { result: JSON.parse(o.body) }) }) });
  assert.deepEqual(await ok.exec(["GET", "x"]), ["GET", "x"]);
  assert.deepEqual(await ok.pipeline([["SET", "a", "b"]]), ["OK"]);
});

test("requisições simultâneas têm memórias separadas (uma não apaga a outra)", async (t) => {
  const r = fakeRedis();
  datafs.configure({ client: r });
  t.after(() => datafs.configure({ client: null }));
  let release;
  const gate = new Promise((res) => { release = res; });
  const tick = datafs.withContext(async () => {
    await datafs.hydrate();
    datafs.appendFileSync(new URL("bot-events.jsonl", DATA), "tick\n");
    await gate; // enquanto isso, outra requisição hidrata e grava
    return datafs.persist();
  });
  await datafs.withContext(async () => {
    await datafs.hydrate();
    datafs.appendFileSync(new URL("office-events.jsonl", DATA), "office\n");
    await datafs.persist();
  });
  release();
  assert.equal(await tick, 1);
  assert.equal(r.db.get("crypto:bot-events.jsonl"), "tick\n");
  assert.equal(r.db.get("crypto:office-events.jsonl"), "office\n");
});
