// Gera vercel.env (NÃO vai para o Git) com as variáveis que o projeto precisa no Vercel,
// para colar em Settings → Environment Variables (o painel aceita colar o conteúdo de um .env).
// Inclui uma TICK_SECRET aleatória (use a mesma no cron-job.org). Deixa de fora as chaves da
// conta REAL da Bybit. APP_PASSWORD você cria e adiciona à mão. Nenhum valor é impresso.
// Uso: node scripts/vercel-env.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ALLOW = [
  "BYBIT_DEMO_KEY", "BYBIT_DEMO_SECRET", "BYBIT_BASE_URL",
  "BOT_SYMBOLS", "BOT_TIMEFRAMES", "BOT_RISK_PCT", "BOT_MIN_PROB", "BOT_REENTRY_COOLDOWN",
  "BOT_DAILY_LOSS_LIMIT_PCT", "BOT_MAX_OPEN", "BOT_MAX_OPENS_PER_TICK", "BOT_MAX_NOTIONAL_PCT",
  "BOT_LEVERAGE", "BOT_TOKEN", "BOT_LADDER", "BOT_SCHOOL_PROMOTE",
  "CMC_API_KEY", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODEL", "ALERT_CONSENSUS",
  "OFFICE_GOAL_USD", "ANTHROPIC_API_KEY", "MANAGER_MODEL", "APP_USER",
];
const env = {};
for (const line of readFileSync(new URL("../server/.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) { const v = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, ""); if (v) env[m[1]] = v; }
}
const out = new URL("../vercel.env", import.meta.url);
// Reaproveita a TICK_SECRET se o arquivo já existir (para não quebrar o cron já configurado).
const previous = existsSync(out) ? readFileSync(out, "utf8").match(/^TICK_SECRET=(.+)$/m)?.[1] : null;
const vars = {
  ...Object.fromEntries(ALLOW.filter((k) => env[k]).map((k) => [k, env[k]])),
  DEMO_BOT: "1", BOT_DRY_RUN: "0", MONITOR_SCAN_MS: "300000",
  TICK_SECRET: env.TICK_SECRET || previous || randomBytes(24).toString("hex"),
};
writeFileSync(out, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log(`vercel.env gerado com ${Object.keys(vars).length} variáveis: ${Object.keys(vars).join(", ")}`);
console.log("Fora de propósito: BYBIT_API_KEY, BYBIT_API_SECRET (conta real). Adicione APP_PASSWORD à mão no Vercel.");
