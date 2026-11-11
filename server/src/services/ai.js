// server/src/services/ai.js
// Cliente de LLM compatível com a API OpenAI /chat/completions.
// Padrão: Groq. Aceita as variáveis novas (GROQ_*) e as antigas (XAI_*).

const API_KEY = process.env.GROQ_API_KEY || process.env.XAI_API_KEY || "";
const MODEL = process.env.GROQ_MODEL || process.env.XAI_MODEL || "openai/gpt-oss-120b";

function resolveChatUrl() {
  const base = (
    process.env.GROQ_BASE_URL ||
    process.env.XAI_BASE_URL ||
    "https://api.groq.com/openai/v1"
  ).replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function asText(json) {
  const choice = json?.choices?.[0];
  const txt = choice?.message?.content ?? choice?.delta?.content ?? null;
  return typeof txt === "string" ? txt : null;
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    const err = new Error(json?.error?.message || `${r.status} ${r.statusText}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return json ?? {};
}

/**
 * @param {{ messages: Array<{role:string,content:string}>, temperature?: number, model?: string }} args
 * @returns {Promise<{ ok:boolean, provider:string, text:string, raw:any }>}
 */
export async function chatLLM({ messages, temperature = 0.2, model } = {}) {
  if (!API_KEY) {
    return {
      ok: true,
      provider: "mock",
      text:
        "⚠️ Sem GROQ_API_KEY configurada — comentário de IA desativado. " +
        "Os números da estratégia acima continuam válidos.",
      raw: null,
    };
  }

  const json = await fetchJson(resolveChatUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || MODEL,
      messages,
      temperature,
      stream: false,
      // modelos com "reasoning" (gpt-oss, qwen3) consomem tokens pensando;
      // folga suficiente para a resposta final não ser cortada
      max_tokens: 900,
    }),
  });

  return { ok: true, provider: "groq", text: asText(json) || "", raw: json };
}

// alias de compatibilidade
export const chatGrok = chatLLM;

export const AI_ENABLED = !!API_KEY;
export const AI_MODEL = MODEL;
