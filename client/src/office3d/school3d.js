// "Escola de traders": six student variants of the strategy in a classroom with a ranking board.
// Everything shown comes from snapshot.school (server/src/services/school.js); nothing is invented.
import * as THREE from 'three';
import { makeCanvas, canvasPanel, roundRect } from './voxel.js';
import { buildCharacter, pose } from './people.js';

// Order matches server STUDENTS; seats are fixed per student, the badge shows the live rank.
const STUDENT_LOOKS = {
  base: { skin: '#f0c29b', hair: '#4a2e1e', hairStyle: 'bob', jacket: '#8fb3ff' },
  rapido: { skin: '#c98d63', hair: '#1e1714', hairStyle: 'spiky', jacket: '#ffcf5a' },
  curto: { skin: '#e9b98f', hair: '#a4472c', hairStyle: 'long', jacket: '#ff8fb1' },
  alvo: { skin: '#8d5a3b', hair: '#141010', hairStyle: 'short', jacket: '#7fe0a6' },
  lento: { skin: '#f3c9a6', hair: '#d9b25a', hairStyle: 'long', jacket: '#c7a0ff' },
  largo: { skin: '#e2b08a', hair: '#5b3b26', hairStyle: 'swept', jacket: '#ffa66b' },
};
const SEATS = [['base', -2.2, 3.5], ['rapido', 0.7, 3.5], ['curto', -2.2, 5.3], ['alvo', 0.7, 5.3], ['lento', -2.2, 7.1], ['largo', 0.7, 7.1]];
const STATUS_COLOR = { aprovado: '#4ade80', aguardando: '#fbbf24', amostra: '#94a3b8', reprovado: '#ef4444', 'reprovado-prova': '#f97316' };
const YAW = -Math.PI / 2; // students face -X, towards the board

export function buildSchool(kit, scene) {
  const { box } = kit;
  // Board on the glass partition, facing +X.
  box(scene, [0.14, 2.75, 4.9], [-4.82, 1.95, 5.3], '#0d1218');
  const board = canvasPanel(scene, 4.6, 2.5, [-4.73, 1.95, 5.3], makeCanvas(1104, 600), Math.PI / 2);
  box(scene, [0.5, 0.06, 4.6], [-4.55, 0.62, 5.3], '#6b7a86'); // chalk ledge

  const students = SEATS.map(([id, x, z]) => {
    // Small desk in front (towards -X) and a stool.
    box(scene, [0.7, 0.07, 1.1], [x - 0.75, 0.82, z], '#e8d6b4');
    for (const dz of [-0.48, 0.48]) box(scene, [0.6, 0.78, 0.07], [x - 0.75, 0.39, z + dz], '#b99b74');
    box(scene, [0.5, 0.06, 0.38], [x - 0.8, 0.88, z - 0.15], '#1f2933'); // laptop
    const screen = box(scene, [0.04, 0.32, 0.38], [x - 0.98, 1.05, z - 0.15], '#1b2a38', { emissive: STUDENT_LOOKS[id].jacket, emissiveIntensity: 0.25 });
    box(scene, [0.55, 0.1, 0.55], [x + 0.05, 0.42, z], '#2c3440');
    box(scene, [0.08, 0.38, 0.08], [x + 0.05, 0.19, z], '#7d8790');
    const look = { shirt: '#f4f4f0', pants: '#2b2f36', shoes: '#1a1a1e', ...STUDENT_LOOKS[id] };
    const character = buildCharacter(kit, look);
    character.root.scale.setScalar(0.78);
    character.root.position.set(x + 0.05, 0, z);
    character.root.rotation.y = YAW;
    scene.add(character.root);
    const badge = badgeSprite();
    badge.sprite.position.set(x + 0.05, 2.5, z);
    scene.add(badge.sprite);
    return { id, character, badge, screen, state: 'idle' };
  });

  let drawn = '';
  function update(school) {
    const key = JSON.stringify([school?.lastRun, school?.running, school?.candidateId, school?.lastError]);
    for (const s of students) {
      const st = school?.students?.find(x => x.id === s.id);
      s.state = school?.running ? 'working' : st && s.id === school.candidateId ? 'monitoring' : 'idle';
      if (key !== drawn) s.badge.draw(st, s.id === school?.candidateId, school?.promotion?.ready);
    }
    if (key !== drawn) drawBoard(board, school);
    drawn = key;
  }
  function tick(t, motion) {
    for (const s of students) pose(s.character, s.state, t, motion);
  }
  return { students, update, tick };
}

function badgeSprite() {
  const canvas = makeCanvas(360, 110);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.25, 0.38, 1);
  sprite.visible = false;
  return {
    sprite,
    draw(st, candidate, ready) {
      ctx.clearRect(0, 0, 360, 110);
      if (!st) { sprite.visible = false; texture.needsUpdate = true; return; }
      const color = STATUS_COLOR[st.status?.code] || '#94a3b8';
      ctx.fillStyle = '#101820';
      roundRect(ctx, 6, 6, 348, 98, 26);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '800 44px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${st.rank}`, 26, 58);
      ctx.fillStyle = '#f2f6f8';
      ctx.font = '800 40px sans-serif';
      ctx.fillText(`${st.name.toUpperCase()}${candidate ? (ready ? ' 🎓' : ' ★') : ''}`, 112, 58, 230);
      texture.needsUpdate = true;
      sprite.visible = true;
    },
  };
}

const fmtR = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
function drawBoard({ ctx, texture }, school) {
  const W = 1104, H = 600;
  ctx.fillStyle = '#17241d';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#6b5236';
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f3efe0';
  ctx.font = 'italic 700 46px Georgia, serif';
  ctx.fillText('escola de traders', 40, 72);
  ctx.textAlign = 'right';
  ctx.font = '600 21px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#b8c9b9';
  const when = school?.lastRun ? new Date(school.lastRun).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  ctx.fillText(school?.running ? 'AVALIANDO…' : `1H · ${school?.symbols?.length || 0} MERCADOS · ${when}`, W - 40, 68);
  ctx.textAlign = 'left';
  const list = school?.students || [];
  if (!list.length) {
    ctx.fillStyle = '#d7dccb';
    ctx.font = '28px sans-serif';
    ctx.fillText(school?.lastError || (school ? 'Primeira avaliação em andamento…' : 'Escola indisponível neste servidor.'), 40, 160);
    texture.needsUpdate = true;
    return;
  }
  ctx.font = '600 19px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#93a796';
  const cols = [40, 110, 330, 520, 700, 860];
  ['#', 'ALUNO', 'ESTUDO R/T', 'PROVA R/T', 'PAPEL', 'SITUAÇÃO'].forEach((h, i) => ctx.fillText(h, cols[i], 120));
  list.forEach((s, i) => {
    const y = 168 + i * 56;
    const color = STATUS_COLOR[s.status?.code] || '#94a3b8';
    if (s.id === school.candidateId) {
      ctx.fillStyle = 'rgba(232,195,90,.14)';
      ctx.fillRect(28, y - 36, W - 56, 50);
    }
    ctx.fillStyle = '#f3efe0';
    ctx.font = '700 28px sans-serif';
    ctx.fillText(String(s.rank), cols[0], y);
    ctx.fillStyle = s.color || '#f3efe0';
    ctx.fillText(s.name, cols[1], y);
    ctx.font = '600 25px "IBM Plex Mono", monospace';
    ctx.fillStyle = s.study.expectancyR > 0 ? '#86efac' : '#fca5a5';
    ctx.fillText(`${fmtR(s.study.expectancyR)} (${s.study.n})`, cols[2], y);
    ctx.fillStyle = s.exam.n ? (s.exam.expectancyR > 0 ? '#86efac' : '#fca5a5') : '#93a796';
    ctx.fillText(s.exam.n ? `${fmtR(s.exam.expectancyR)} (${s.exam.n})` : '—', cols[3], y);
    ctx.fillStyle = '#d7dccb';
    ctx.fillText(`${s.paper.n}/${school.rules?.minPaper ?? 10}`, cols[4], y);
    ctx.fillStyle = color;
    ctx.font = '700 22px sans-serif';
    ctx.fillText(s.status.label, cols[5], y, W - cols[5] - 36);
  });
  ctx.fillStyle = school.promotion?.ready ? '#fde68a' : '#c9d3c4';
  ctx.font = '600 22px sans-serif';
  const promo = school.promotion?.ready
    ? `🎓 ${list.find(s => s.id === school.promotion.studentId)?.name} pronto para promoção${school.promotion.appliedToBot ? ' · aplicado ao bot demo' : ' · BOT_SCHOOL_PROMOTE=0'}`
    : `Ninguém promovido: ${school.promotion?.reasons?.[0] || '—'}`;
  ctx.fillText(promo, 40, H - 40, W - 80);
  texture.needsUpdate = true;
}
