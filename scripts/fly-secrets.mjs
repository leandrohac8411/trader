// Envia ao Fly (fly secrets import --stage) SÓ as variáveis do server/.env que o deploy precisa.
// As chaves da conta REAL da Bybit (BYBIT_API_KEY/SECRET) nunca são enviadas.
// Nenhum valor é impresso. Uso: node scripts/fly-secrets.mjs [--dry]
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ALLOW = [
  "BYBIT_DEMO_KEY", "BYBIT_DEMO_SECRET", "BYBIT_BASE_URL",
  "BOT_SYMBOLS", "BOT_TIMEFRAMES", "BOT_RISK_PCT", "BOT_MIN_PROB", "BOT_REENTRY_COOLDOWN",
  "BOT_DAILY_LOSS_LIMIT_PCT", "BOT_MAX_OPEN", "BOT_MAX_OPENS_PER_TICK", "BOT_MAX_NOTIONAL_PCT",
  "BOT_LEVERAGE", "BOT_TOKEN", "BOT_LADDER", "BOT_SCHOOL_PROMOTE",
  "CMC_API_KEY", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODEL", "ALERT_CONSENSUS",
  "OFFICE_GOAL_USD", "ANTHROPIC_API_KEY", "MANAGER_MODEL", "APP_USER",
];
const NEVER = new Set(["BYBIT_API_KEY", "BYBIT_API_SECRET", "PORT", "HOST"]);

const env = {};
for (const line of readFileSync(new URL("../server/.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  if (value) env[m[1]] = value;
}
const keys = ALLOW.filter((k) => env[k] && !NEVER.has(k));
console.log(`Enviando ${keys.length} variáveis: ${keys.join(", ")}`);
console.log(`Ignoradas de propósito: ${Object.keys(env).filter((k) => !keys.includes(k)).join(", ") || "nenhuma"}`);
if (process.argv.includes("--dry")) process.exit(0);

const body = keys.map((k) => `${k}=${env[k]}`).join("\n") + "\n";
const r = spawnSync("fly", ["secrets", "import", "--stage"], { input: body, stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
process.exit(r.status ?? 1);
