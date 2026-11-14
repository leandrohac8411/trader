// Little walks around the office: reporting to Arthur, a chat by the water cooler.
// Paths follow the aisles (see buildFloor in createOfficeScene.js): out from behind each chair,
// along the main aisle (z = AISLE_Z), then through a door gap to the destination.
// What people SAY on these walks comes from the snapshot (lines.js-style helpers below), never invented numbers.
import * as THREE from 'three';

export const AISLE_Z = -0.4;
const V = (x, z) => new THREE.Vector3(x, 0, z);

// From the seat to a point just off the main aisle.
const EXITS = {
  analyst: [[-1.6, -2.6]],
  trader: [[3.3, -2.4]],
  scientist: [[10.7, -6.2], [10.7, -1.0]],
  auditor: [[10.7, -2.6], [10.7, -1.0]],
  risk: [[-8.5, 3.0], [-5.8, 2.4], [-5.8, 1.5]],
};

// Diretoria: through the door in the z=-2.5 partition to the visitor chair facing Arthur.
export const BOSS = { entry: [[-6.55, -1.6], [-6.55, -3.0]], spot: { x: -7.6, z: -3.4, yaw: Math.PI, pose: 'reporting' } };

// Water cooler beside the lounge; up to three people stand around it facing the middle.
export const COOLER = { at: [11.4, 2.9], centre: [9.9, 3.2], entry: [[8.4, 0.9]],
  spots: [[9.2, 2.7], [10.5, 3.0], [9.8, 3.9]] };

// Coffee machine and energy-drink vending machine, next to the cooler (fronts face +Z, towards the cameras).
export const MACHINES = {
  coffee: { at: [11.5, 0.6], spot: [10.75, 1.4], pose: 'coffee' },
  energy: { at: [9.9, 0.6], spot: [9.05, 1.35], pose: 'energy' },
};

export function canWalk(id) { return !!EXITS[id]; }

function node(x, z, extra = {}) { return { pos: V(x, z), yaw: 0, ...extra }; }

/** Waypoints from the seat (not included) to the destination spot (last node holds yaw + pose). */
export function routeTo(id, dest, spotIndex = 0) {
  const exit = EXITS[id];
  if (!exit) return null;
  const [lx] = exit.at(-1);
  const out = [...exit.map(([x, z]) => node(x, z)), node(lx, AISLE_Z)];
  if (dest === 'boss') {
    return [...out, ...BOSS.entry.map(([x, z]) => node(x, z)), node(BOSS.spot.x, BOSS.spot.z, { yaw: BOSS.spot.yaw, pose: BOSS.spot.pose })];
  }
  if (MACHINES[dest]) {
    const m = MACHINES[dest];
    return [...out, ...COOLER.entry.map(([x, z]) => node(x, z)), node(m.spot[0], m.spot[1], { yaw: Math.atan2(m.at[0] - m.spot[0], m.at[1] - m.spot[1]), pose: m.pose })];
  }
  if (dest === 'cooler') {
    const [sx, sz] = COOLER.spots[spotIndex % COOLER.spots.length];
    const yaw = Math.atan2(COOLER.centre[0] - sx, COOLER.centre[1] - sz);
    return [...out, ...COOLER.entry.map(([x, z]) => node(x, z)), node(sx, sz, { yaw, pose: 'chatting' })];
  }
  return null;
}

const usd = v => `${v < 0 ? '−' : '+'}US$ ${Math.abs(Math.round(v)).toLocaleString('pt-BR')}`;
const r2 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2).replace('.', ',')} R`;
const pick = list => list[Math.floor(Math.random() * list.length)];
const coin = s => (s || '').replace('USDT', '').split('|')[0];

/** Facts from the snapshot that the team talks about (never invented numbers). */
export function facts(data) {
  const open = data?.bot?.positions?.length ?? 0;
  const max = data?.bot?.config?.maxOpen ?? 0;
  const res = data?.results;
  const today = res?.byDay?.find(d => d.day === res.today) || null;
  const students = data?.school?.students || [];
  const leader = students.find(s => s.rank === 1) || null;
  const items = (data?.monitor?.items || []).filter(i => !i.stale && !i.error);
  const signals = items.filter(i => ['LONG', 'SHORT'].includes(i.signal)).length;
  // Open positions: how far along from entry to target (or to stop), using the radar price.
  const moves = (data?.bot?.positions || []).map(p => {
    const sym = coin(p.key);
    const price = items.find(i => coin(i.symbol) === sym)?.price;
    if (!Number.isFinite(price) || !Number.isFinite(p.tp) || !Number.isFinite(p.stop)) return null;
    const short = p.side === 'Sell';
    const good = short ? price <= p.entry : price >= p.entry;
    const share = good ? (price - p.entry) / (p.tp - p.entry) : (price - p.entry) / (p.stop - p.entry);
    return { sym, short, good, pct: Math.round(Math.min(1, Math.max(0, share || 0)) * 100) };
  }).filter(Boolean);
  const best = moves.filter(m => m.good).sort((a, b) => b.pct - a.pct)[0] || null;
  const worst = moves.filter(m => !m.good).sort((a, b) => b.pct - a.pct)[0] || null;
  const allShort = open > 1 && (data?.bot?.positions || []).every(p => p.side === 'Sell');
  const hottest = items.filter(i => Number.isFinite(i.probability)).sort((a, b) => b.probability - a.probability)[0] || null;
  const hour = new Date().getHours();
  return { open, max, deskFull: max > 0 && open >= max, today, leader, signals, best, worst, allShort, hottest, hour,
    vera: students.find(s => s.id === 'empate') || null,
    total: res?.n ? { n: res.n, pnl: res.totalPnlUsd, win: Math.round(res.winRate * 100) } : null,
    lastClosed: data?.bot?.closedTrades?.[0] || null };
}

/** What each person tells Arthur, and his answer. Returns null when there is nothing real to say. */
export function reportLines(id, f) {
  const opts = {
    risk: [
      [`Chefe: ${f.open}/${f.max} posições abertas, risco dentro do teto.`, f.deskFull ? 'Mesa cheia. Ninguém entra sem vaga.' : 'Ok. Segue vigiando.'],
      f.worst && [`${f.worst.sym} está ${f.worst.pct}% do caminho até o stop.`, 'O stop está na corretora? Então deixa trabalhar.'],
      f.allShort && ['Todas as posições são vendidas. É quase uma aposta só.', 'Anotado. Vamos ver como o mercado reage.'],
    ],
    analyst: [
      f.deskFull ? [`Mesa cheia (${f.open}/${f.max}). Sinal novo espera vaga.`, 'Então descansa um pouco, Alice.']
        : [`${f.signals} sinal(is) de entrada no radar agora.`, 'Manda para o Ricardo aprovar.'],
      f.hottest && [`O mais quente agora é ${coin(f.hottest.symbol)}: score ${f.hottest.probability}.`, f.hottest.probability >= 90 ? 'Passa no gate. Fica de olho.' : 'Ainda abaixo de 90. Paciência.'],
      f.best && [`${f.best.sym} já andou ${f.best.pct}% até o alvo.`, 'Bom. Sem mexer: a regra decide a saída.'],
    ],
    auditor: [
      f.today ? [`Hoje: ${f.today.wins}V · ${f.today.losses}D, ${usd(f.today.netUsd)} realizado.`, f.today.netUsd >= 0 ? 'Bom dia de trabalho.' : 'Faz parte. Seguimos a regra.']
        : ['Hoje nenhum trade encerrado ainda.', 'Sem pressa. A regra manda.'],
      f.total && [`No total: ${f.total.n} trades, ${f.total.win}% de acerto, ${usd(f.total.pnl)}.`, f.total.n < 30 ? 'Ainda é pouco para concluir.' : 'Agora já dá para tirar conclusão.'],
      ['Conferi os registros com a corretora. Tudo batendo.', 'É isso que eu gosto de ouvir.'],
    ],
    scientist: [
      f.leader && [`Escola: ${f.leader.name} lidera com ${r2(f.leader.study.expectancyR)}/trade no estudo.`, 'Interessante. Mas só papel por enquanto.'],
      f.vera && ['A Vera testa subir o stop para a entrada no meio do caminho.', 'Se funcionar no papel, a gente conversa.'],
      ['Achei um bug no simulador: o 3R parecia melhor do que era.', 'Melhor descobrir agora do que com dinheiro de verdade.'],
    ],
  }[id];
  const list = (opts || []).filter(Boolean);
  return list.length ? pick(list) : null;
}

/** What someone says at the coffee machine or the energy-drink machine. */
export function drinkLine(id, kind, f) {
  if (kind === 'energy') {
    if (id === 'trader' && f.deskFull) return pick(['Energético e volto pro cochilo ⚡😴', 'Mesa cheia, energético e paciência ⚡', 'Se não posso operar, pelo menos bebo ⚡']);
    return pick([
      'Energético pra aguentar o mercado ⚡',
      f.signals ? `${f.signals} sinal(is) no radar… preciso de um energético ⚡` : 'Um energético pra acordar ⚡',
      f.hour >= 22 || f.hour < 6 ? 'Cripto não dorme. Eu também não ⚡' : 'Só um, prometo ⚡',
      'Lata gelada é outra coisa ⚡',
    ]);
  }
  const byId = {
    auditor: ['Café e de volta às planilhas ☕', 'Café forte: hoje tem conferência ☕'],
    scientist: ['Café: o combustível do backtest ☕', 'Mil velas pedem um café ☕', 'Enquanto o backtest roda… café ☕'],
    risk: ['Café sem açúcar. Risco controlado ☕', 'Um café enquanto os stops trabalham ☕'],
    ceo: ['Café do chefe, sem fila ☕', 'Reunião comigo mesmo. Com café ☕'],
    analyst: ['Café rápido, o radar não espera ☕', 'Pausa de 2 minutos ☕'],
    trader: ['Café pra acordar a mão ☕', 'Expresso duplo ☕'],
  };
  return pick([...(byId[id] || []), f.hour < 11 ? 'Primeiro café do dia ☕' : f.hour >= 18 ? 'Café de fim de tarde ☕' : 'Mais um café ☕']);
}

// Office small talk that does not depend on data.
const BANTER = [
  ['Alguém viu meu carregador?', 'Na mesa da Sofia, embaixo de três gráficos.'],
  ['Essa água tá gelada?', 'Geladinha. A melhor coisa do escritório.'],
  ['O cachorro roubou meu biscoito de novo.', 'Ele é da segurança. Está fiscalizando.'],
  ['Fim de semana o mercado não para, né?', 'Cripto não tem feriado.'],
  ['Você dormiu bem?', 'Sonhei com vela vermelha.'],
  ['Quem deixou a cafeteira vazia?', 'O Lucas. Sempre o Lucas.'],
  ['O Arthur tá de bom humor hoje?', 'Depende do resultado do dia.'],
  ['Essa planta tá viva ainda?', 'Mais viva que o meu portfólio.'],
];

/** A chat by the cooler between two people: 2 to 4 lines, from the facts plus some small talk. */
export function gossipLines(f, a, b) {
  const pool = [];
  if (f.deskFull) pool.push([`${f.open}/${f.max} abertas… nada a fazer até abrir vaga.`, 'Por isso o Lucas tá cochilando 😴', 'Ele chama isso de gestão de energia.']);
  if (f.best) pool.push([`Viu o ${f.best.sym}? Já andou ${f.best.pct}% até o alvo.`, 'Dá vontade de fechar e garantir…', 'Nada disso. O alvo é a regra.', 'Tá, tá. Sem mexer.']);
  if (f.worst) pool.push([`O ${f.worst.sym} tá indo pro lado do stop.`, 'Quanto falta?', `Já fez ${f.worst.pct}% do caminho. O stop está lá.`]);
  if (f.allShort) pool.push(['Tudo vendido de novo?', 'O mercado tá caindo, o bot foi junto.', 'Se virar, vira tudo junto…']);
  if (f.leader) pool.push([`Viu? ${f.leader.name} tá em 1º na escola.`, 'A Sofia disse que ainda é cedo pra comemorar.']);
  if (f.vera) pool.push(['Chegou aluna nova na escola, a Vera.', 'A do stop no empate?', 'Ela mesma. Vamos ver se protege o lucro.']);
  if (f.hottest && f.hottest.probability >= 85) pool.push([`${coin(f.hottest.symbol)} tá com score ${f.hottest.probability}.`, f.hottest.probability >= 90 ? 'Passa no gate!' : 'Quase lá. Falta pouco pro 90.']);
  if (f.today && f.today.netUsd) pool.push([`Hoje a mesa tá ${usd(f.today.netUsd)}.`, f.today.netUsd > 0 ? 'Café por conta do Arthur então ☕' : 'Amanhã é outro dia.']);
  if (f.lastClosed?.symbol) pool.push([`O último trade foi ${coin(f.lastClosed.symbol)}.`, f.lastClosed.pnlUsd > 0 ? 'Saiu no lucro, né?' : 'Esse eu prefiro esquecer.']);
  if (!pool.length) pool.push(['Mercado calmo hoje.', 'Melhor assim. Sem sinal, sem trade.']);
  // Small talk now and then, so it does not always sound like a meeting.
  const chosen = Math.random() < 0.3 ? pick(BANTER) : pick(pool);
  return chosen.map((text, i) => [i % 2 ? b : a, text]);
}
