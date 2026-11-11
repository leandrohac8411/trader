// Character cards ("fichas"). Personality is fixed copy; the last line is always live data.

export const FICHAS = {
  ceo: { emoji: '🧭', title: 'o CEO', traits: [['Superpoder', 'fecha o relatório do dia'], ['Ponto fraco', 'reunião que podia ser e-mail'], ['Mantra', 'sem registro, não aconteceu']] },
  analyst: { emoji: '📡', title: 'a analista', traits: [['Superpoder', 'vigia 5 mercados ao mesmo tempo'], ['Ponto fraco', 'terceiro café antes das 10h'], ['Mantra', 'score não é chance de lucro']] },
  risk: { emoji: '🛡️', title: 'o gerente de risco', traits: [['Superpoder', 'diz “não” com elegância'], ['Ponto fraco', 'planilha de 40 abas'], ['Mantra', 'a trava existe pra ser respeitada']] },
  trader: { emoji: '🎮', title: 'o trader', traits: [['Superpoder', 'entra no candle certo'], ['Ponto fraco', 'videogame no lounge'], ['Mantra', 'stop é custo, não derrota']] },
  scientist: { emoji: '🧪', title: 'a cientista', traits: [['Superpoder', 'mil velas em segundos'], ['Ponto fraco', 'amostra pequena tira o sono'], ['Mantra', 'backtest não é promessa'], ['Escola', 'dá aula para seis alunos-estratégia']] },
  auditor: { emoji: '🔎', title: 'o auditor', traits: [['Superpoder', 'acha o erro no log'], ['Ponto fraco', 'não confia em print'], ['Mantra', 'local não é reconciliado']] },
  dog: { emoji: '🐶', name: 'Max', title: 'o segurança', color: '#e9c98c', traits: [['Pagamento', 'petiscos'], ['Especialidade', 'guardar mesa travada'], ['Ponto fraco', 'soneca no serviço']] },
};

const n = v => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—');

export function liveStat(id, s) {
  if (!s) return 'conectando…';
  const game = s.game, mood = s.crew?.trader;
  if (id === 'ceo') return game ? `Meta: ${Math.round(game.goal.pct * 100)}% de US$ ${n(game.goal.targetUsd)}` : '—';
  if (id === 'analyst') {
    const live = (s.monitor?.items || []).filter(i => !i.stale && !i.error && ['LONG', 'SHORT'].includes(i.signal)).length;
    return `${live} sinal(is) de entrada agora`;
  }
  if (id === 'risk') {
    const p = s.proposals || [];
    const tally = p.length ? ` · ${p.filter(x => x.decision === 'approved').length}/${p.length} propostas aprovadas` : '';
    return game ? `Risco ${n(game.ladder.riskPct)}% · ${game.ladder.name}${game.ladder.appliedToBot ? '' : ' (só no placar)'}${tally}` : '—';
  }
  if (id === 'trader') return mood ? `Humor: ${mood.label}${mood.cooldown ? ' · no lounge' : ''}` : '—';
  if (id === 'scientist') {
    const r = s.agents?.find(a => a.id === 'scientist')?.result;
    const school = s.school;
    if (school?.students?.length) {
      const c = school.students.find(x => x.id === school.candidateId);
      return c ? `Professora da escola · destaque: ${c.name}` : 'Professora da escola · nenhum aluno aprovado';
    }
    return r?.kind === 'backtest' ? `Último backtest: ${n(r.stats.expectancyR)} R em ${r.stats.n} trades` : 'Nenhum backtest nesta sessão';
  }
  if (id === 'auditor') {
    const alerts = (s.events || []).filter(e => e.source === 'bot' && ['error', 'blocked'].includes(e.type)).length;
    return `${alerts} alerta(s) nos últimos eventos do bot`;
  }
  if (id === 'dog') return mood?.cooldown ? 'De guarda na mesa do Lucas' : 'Patrulhando os corredores';
  return '';
}

// Which character each camera "belongs" to, for the on-screen ficha overlay.
export const CAMERA_FICHA = { cam03: 'ceo', cam04: 'risk', cam05: 'trader', cam06: 'analyst', cam07: 'dog', cam08: 'scientist', cam10: 'scientist' };
