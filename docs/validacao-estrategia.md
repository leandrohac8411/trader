# Validação da estratégia

Gerado em 2026-11-13 18:07 UTC por `node scripts/validate.mjs` (só dados públicos da Bybit, nenhuma ordem).

**Como o bot opera na simulação:** BTC, ETH, SOL, BNB, XRP × 1h e 4h, no máximo 5 posições e uma por ativo, risco de 1% por trade limitado a 20% de notional, saída inteira no alvo (1,5R) ou no stop, decisão só com velas fechadas, taxa 0,055% + slippage 0,02% por lado. Juros compostos a partir de US$ 100.000.

Período: 2023-11-14 a 2026-11-13 (3,0 anos). Os parâmetros da estratégia foram calibrados em set/2026, então quase todo esse período está **fora** da amostra da calibração.

## Resultado: 0 de 7 critérios

| Critério | Passou? | Valor |
|---|---|---|
| Por trade positivo no período todo | ❌ | -0,024 R |
| Intervalo de 95% acima de zero | ❌ | -0,09 a +0,04 R |
| Lucro em todos os anos | ❌ | 2023: -0,15 · 2024: -0,03 · 2025: -0,01 · 2026: -0,01 |
| Compras e vendas lucrativas | ❌ | compra -0,01 · venda -0,04 |
| Aguenta taxas e slippage em dobro | ❌ | -0,098 R |
| Chance de perder no ano < 10% | ❌ | 58,3% |
| Queda típica (95%) no ano < 20% | ❌ | 35,0% |

## Carteira

| | Valor |
|---|---|
| Trades executados (com as vagas) | 1443 (~481 por ano) |
| Retorno total | -11,6% (US$ 100.000 → US$ 88.440) |
| Retorno médio por ano | -4,0% |
| Maior queda do saldo | -29,8% |
| Com taxas e slippage em dobro | -44,1% no total · -0,098 R por trade |

| Grupo | Trades | Acerto | Por trade | 95% (R) | Fator de lucro | Pior sequência de perdas |
|---|---|---|---|---|---|---|
| Todos | 1443 | 42% | -0,024 R | -0,09 a +0,04 | 0,96 | 13 |
| 1h | 1210 | 41% | -0,039 R | -0,11 a +0,03 | 0,94 | 12 |
| 4h | 233 | 44% | +0,057 R | -0,10 a +0,22 | 1,10 | 7 |
| Compras | 793 | 42% | -0,008 R | -0,09 a +0,08 | 0,99 | 14 |
| Vendas | 650 | 41% | -0,044 R | -0,14 a +0,05 | 0,93 | 16 |
| BNB | 263 | 42% | -0,015 R | -0,16 a +0,13 | 0,98 | 8 |
| BTC | 297 | 42% | -0,028 R | -0,17 a +0,11 | 0,96 | 9 |
| ETH | 284 | 41% | -0,031 R | -0,17 a +0,11 | 0,95 | 12 |
| SOL | 350 | 42% | -0,005 R | -0,13 a +0,12 | 0,99 | 10 |
| XRP | 249 | 40% | -0,046 R | -0,20 a +0,11 | 0,93 | 7 |

## Por ano

| Ano | Trades | Acerto | Por trade | Resultado no ano (sobre o saldo inicial) |
|---|---|---|---|---|
| 2023 | 71 | 37% | -0,150 R | -6,9% |
| 2024 | 523 | 41% | -0,034 R | -2,6% |
| 2025 | 502 | 42% | -0,008 R | -14,1% |
| 2026 | 347 | 43% | -0,005 R | +12,0% |

## Monte Carlo: 10.000 anos sorteados

Cada "ano" sorteia 481 trades (com reposição) entre os trades da carteira, com o risco de cada um.

| | Valor |
|---|---|
| Chance de terminar o ano no prejuízo | 58,3% |
| Retorno no ano: pior 5% · mediana · melhor 5% | -28,6% · -3,7% · +29,3% |
| Maior queda no ano: típica · ruim (95%) | -19,5% · -35,0% |
| Pior sequência de perdas seguidas: típica · ruim (95%) | 10 · 15 |

## Limitações

- Backtest não é futuro: o mercado pode mudar de comportamento.
- Stop em mercado rápido pode sair pior que o preço do stop (a simulação usa o preço exato).
- Cada ativo/período é simulado separadamente e depois encaixado nas vagas da carteira; o tempo de espera entre entradas pode diferir um pouco do bot.
- Não considera a Máquina do Tempo (ela só filtra entradas; o efeito dela precisa ser medido na demo).
- Não é recomendação de investimento.

## Variações testadas (13/11/2026)

108 variações da mesma estratégia (período 1h/4h × alvo 1,5/2/3R × score mínimo 75/85/90 × SuperTrend 3/4 × com ou sem trailing). Para não se enganar, cada uma foi **escolhida pelo treino (nov/2023 a dez/2025)** e **conferida no teste (2026)**, que ela não viu. Mesma carteira, custos e regras de cima.

| Variação | Treino 2023–25: trades · por trade · 95% | Teste 2026: trades · por trade · 95% | Total 3 anos | Maior queda |
|---|---|---|---|---|
| 1h · alvo 3R · score ≥ 90 · ST 4 | 556 · +0,198 R · +0,06 a +0,34 | 213 · +0,027 R · −0,20 a +0,25 | +63% | −27% |
| 1h+4h · alvo 3R · score ≥ 90 · ST 4 | 518 · +0,185 R · +0,04 a +0,33 | 182 · +0,036 R · −0,21 a +0,28 | +60% | −21% |
| 4h · alvo 2R · score ≥ 90 · ST 3 | 204 · +0,134 R · −0,07 a +0,34 | 86 · +0,260 R · −0,05 a +0,58 | +51% | −22% |
| 4h · alvo 3R · score ≥ 85 · ST 4 | 254 · +0,132 R · −0,08 a +0,34 | 78 · +0,170 R · −0,21 a +0,55 | +30% | −21% |
| 4h · alvo 3R · score ≥ 90 · ST 3 | 174 · +0,131 R · −0,12 a +0,38 | 73 · +0,303 R · −0,10 a +0,71 | +47% | −21% |
| 1h · alvo 2R · score ≥ 90 · ST 4 | 669 · +0,088 R · −0,02 a +0,20 | 270 · +0,138 R · −0,04 a +0,31 | +55% | −23% |
| **Atual: 1h+4h · alvo 1,5R · score ≥ 85 · ST 3** | posição 76 de 108 | | −12% | −30% |

**Leitura honesta:**
- A configuração atual está entre as piores (76ª de 108).
- O que melhora é consistente: **score mais alto (≥ 90), alvo maior (2–3R) e stop mais largo (SuperTrend 4)**. Entrar menos e deixar o lucro correr.
- 45 das 50 variações positivas no treino continuaram positivas em 2026. Isso sugere um padrão real, mas fraco: em 2026 nenhuma tem o intervalo de 95% inteiro acima de zero.
- Escolher a melhor entre 108 sempre infla o resultado (viés de seleção). Nenhuma está **comprovada**; as melhores são **candidatas** para teste na demo.
