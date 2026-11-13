// server/src/services/approval.js
// Ciclo proposta → aprovação → execução (conta demo).
// Cada entrada do bot vira uma proposta; Ricardo (gerente de risco) a confere contra os
// limites configurados e aprova ou barra. Função pura: sem rede, sem estado.

const pct = (v, d = 2) => `${(Number(v) || 0).toFixed(d)}%`;

/**
 * @param {object} o
 * @param {{symbol:string, tf:string, dir:"LONG"|"SHORT", entry:number, stop:number, tp:number|null,
 *   probability:number, gate:number, riskPct:number, equity:number,
 *   sizing:{ok:boolean, qty:number, notional:number, riskUsd:number, capped:boolean, reason?:string}}} o.proposal
 * @param {{riskPct:number, maxOpen:number, maxNotionalPct:number, dryRun:boolean}} o.cfg
 * @param {number} o.openCount posições abertas agora (corretora ∪ estado local)
 * @param {boolean} o.symbolBusy já existe posição neste símbolo
 * @returns {{approved:boolean, reason:string|null, checks:Array<{id:string,label:string,ok:boolean,detail:string}>}}
 */
export function reviewProposal({ proposal: p, cfg, openCount = 0, symbolBusy = false, maxStopPct = 15 }) {
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok: !!ok, detail });

  add("gate", "Score acima do gate", p.probability >= p.gate, `score ${p.probability} · gate ${p.gate}`);

  const long = p.dir === "LONG";
  const sideOk = long ? p.stop < p.entry && (p.tp == null || p.tp > p.entry) : p.stop > p.entry && (p.tp == null || p.tp < p.entry);
  const stopPct = p.entry > 0 ? (Math.abs(p.entry - p.stop) / p.entry) * 100 : 0;
  add("levels", "Stop e alvo coerentes", sideOk && stopPct > 0 && stopPct <= maxStopPct,
    sideOk ? `stop a ${pct(stopPct)} da entrada (máx. ${maxStopPct}%)` : "stop ou alvo do lado errado da entrada");

  const maxRisk = cfg.riskPct * 2;
  add("risk", "Risco dentro do teto (2× base)", p.riskPct > 0 && p.riskPct <= maxRisk, `${pct(p.riskPct)} por trade · teto ${pct(maxRisk)}`);

  const sz = p.sizing || {};
  add("size", "Tamanho mínimo da corretora", !!sz.ok, sz.ok ? `qty ${sz.qty}` : sz.reason || "sem tamanho válido");

  const maxNotional = p.equity * cfg.maxNotionalPct;
  add("notional", "Posição abaixo do teto de notional", !!sz.ok && sz.notional <= maxNotional * 1.001,
    `US$ ${Math.round(sz.notional || 0)} de US$ ${Math.round(maxNotional)}${sz.capped ? " (reduzida pelo teto)" : ""}`);

  const riskCap = p.equity * (p.riskPct / 100);
  add("riskUsd", "Perda no stop dentro do risco", !!sz.ok && sz.riskUsd <= riskCap * 1.01,
    `US$ ${(sz.riskUsd || 0).toFixed(2)} de US$ ${riskCap.toFixed(2)}`);

  add("maxOpen", "Vaga de posição livre", cfg.dryRun || openCount < cfg.maxOpen,
    cfg.dryRun ? "dry-run: não ocupa vaga" : `${openCount}/${cfg.maxOpen} abertas`);

  add("symbol", "Sem posição no mesmo ativo", !symbolBusy, symbolBusy ? `já há posição em ${p.symbol}` : "livre");

  // Máquina do Tempo (timemachine.js): só entra na conta quando o bot a rodou para esta proposta.
  if (p.timeMachine) add("timemachine", "Máquina do Tempo não prevê perda", p.timeMachine.ok, p.timeMachine.text);

  const failed = checks.find((c) => !c.ok);
  return { approved: !failed, reason: failed ? `${failed.label}: ${failed.detail}` : null, failedId: failed?.id ?? null, checks };
}

/** Resumo enxuto de uma proposta para log/eventos (sem dados da conta além do necessário). */
export function proposalSummary(p) {
  return {
    symbol: p.symbol, tf: p.tf, dir: p.dir, entry: p.entry, stop: p.stop, tp: p.tp,
    probability: p.probability, riskPct: p.riskPct,
    qty: p.sizing?.qty ?? null, notional: p.sizing?.notional != null ? Math.round(p.sizing.notional) : null,
    riskUsd: p.sizing?.riskUsd != null ? Number(p.sizing.riskUsd.toFixed(2)) : null,
    timeMachine: p.timeMachine?.available ? { ok: p.timeMachine.ok, text: p.timeMachine.text } : null,
  };
}
