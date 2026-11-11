import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { basicAuth, isLoopback } from "../src/auth.js";

async function withServer(app, fn) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
const basic = (u, p) => ({ authorization: "Basic " + Buffer.from(`${u}:${p}`).toString("base64") });

test("isLoopback reconhece só endereços locais", () => {
  assert.ok(isLoopback("127.0.0.1") && isLoopback("localhost") && isLoopback("::1"));
  assert.ok(!isLoopback("0.0.0.0"));
});

test("basicAuth bloqueia sem senha, libera rota aberta e aceita credencial certa", async () => {
  const app = express();
  app.use(basicAuth({ user: "admin", password: "s3nha", open: ["/api/health"] }));
  app.get("/api/health", (_q, r) => r.json({ ok: true }));
  app.get("/api/office/snapshot", (_q, r) => r.json({ ok: true }));
  await withServer(app, async (base) => {
    assert.equal((await fetch(base + "/api/health")).status, 200);
    const denied = await fetch(base + "/api/office/snapshot");
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate"), /Basic/);
    assert.equal((await fetch(base + "/api/office/snapshot", { headers: basic("admin", "errada") })).status, 401);
    assert.equal((await fetch(base + "/api/office/snapshot", { headers: basic("outro", "s3nha") })).status, 401);
    assert.equal((await fetch(base + "/api/office/snapshot", { headers: basic("admin", "s3nha") })).status, 200);
  });
  assert.throws(() => basicAuth({ user: "a", password: "" }));
});
