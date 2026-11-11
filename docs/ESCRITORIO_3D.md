# Escritório Crypto Trading

MVP local com cena 3D procedural em Three.js, seis personagens selecionáveis, câmera isométrica, zoom, redução de movimento, feed SSE e tarefas conectadas aos serviços existentes.

## Executar

Em dois terminais:

```powershell
cd C:\Python\crypto-dashboard\server
npm install
npm run office
```

```powershell
cd C:\Python\crypto-dashboard\client
npm install
npm run dev
```

Abra http://localhost:5173/#office. O dashboard anterior está em `#dashboard` e no botão “Dashboard clássico”. O comando `npm run office` força `DEMO_BOT=0` apenas no processo iniciado; não modifica `.env`. Os comandos antigos de inicialização preservam seu comportamento.

## Visual (fase A)

Cena 100% procedural em blocos (Three.js), sem modelos externos: o escritório fica na cobertura de um prédio numa cidade noturna. Zonas: Diretoria (Arthur), Pregão com telão (Alice e Lucas), Pesquisa & Auditoria (Sofia e Daniel), Gerência de Risco com painel na parede (Ricardo), Sala de Operações, Lounge com TV e Max, o cachorro da equipe, andando pelos corredores.

- Personagens articulados (`people.js`): digitam quando consultam, varrem a tela quando monitoram, levam a mão à cabeça quando a consulta falha. Lucas dorme (Zzz…) quando o radar não tem nenhuma entrada válida.
- Telão do pregão: lucro acumulado e curva dos trades **registrados** pelo bot demo, placar de hoje (V/D) e radar da Alice. Painel de risco: limites reais do `.env` e estado do kill switch. Nada é inventado; sem trades, o telão diz isso.
- Câmeras CAM 01–09 (bairro, cobertura, diretoria, risco, mesa do Lucas, pregão, segurança seguindo o Max, pesquisa, lounge) no seletor acima da cena, com HUD estilo transmissão. **Tour** alterna as câmeras a cada 7 s (bom para gravar). Arrastar ou rolar volta à câmera livre. “Ver no escritório” leva à câmera do agente.

## Vida ligada aos dados (fase B)

- **Humor do Lucas** (`server/src/services/crew.js`, testado): perigo · alerta · normal · confiante, calculado a partir dos trades registrados pelo bot demo (sequência atual, resultado do dia em UTC contra o `dayStartEquity` e o limite de perda diária) e do estado de pausa. Vai no snapshot como `crew.trader`. É só leitura: não muda tamanho de posição nem comanda o bot.
  - Perigo: trava de perda diária acionada, perda do dia ≥ 75% do limite, ou 3 derrotas seguidas.
  - Alerta: última operação foi derrota ou o dia está negativo. Confiante: 3+ vitórias seguidas sem dia negativo.
- **Pausa no lounge**: com humor em perigo ou bot pausado, Lucas levanta, anda pelos corredores até o sofá e joga videogame (a TV mostra o jogo). Volta à mesa quando a condição some.
- **Travas visíveis**: Max vai até a mesa vazia do Lucas e fica de guarda; o painel de risco mostra “TRAVA ATIVA” com o motivo e a luz de alarme pisca; Ricardo passa a monitorar.
- **Balões de fala** só para coisas que aconteceram: novo sinal ou sinal retirado (Alice), abertura/fechamento/dry-run do bot (Lucas), erro do bot (Daniel), início/fim/falha de tarefa (cada agente), mudança de humor e entrada/saída das travas. Ao abrir a página, o histórico existente não gera balões.
- Telão: medidor “Humor do Lucas” com o motivo; placar de hoje usa a mesma regra de dia. Painel do Lucas na lateral mostra o medidor e a sequência.

## Gamificação (fase C)

- **A regra (escada de risco 10V/5D)** — `server/src/services/game.js`, testada. A cada 10 vitórias o risco por trade sobe um degrau; a cada 5 derrotas, ou queda de 10% desde o pico, desce um. Os contadores zeram a cada mudança. Degraus: 0,5× · 1× (base) · 1,5× · 2× o `BOT_RISK_PCT`; nunca passa de 2×.
  - **Por padrão a regra fica só no placar.** O bot demo só usa o risco da escada com `BOT_LADDER=1` no `.env` (`effectiveRiskPct` em `bot.js`). Os demais limites (teto de notional, perda diária, máximo de posições) continuam valendo.
- **Meta do escritório**: lucro registrado em conta demo contra `OFFICE_GOAL_USD` (padrão 1000).
- **Conquistas**: primeiro trade, primeira vitória, dia no verde, 3 vitórias seguidas, 10 trades, subiu de nível, meta atingida — só a partir de trades registrados.
- Tudo vai no snapshot como `game` e aparece na faixa abaixo do radar (placar de hoje, a regra com bolinhas de progresso, meta e conquistas) e no mural “a regra” na parede do pregão.
- **Fichas**: cada personagem (e o Max) tem uma ficha com cargo, superpoder, ponto fraco e mantra, mais uma linha com dado ao vivo (humor, risco atual, meta, sinais, alertas). Aparece no painel lateral e sobre a cena quando a câmera foca o personagem (CAM 03–08).
- Balões: Arthur e Ricardo comentam quando o nível de risco muda; Arthur e Max comemoram quando a meta é batida.

## Escola de traders (fase D)

- **Alunos** (`server/src/services/school.js`, testado): seis variações da mesma estratégia de consenso, mudando só o que o bot consegue honrar (gate de entrada, alvo em R, médias, SuperTrend/swing do stop). Bia é a turma base: faz exatamente o que o bot faz hoje. Todos saem por stop/TP1, como o bot, com taxa e slippage.
- **Avaliação** a cada 30 min (e no botão “Reavaliar agora”): 1.000 velas de 1h em BTC, ETH, SOL, BNB e XRP, com HTF 4h alinhado pelo fechamento.
  - **Estudo**: primeiros 70% das velas. O candidato é escolhido só por aqui.
  - **Prova**: últimos 30%. Só confirma ou nega o candidato; não é usada para escolher.
  - **Papel**: trades que começaram depois da abertura da escola, gravados em `server/data/school-paper.jsonl` (sem duplicar). É o único resultado realmente “para frente”.
- **Promoção** exige expectativa positiva no estudo (≥ 15 trades), aprovação na prova (≥ 6), ≥ 10 trades em papel com expectativa positiva e superar a turma base. Estado em `server/data/school.json`.
  - **Por padrão a promoção é só informativa.** O bot demo usa os parâmetros do aluno promovido apenas com `BOT_SCHOOL_PROMOTE=1`; os parâmetros passam por uma lista e limites fixos (`sanitizeParams`) e nunca mexem em risco, alavancagem ou limites.
- Na cena: a antiga sala de operações virou a sala de aula (CAM 10), com a lousa do ranking e um crachá por aluno (cor = situação; ★ candidato; 🎓 pronto). Sofia é a professora e comenta promoções. No painel, a seção “Escola de traders” abaixo das metas.
- Primeira avaliação real (11/11/2026): os seis alunos tiveram expectativa negativa no estudo, em linha com a auditoria de um ano. Ninguém foi promovido.

## Proposta → aprovação → execução

- Cada entrada do bot demo vira uma **proposta** (ativo, direção, entrada, stop, alvo, score, risco, tamanho). Antes de qualquer ordem, o Ricardo confere 8 limites em `server/src/services/approval.js` (testado): score acima do gate, stop e alvo do lado certo (stop a no máximo 15%), risco ≤ 2× a base, tamanho mínimo da corretora, notional abaixo do teto, perda no stop dentro do risco, vaga de posição livre (dry-run não ocupa vaga) e nenhuma posição no mesmo ativo.
- **Aprovada**: o bot segue como antes (dry-run registra o que faria; demo envia a ordem com stop e TP1). **Barrada**: nada é enviado; o motivo fica no log do bot (`blocked`, só quando o motivo muda, para não repetir a cada minuto).
- A aprovação é automática e acontece dentro do bot. O escritório continua sem botão de execução: só mostra as decisões (painel “Propostas do bot demo”, linha “Última proposta” no painel de risco, balões do Ricardo e ficha).
- A trava de perda diária e a pausa continuam antes de tudo: com elas ativas o bot nem gera propostas.

## Gerente (Claude)

- `server/src/services/manager.js` (testado com cliente falso): sob demanda, pelo botão “Pedir parecer” no painel, o Claude (`claude-opus-5-5`, ajustável com `MANAGER_MODEL`) lê um resumo do snapshot — humor do Lucas, a regra, a meta, conquistas, sinais ao vivo, a escola e os últimos eventos — e devolve um parecer em JSON (resumo, pontos por área com OK/atenção/alerta, até 3 próximos passos).
- Só leitura: sem ferramentas, sem ordens, sem mudar configuração; o prompt proíbe inventar números e recomendar compra/venda. O parecer fica em `server/data/manager-review.json` e Arthur avisa na cena quando chega.
- Precisa de `ANTHROPIC_API_KEY` no `server/.env`. Sem chave, o cartão mostra “indisponível”. Cada parecer é uma chamada paga; há intervalo mínimo de 1 minuto e nada roda em loop. Se o modelo recusar, a API refaz a chamada num modelo de reserva (`fallbacks: "default"`).

## O que funciona

- Alice: monitora automaticamente BTC, ETH, SOL, BNB e XRP a cada 45 segundos, sem precisar de cliques. Usa a mesma estratégia existente, inicialmente em 1 minuto, como no dashboard anterior. O radar permite escolher 1m, 5m, 15m, 1h ou 4h. Consultas extras de 1h/4h continuam disponíveis.
- Sofia: executa o motor existente em até 1.000 velas. O adaptador do escritório alinha o HTF pelo fechamento e usa saída integral em TP1; não altera os defaults das outras rotas.
- Ricardo: inspeciona os limites configurados. Não emite aprovação de propostas.
- Lucas: apresenta o estado e os registros locais do bot. Não envia ordens.
- Daniel: revisa eventos e aponta limites dos registros locais.
- Arthur: consolida resultados dos trades encerrados registrados.
- Chat por personagem: usa Groq se configurado, com contexto restrito, sem ferramentas e sem acesso a credenciais. Sem chave, a interface informa a indisponibilidade.
- Eventos de tarefas: início, conclusão e falha persistidos em `server/data/office-events.jsonl`, com ID e correlação. O arquivo é um log local mutável, não uma trilha inviolável.
- Monitor e movimentos de trabalho refletem o estado das tarefas reais. Os monitores não inventam preços ou gráficos de mercado; a curva exibida por Sofia vem do backtest.

## Estações individuais

Clique em um personagem na sala ou na lista da equipe para abrir apenas a estação daquele agente. A visão geral e o feed de outros funcionários saem da tela. Use “Voltar ao escritório” ou Escape para retornar. A opção “Ver no escritório” retorna à cena e aproxima a câmera da estação escolhida.

Lucas possui uma mesa de trading com velas OHLC reais do endpoint público Bybit já existente, consulta automática a cada 15 segundos, cinco mercados e períodos de 1m, 5m, 15m, 1h e 4h. O gráfico possui aproximação de velas, leitura de OHLC ao passar o ponteiro e referências de entrada/stop/TP1 quando estiverem dentro da escala visível. A estratégia é consultada no mesmo símbolo e período das velas. Consultas usam os caches existentes do servidor; não são um stream de ticks.

As posições e os encerramentos da estação continuam identificados como histórico local não reconciliado. Se a execução demo estiver desligada, a estação informa isso explicitamente. Abrir o gráfico não liga o bot. Os demais agentes têm uma estação com seus próprios dados e eventos; Alice mantém o acompanhamento automático. O monitor do servidor e os avisos do navegador continuam ativos ao alternar entre as estações.

## API nova

- `GET /api/office/snapshot`
- `GET /api/office/events` (SSE, snapshot a cada 5 segundos e nas transições de tarefa)
- `POST /api/office/monitor` com `{interval}` altera o período do radar, não os parâmetros da estratégia.
- `POST /api/office/school/run` reavalia a escola agora (não envia ordens).
- `POST /api/office/manager/review` pede um parecer ao gerente (Claude).
- `POST /api/office/agents/:id/run` com `{symbol, interval}`
- `POST /api/office/agents/:id/chat` com `{prompt}`

IDs: `ceo`, `analyst`, `risk`, `trader`, `scientist`, `auditor`.

## Limites deste MVP

O monitor da Alice inicia junto com o servidor e continua funcionando sem o navegador aberto. Os outros agentes continuam disponíveis para consultas. O ciclo proposta → aprovação → execução roda dentro do bot (aprovação automática pelo checklist do Ricardo); o escritório só observa. As rotas antigas do bot não foram alteradas.

O radar mostra entrada de compra/venda, preparando, formando ou aguardar. A retirada de um sinal também gera aviso. São sinais da estratégia, não ordens executadas. Leituras com falha ou sem atualização por dois ciclos deixam de ser apresentadas como entradas válidas. Os ciclos não se sobrepõem e cada requisição possui timeout e cancelamento.

Os avisos internos são automáticos. O botão “Ativar avisos” permite notificações do navegador quando houver novo sinal ou retirada, se houver permissão. Para receber notificações, a página deve continuar aberta, mesmo que em segundo plano; o monitor do servidor sozinho não envia notificações com o navegador fechado. Avisos iguais são deduplicados durante a execução; reiniciar o servidor inicia uma nova leitura e pode gerar um novo registro do estado atual. A escolha de período também retorna a 1m ao reiniciar.

As posições e o PnL apresentados pelos relatórios vêm dos arquivos locais, não de reconciliação remota. O feed distingue o histórico do bot das consultas do escritório. A conexão SSE confirma a conexão ao servidor, não à corretora. Reiniciar o servidor apaga resultados em memória das consultas e conserva seus eventos locais. O chat é mantido somente enquanto o escritório está aberto.

O backtest curto não inclui funding nem reproduz decisões intravela, limites compartilhados ou latência. A auditoria de um ano continua em `server/backtests/reality/REPORT.md`. A aparência de jogo não constitui validação da estratégia.

Localmente o servidor escuta só em 127.0.0.1. Para publicar (Fly), o container usa `HOST=0.0.0.0` e **só inicia com `APP_PASSWORD`** definida: todas as rotas, inclusive a página, pedem usuário e senha (HTTP Basic, usuário `APP_USER`, padrão `admin`); só `/api/health` fica aberta. O mesmo servidor entrega o front compilado (`client/dist`), então página e API ficam na mesma origem.

```powershell
fly secrets set APP_PASSWORD="uma-senha-longa"
fly deploy
```

É uma senha única, sem usuários separados nem limite por usuário. No Fly, `server/data/` fica no disco da máquina e se perde quando ela é recriada (estado do bot, histórico, escola); para guardar, monte um volume em `/app/server/data`.

## Validação

```powershell
cd server
npm test
cd ../client
npm run lint
npm run build
```

Os testes do escritório usam diretórios temporários isolados, dependências falsas e servidor HTTP em loopback. Cobrem dados históricos não reconciliados, omissão de segredos, tarefas concorrentes, entrada inválida, falhas externas, ausência de ordens e contexto do chat.
