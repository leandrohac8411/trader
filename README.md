# crypto-dashboard

## Escritório 3D

O escritório interativo está em `http://localhost:5173/#office`, com seis personagens,
consultas reais, backtest, conversa contextual via Groq e histórico de eventos.
O dashboard original continua em `#dashboard`.

Para explorar com o bot desligado, use `npm run office` no `server/` e `npm run dev`
no `client/`. Veja [instruções e limites do MVP](docs/ESCRITORIO_3D.md).

Painel local de mercado cripto + um **assistente de sinais** por consenso de indicadores
técnicos, com comentário opcional de um LLM (Groq).

> ⚠️ **Não é recomendação de investimento.** Os sinais são estudo/pesquisa — não são
> probabilidade preditiva nem garantia de resultado. **Nunca envia ordens na mainnet / com
> dinheiro real.** Há um bot opcional que opera na **Demo Trading da Bybit** (conta separada,
> dinheiro fake) só pra forward-test.

## Stack

- `client/` — React 19 + Vite. Dashboard e painel de sinais.
- `server/` — Express 5. Faz proxy de CoinMarketCap / Bybit / ETH gas / Fear & Greed,
  calcula os indicadores e a estratégia, e fala com o LLM.

```
client (5173)  ──/api/*──►  server (4000)  ──►  Bybit / CoinMarketCap / CoinGecko / Groq
```

## Rodar (2 terminais)

```bash
cd server && npm install && cp .env.example .env   # edite o .env
npm run dev
```

```bash
cd client && npm install
npm run dev        # http://localhost:5173
```

O front usa o proxy do Vite (`/api` → `localhost:4000`); não precisa configurar nada.

## Variáveis de ambiente (`server/.env`)

| Var | Obrigatória? | Para quê |
|---|---|---|
| `CMC_API_KEY` | não (cai no CoinGecko) | métricas globais, listagens, categorias |
| `GROQ_API_KEY` | não (vira "mock") | comentário de IA em `/api/ai/analyze` |
| `GROQ_MODEL` | não | default `openai/gpt-oss-120b` (veja `GET /api/health` p/ o modelo ativo) |
| `BYBIT_BASE_URL` | não | default `https://api.bybit.com` |
| `SMTP_*` + `NOTIFY_TOKEN` | não | habilita `/api/notify/email` (fica desativada sem isso) |
| `ALERT_CONSENSUS` | não | votos (de 4) para marcar alerta forte. Default 3 |

> Rotacione as chaves Bybit/CMC que estavam versionadas. Chave Groq: gere em
> <https://console.groq.com>; modelos disponíveis mudam — confira em `GET /api/health`
> ou `GET https://api.groq.com/openai/v1/models`.

## Backtest (calibração da probabilidade)

Roda a mesma estratégia sobre ~1000 velas passadas e mede: win-rate, expectativa em R,
profit factor, drawdown, curva de capital — **e** o que cada faixa de `probability` significou
de verdade (acerto do preço N velas depois).

```bash
cd server
npm run backtest -- --symbol BTCUSDT --interval 60 --bars 1000 --htf --json
npm run backtest:grid -- --symbol BTCUSDT --interval 60 --htf   # compara as regras de saída
```

No dashboard: seção **"Backtest"** abaixo do gráfico (com botão "Comparar variantes"). E no
painel de sinais, o link *"ver acerto histórico desta faixa"* anota o `%` atual.

> Amostra de ~1000 velas é pequena — trate como indicativo, não garantia. O motor de trade usa
> `fee 0,055% + slippage 0,02%` por lado e reentra numa tendência após 10 velas de cooldown.

## Bot de forward-test (Demo Trading da Bybit)

Backtest tem suposições. O bot opcional roda a estratégia calibrada **ao vivo na Demo Trading da
Bybit** — preços reais do mainnet, dinheiro fake, conta separada — e registra cada trade pra
comparar com o que o backtest previu. **Nunca toca mainnet nem dinheiro real** (`bybit-demo.js`
trava a URL em `api-demo.bybit.com` e não lê as chaves de mainnet).

1. Na Bybit → **Demo Trading** → gere API key/secret.
2. `server/.env`: `BYBIT_DEMO_KEY`, `BYBIT_DEMO_SECRET`, `DEMO_BOT=1`.
3. `npm run dev` — o worker sobe junto com o servidor.

Config (env): `BOT_SYMBOLS` (default watchlist), `BOT_TIMEFRAMES` (`60,240`), `BOT_RISK_PCT` (1),
`BOT_MIN_PROB` (85), `BOT_DAILY_LOSS_LIMIT_PCT` (4, auto-pausa o dia), `BOT_MAX_OPEN` (6),
`BOT_LEVERAGE` (2), `BOT_TOKEN` (opcional, protege pause/resume).

Painel **"Bot demo"** no dashboard: status, equity/PnL do dia, botão Pausar/Retomar, comparação
ao vivo × backtest, posições abertas, log de trades. Rotas: `GET /api/bot/status|trades|report`,
`POST /api/bot/pause|resume`. Só opera com o servidor ligado (para quando o PC dorme, retoma ao voltar).

## Testes

```bash
cd server && npm test      # node:test — indicadores + estratégia + backtest
cd client && npm run lint
```

## API

| Rota | Descrição |
|---|---|
| `GET /api/health` | status + se a IA está habilitada |
| `GET /api/cmc/global-metrics` | market cap, volume, dominância |
| `GET /api/cmc/listings-latest?limit=&convert=` | top moedas |
| `GET /api/cmc/categories?limit=` | setores (via CoinGecko) |
| `GET /api/cmc/new-listings?limit=` | listagens recentes |
| `GET /api/eth/gas` | gas ETH em gwei + estimativa em USD |
| `GET /api/fng` | Fear & Greed |
| `GET /api/bybit/kline?symbol=&interval=&limit=&category=` | velas (proxy Bybit, com cache) |
| `GET /api/strategy/analyze?symbol=&interval=&limit=&htf=1` | sinal de consenso + níveis |
| `GET/POST /api/ai/analyze?symbol=&interval=&limit=` | estratégia + comentário do LLM |
| `POST /api/ai/chat` `{prompt}` | chat livre com o LLM |
| `GET /api/bot/status` · `/api/bot/trades` · `/api/bot/report` | estado e track record do bot demo |
| `POST /api/bot/pause` · `/api/bot/resume` | kill switch do bot demo |
| `GET /api/backtest?symbol=&interval=&limit=&htf=` | roda o backtest sobre ~1000 velas (cache 10 min) |
| `GET /api/backtest/grid?symbol=&interval=&limit=&htf=` | compara 72 combinações de regra de saída |

### Como o sinal é calculado (`server/src/services/strategy.js`)

**Direção (consenso bruto)** — 4 votos sobre a última vela: EMA20 vs EMA50, MACD-histograma,
RSI vs 50, direção do SuperTrend. `>= 3` votos do mesmo lado → `rawSignal` `LONG`/`SHORT`.

**`probability` (0–100%)** — cada componente vira um valor em `[-1, +1]` conforme a *força* da
leitura (não só o voto): soma ponderada (EMA 0,30 · RSI 0,25 · MACD 0,25 · SuperTrend 0,20),
±0,10 do timeframe maior, passada por logística. É a probabilidade a favor de `rawSignal`.

**Gate de entrada** — `signal` só vira `LONG`/`SHORT` (com níveis) quando
`probability >= minProbEntry` (**default 85**). Abaixo disso `signal = NEUTRAL` e o painel
mostra o estágio: `stage` = `watch` (50–75, "Formando") · `ready` (75–85, "Prepare-se") ·
`go` (≥85, "Entrada"). As cores do painel seguem essas zonas.

**Níveis** — stop pelo swing recente ± 0,5×ATR; TP1/TP2 em 1,5R / 2,5R.
**Gestão calibrada:** sair só no stop ou no TP — **não** sair por sinal oposto.

Campos no payload: `signal`, `rawSignal`, `stage`, `lean`, `probability`, `biasUp`,
`consensus`, `confidence`, `edge`, `indicators`, `levels`, `reasons`.

### Calibração (fase 3)

O gate de 85% + remover a saída "reverse" tirou a estratégia do vermelho no backtest de
~1000 velas:

| | antes (consenso 3/4, saída por reverse) | depois (gate 85, sem reverse) |
|---|---|---|
| BTC 1h | win 34% · exp **−0,21 R** · **−9%** | win 58% · exp **+0,34 R** · **+4,0%** · DD −2,3% |
| SOL 4h | — | win 53% · exp **+0,34 R** · **+5,8%** |

`npm run backtest:grid -- --symbol X --interval Y --htf` compara as 72 variantes e destaca a
melhor (maior expectativa com ≥12 trades). Amostra pequena — indicativo, não garantia.

## Próximos passos

- Paginação de histórico (meses) → calibração com amostra maior; walk-forward.
- Otimização dos períodos/pesos dos indicadores.
- Tailwind via build; servir a SPA pelo Express + deploy (Docker/Fly) + CORS + rate limit.
