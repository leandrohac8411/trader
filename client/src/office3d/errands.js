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

/** Facts from the snapshot that the team talks about. */
export function facts(data) {
  const open = data?.bot?.positions?.length ?? 0;
  const max = data?.bot?.config?.maxOpen ?? 0;
  const res = data?.results;
  const today = res?.byDay?.find(d => d.day === res.today) || null;
  const leader = data?.school?.students?.find(s => s.rank === 1) || null;
  const signals = (data?.monitor?.items || []).filter(i => !i.stale && !i.error && ['LONG', 'SHORT'].includes(i.signal)).length;
  return { open, max, deskFull: max > 0 && open >= max, today, leader, signals,
    lastClosed: data?.bot?.closedTrades?.[0] || null };
}

/** What each person tells Arthur, and his answer. Returns null when there is nothing real to say. */
export function reportLines(id, f) {
  const lines = {
    risk: [`Chefe: ${f.open}/${f.max} posições abertas, risco dentro do teto.`, f.deskFull ? 'Mesa cheia. Ninguém entra sem vaga.' : 'Ok. Segue vigiando.'],
    analyst: f.deskFull
      ? [`Mesa cheia (${f.open}/${f.max}). Sinal novo espera vaga.`, 'Então descansa um pouco, Alice.']
      : [`${f.signals} sinal(is) de entrada no radar agora.`, 'Manda para o Ricardo aprovar.'],
    auditor: f.today
      ? [`Hoje: ${f.today.wins}V · ${f.today.losses}D, ${usd(f.today.netUsd)} realizado.`, f.today.netUsd >= 0 ? 'Bom dia de trabalho.' : 'Faz parte. Seguimos a regra.']
      : ['Hoje nenhum trade encerrado ainda.', 'Sem pressa. A regra manda.'],
    scientist: f.leader
      ? [`Escola: ${f.leader.name} lidera com ${r2(f.leader.study.expectancyR)}/trade no estudo.`, 'Interessante. Mas só papel por enquanto.']
      : null,
  }[id];
  return lines || null;
}

/** What someone says at the coffee machine or the energy-drink machine. */
export function drinkLine(id, kind, f) {
  if (kind === 'energy') {
    if (id === 'trader' && f.deskFull) return 'Energético e volto pro cochilo ⚡😴';
    if (id === 'trader') return 'Energético pra aguentar o mercado ⚡';
    return f.signals ? `${f.signals} sinal(is) no radar… preciso de um energético ⚡` : 'Um energético pra acordar ⚡';
  }
  if (id === 'auditor') return 'Café e de volta às planilhas ☕';
  if (id === 'scientist') return 'Café: o combustível do backtest ☕';
  if (id === 'risk') return 'Café sem açúcar. Risco controlado ☕';
  return 'Mais um café ☕';
}

/** A quick chat by the cooler between two people, built from the same facts. */
export function gossipLines(f, a, b) {
  const pool = [];
  if (f.deskFull) pool.push([`${f.open}/${f.max} abertas… nada a fazer até abrir vaga.`, 'Por isso o Lucas tá cochilando 😴']);
  if (f.leader) pool.push([`Viu? ${f.leader.name} tá em 1º na escola.`, 'A Sofia disse que ainda é cedo pra comemorar.']);
  if (f.today && f.today.netUsd) pool.push([`Hoje a mesa tá ${usd(f.today.netUsd)}.`, f.today.netUsd > 0 ? 'Café por conta do Arthur então ☕' : 'Amanhã é outro dia.']);
  if (f.lastClosed?.symbol) pool.push([`O último trade foi ${f.lastClosed.symbol.replace('USDT', '')}.`, f.lastClosed.pnlUsd > 0 ? 'Saiu no lucro, né?' : 'Esse eu prefiro esquecer.']);
  if (!pool.length) pool.push(['Mercado calmo hoje.', 'Melhor assim. Sem sinal, sem trade.']);
  const [first, second] = pool[Math.floor(Math.random() * pool.length)];
  return [[a, first], [b, second]];
}
