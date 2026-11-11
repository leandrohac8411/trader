// Copia os dados locais (server/data/*) para o Upstash Redis usado no Vercel.
// Use UMA vez, logo antes de desligar o bot local, para o Vercel continuar de onde parou
// (posições abertas, trades, eventos, escola). Não apaga nada local.
//
// Credenciais: KV_REST_API_URL e KV_REST_API_TOKEN (copie do painel do Upstash/Vercel)
// no ambiente ou no server/.env. Nenhum valor é impresso.
// Uso: node scripts/upload-data.mjs
import { readFileSync, existsSync } from "node:fs";
import { upstashClient, uploadLocal } from "../server/src/services/datafs.js";

const envFile = new URL("../server/.env", import.meta.url);
const fileEnv = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) fileEnv[m[1]] = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
}
const pick = (...keys) => keys.map((k) => process.env[k] || fileEnv[k]).find(Boolean);
const url = pick("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
const token = pick("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
if (!url || !token) {
  console.error("Faltam KV_REST_API_URL e KV_REST_API_TOKEN (no ambiente ou no server/.env).");
  process.exit(1);
}
const sent = await uploadLocal(new URL("../server/data/", import.meta.url), upstashClient({ url, token }));
console.log(sent.length ? `Enviados: ${sent.join(", ")}` : "Nenhum arquivo em server/data para enviar.");
