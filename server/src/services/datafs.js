// server/src/services/datafs.js
// Armazenamento dos dados do escritório/bot com a MESMA interface síncrona de node:fs.
//
// - Local (padrão): delega para node:fs, gravando em server/data/ como sempre.
// - Vercel (ou STORAGE=redis): os "arquivos" vivem no Upstash Redis. No começo de cada
//   requisição, hydrate() traz tudo para a memória; o código continua lendo/gravando de forma
//   síncrona; no fim, persist() grava de volta SÓ o que mudou. Cada arquivo é uma chave.
//
// Só arquivos da pasta de dados passam por aqui (a chave é o nome do arquivo).
import * as fs from "node:fs";
import { basename } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export const DATA_FILES = [
  "bot-state.json", "bot-trades.jsonl", "bot-events.jsonl", "office-events.jsonl",
  "school.json", "school-paper.jsonl", "manager-review.json", "monitor-state.json", "tick-state.json",
];

const PREFIX = process.env.STORE_PREFIX || "crypto:";
let client = null; // { exec(cmd[]), pipeline(cmd[][]) }
// Cada requisição tem a sua cópia em memória (requisições simultâneas na mesma instância
// não apagam o trabalho uma da outra). Fora de withContext usa um contexto global (testes).
const als = new AsyncLocalStorage();
const globalCtx = { mem: new Map(), dirty: new Set(), hydrated: false };
const ctx = () => als.getStore() || globalCtx;
export function withContext(fn) {
  return als.run({ mem: new Map(), dirty: new Set(), hydrated: false }, fn);
}

const nameOf = (p) => basename(p instanceof URL ? decodeURIComponent(p.pathname) : String(p).replace(/\\/g, "/"));

/** Cliente REST do Upstash (sem dependência): https://upstash.com/docs/redis/features/restapi */
export function upstashClient({ url, token, fetchImpl = fetch }) {
  const call = async (path, body) => {
    const r = await fetchImpl(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || json?.error) throw new Error(`Upstash ${r.status}`); // nunca repassa o corpo (pode ter dados)
    return json;
  };
  return {
    exec: async (cmd) => (await call("", cmd)).result,
    pipeline: async (cmds) => (await call("/pipeline", cmds)).map((x) => {
      if (x.error) throw new Error("Upstash pipeline");
      return x.result;
    }),
  };
}

/** Liga o modo Redis automaticamente no Vercel (ou com STORAGE=redis) quando há credenciais. */
export function configureFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const wanted = env.VERCEL === "1" || env.STORAGE === "redis";
  if (wanted && url && token) configure({ client: upstashClient({ url, token }) });
  return { redis: !!client, wanted, configured: !!(url && token) };
}

/** Para testes e para o modo serverless. Passe { client: null } para voltar ao disco. */
export function configure({ client: c }) {
  client = c;
  globalCtx.mem.clear();
  globalCtx.dirty.clear();
  globalCtx.hydrated = false;
}

export const isRedis = () => !!client;

export async function hydrate() {
  if (!client) return;
  const values = await client.exec(["MGET", ...DATA_FILES.map((f) => PREFIX + f)]);
  const c = ctx();
  c.mem.clear();
  c.dirty.clear();
  DATA_FILES.forEach((f, i) => { if (values?.[i] != null) c.mem.set(f, values[i]); });
  c.hydrated = true;
}

export async function persist() {
  const { mem, dirty } = ctx();
  if (!client || !dirty.size) return 0;
  const names = [...dirty];
  dirty.clear();
  await client.pipeline(names.map((f) => ["SET", PREFIX + f, mem.get(f) ?? ""]));
  return names.length;
}

/**
 * Executa fn só se ninguém mais estiver executando (trava no Redis com expiração).
 * Evita dois ticks do bot ao mesmo tempo (= ordem duplicada). Sem Redis, só executa.
 */
export async function withLock(name, ttlSec, fn) {
  if (!client) return { ran: true, value: await fn() };
  const key = `${PREFIX}lock:${name}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await client.exec(["SET", key, token, "NX", "EX", String(ttlSec)]);
  if (ok !== "OK") return { ran: false };
  try { return { ran: true, value: await fn() }; }
  finally {
    // Só libera se a trava ainda for nossa.
    if ((await client.exec(["GET", key])) === token) await client.exec(["DEL", key]);
  }
}

/** Grava os arquivos locais no Redis (migração inicial). Não apaga nada local. */
export async function uploadLocal(dataDir, c = client) {
  const sent = [];
  for (const f of DATA_FILES) {
    const p = new URL(f, dataDir);
    if (!fs.existsSync(p)) continue;
    await c.exec(["SET", PREFIX + f, fs.readFileSync(p, "utf8")]);
    sent.push(f);
  }
  return sent;
}

function assertReady() {
  if (!ctx().hydrated) throw new Error("datafs: hydrate() não foi chamado nesta requisição");
}

// ── Interface compatível com node:fs (síncrona) ──
// Leituras fora de uma requisição (ex.: construtores no carregamento do módulo) veem um
// armazenamento vazio; quem precisa do estado real recarrega dentro da requisição (reload()).
export function existsSync(p) {
  if (!client) return fs.existsSync(p);
  if (!ctx().hydrated) return false;
  return ctx().mem.has(nameOf(p));
}
export function readFileSync(p, enc) {
  if (!client) return fs.readFileSync(p, enc);
  const v = ctx().mem.get(nameOf(p));
  if (v == null) throw Object.assign(new Error(`ENOENT: ${nameOf(p)}`), { code: "ENOENT" });
  return v;
}
export function writeFileSync(p, data) {
  if (!client) return fs.writeFileSync(p, data);
  assertReady();
  ctx().mem.set(nameOf(p), String(data));
  ctx().dirty.add(nameOf(p));
}
export function appendFileSync(p, data) {
  if (!client) return fs.appendFileSync(p, data);
  assertReady();
  const { mem, dirty } = ctx();
  mem.set(nameOf(p), (mem.get(nameOf(p)) || "") + String(data));
  dirty.add(nameOf(p));
}
export function mkdirSync(p, opts) {
  if (!client) return fs.mkdirSync(p, opts);
}
