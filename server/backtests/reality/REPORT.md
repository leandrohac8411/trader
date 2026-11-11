# Auditoria historica da estrategia

Periodo: 10/11/2025 a 10/11/2026 (UTC, fim exclusivo). Dados publicos de contratos lineares da Bybit. Parametros fixos, sem otimizacao nesta auditoria.

## Resultados por mercado independente

| Mercado | TF | Trades | Acerto | Expectativa R | Profit factor | Retorno com teto | DD | R ultimos 3 meses | R custos maiores |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BTCUSDT | 1h | 89 | 46.1% | 0.030 | 1.05 | 4.52% | 5.55% | -0.072 | -0.068 |
| BTCUSDT | 4h | 29 | 48.3% | 0.080 | 1.14 | 2.43% | 3.32% | -0.295 | 0.033 |
| ETHUSDT | 1h | 93 | 45.2% | 0.031 | 1.05 | 4.74% | 6.17% | -0.388 | -0.041 |
| ETHUSDT | 4h | 44 | 40.9% | -0.075 | 0.88 | -0.24% | 3.65% | -0.290 | -0.123 |
| SOLUSDT | 1h | 112 | 39.3% | -0.105 | 0.84 | -4.01% | 8.88% | -0.198 | -0.170 |
| SOLUSDT | 4h | 42 | 47.6% | 0.101 | 1.18 | 4.44% | 5.77% | 0.006 | 0.064 |
| BNBUSDT | 1h | 115 | 36.5% | -0.205 | 0.71 | -9.54% | 13.78% | -0.424 | -0.294 |
| BNBUSDT | 4h | 26 | 34.6% | -0.245 | 0.65 | -3.65% | 8.13% | -0.239 | -0.285 |
| XRPUSDT | 1h | 120 | 45.8% | 0.072 | 1.12 | 5.53% | 5.97% | -0.011 | 0.004 |
| XRPUSDT | 4h | 22 | 40.9% | -0.044 | 0.93 | -0.33% | 3.96% | 0.131 | -0.073 |

R significa o risco inicial do trade. Expectativa em R e retorno da conta podem ter sinais diferentes porque o teto de notional altera o risco efetivo de cada trade. Nao somar retornos entre linhas.

## Premissas e limites

- source: Bybit v5 linear public klines
- start: 2025-11-10T00:00:00.000Z
- recentStart: 2026-08-10T00:00:00.000Z
- rollingWindow: 300
- gate: 85
- cooldownBars: 10
- entry: next candle open after closed signal candle
- htf: closed daily candles only
- exit: full TP1, stop first if both touched; worse opening price on stop gaps; terminal mark-to-market
- feePctPerSide: 0.055
- slippagePctPerSide: 0.02
- stressTotalCostPctPerSide: 0.15
- funding: adverse assumed 0.01% notional per 8h elapsed; NOT historical funding
- sizing: 1% risk capped at 20% equity notional, recomputed each trade
- bootstrap: 2000 seeded moving-block resamples of 5 trades; intervals omitted below 20 trades
- Limitacao: independent market streams, not combined portfolio
- Limitacao: does not replay live unfinished candles
- Limitacao: no order book, latency, instrument lot rounding or exchange rejections
- Limitacao: no shared max-open or daily loss pause
- Limitacao: recent holdout is descriptive, not proven unseen during original development
- Limitacao: forward calibration samples overlap and are not independent
- Limitacao: funding scenario is an assumption, not actual exchange payments

Bootstrap exploratorio: todos os intervalos anuais de expectativa incluem zero. Amostras pequenas e ativos correlacionados impedem tratar as dez linhas como dez evidencias independentes. A separacao dos ultimos tres meses nao prova validacao fora da amostra original, pois a data da calibracao original e desconhecida.

## Evidencia de operacao local

O log local possui 2 trades encerrados, PnL somado de US$ 497,2107 em demo, 7 eventos de abertura e 54 erros entre 01/09 e 03/09/2026. Configuracoes mudaram: ha eventos em 15m e 60m. Isso nao representa retorno de conta e nao valida o desempenho. Nao foi consultada a conta privada.

## Verificacao

Validados 1384 registros de trades (base + estresse): cronologia, direcao do stop, custos, funding assumido, dimensionamento e igualdade das entradas/saidas entre cenarios de custos. Historicos sem lacunas e sem vela incompleta no fim.

Execucao: cd server; node src/reality-audit.js. O script reutiliza os arquivos locais de dados e nao importa o cliente privado nem envia ordens.

Conclusao: desempenho misto, fragil a custos e sem evidencia robusta de expectativa positiva. Esta e uma aproximacao com velas fechadas; o bot atual opera com velas em formacao. Nao e uma reproducao exata do bot nem uma simulacao de portfolio.