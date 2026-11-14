// Voxel trading office on the rooftop of a night city.
// Public API: update, motion, zoom, focus, reset, setCamera, tour, dispose.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createKit, makeCanvas, canvasPanel, textSprite, roundRect, rng } from './voxel.js';
import { LOOKS, buildCharacter, pose, buildDog, createDogWalker } from './people.js';
import { buildSchool } from './school3d.js';
import logoUrl from './assets/logo-v2.webp';
import { routeTo, canWalk, facts, reportLines, gossipLines, drinkLine, COOLER, MACHINES } from './errands.js';

// Person position on the floor; ry rotates the station so that ry=0 faces -Z (towards the back wall).
const STATIONS = [
  { id: 'ceo', name: 'ARTHUR', role: 'DIRETORIA', x: -8.5, z: -6.0, ry: Math.PI, color: '#e6ad63', monitors: 1, executive: true },
  { id: 'analyst', name: 'ALICE', role: 'ANÁLISE', x: -1.6, z: -4.1, ry: 0, color: '#61c9bc', monitors: 2 },
  { id: 'trader', name: 'LUCAS', role: 'MESA DEMO', x: 3.3, z: -4.1, ry: 0, color: '#ee927b', monitors: 3 },
  { id: 'risk', name: 'RICARDO', role: 'RISCO', x: -8.5, z: 4.4, ry: Math.PI, color: '#c6a7ef', monitors: 2 },
  { id: 'scientist', name: 'SOFIA', role: 'PESQUISA', x: 9.4, z: -6.2, ry: Math.PI / 2, color: '#82b8eb', monitors: 2 },
  { id: 'auditor', name: 'DANIEL', role: 'AUDITORIA', x: 9.4, z: -2.6, ry: Math.PI / 2, color: '#bed18a', monitors: 2 },
];

export const CAMERAS = [
  { id: 'cam01', label: 'VISTA DO BAIRRO', target: [0, -9, 0], offset: [46, 34, 52], zoom: 0.3 },
  { id: 'cam02', label: 'COBERTURA', target: [0, 0, 0], offset: [24, 26, 30], zoom: 0.92 },
  { id: 'cam03', label: 'DIRETORIA', target: [-8.5, 1.4, -5.2], offset: [10, 9, 16], zoom: 2.3 },
  { id: 'cam04', label: 'GERÊNCIA DE RISCO', target: [-9, 1.6, 4.5], offset: [15, 10, 11], zoom: 2.1 },
  { id: 'cam05', label: 'MESA DO LUCAS', target: [3.3, 1.9, -5.6], offset: [3, 8, 13], zoom: 2.4 },
  { id: 'cam06', label: 'PREGÃO', target: [0.8, 2.1, -6.6], offset: [4, 6, 22], zoom: 1.45 },
  { id: 'cam07', label: 'SEGURANÇA', follow: 'dog', offset: [7, 6, 9], zoom: 3 },
  { id: 'cam08', label: 'PESQUISA', target: [8.6, 1.5, -4.4], offset: [16, 10, 4], zoom: 2.1 },
  { id: 'cam09', label: 'LOUNGE', target: [7.6, 0.6, 6.2], offset: [12, 13, 17], zoom: 1.9 },
  { id: 'cam10', label: 'ESCOLA DE TRADERS', target: [-2.2, 1.4, 5.3], offset: [13, 16, 3], zoom: 1.8 },
  { id: 'cam11', label: 'COPA', target: [10.5, 0.3, 2.9], offset: [6, 7, 16], zoom: 2.1 },
];
const TOUR = ['cam02', 'cam06', 'cam05', 'cam03', 'cam07', 'cam10', 'cam11', 'cam09', 'cam04', 'cam08', 'cam01'];
const FOCUS = { ceo: 'cam03', risk: 'cam04', trader: 'cam05', analyst: 'cam06', scientist: 'cam08', auditor: 'cam08' };
const TOUR_MS = 7000;
// De dia (visual 2) não há cidade: a vista geral fica mais perto, como uma maquete.
const DAY_CAM = { cam01: { target: [0, 0, 0], offset: [30, 30, 36], zoom: 0.72 }, cam02: { target: [-0.5, 0.9, -1.2], offset: [24, 22, 30], zoom: 1.16 } };

const UP = new THREE.Vector3(0, 1, 0);
// Lucas's walk from his desk to the lounge sofa (aisles only), ending seated facing the TV.
const LOUNGE_ROUTE = [[3.3, -2.4], [5.4, 0.9], [5.0, 3.1], [5.0, 7.0], [6.4, 7.1], [7.2, 7.75]]
  .map(([x, z], i, all) => ({ pos: new THREE.Vector3(x, 0, z), yaw: Math.PI, ...(i === all.length - 1 ? { pose: 'gaming' } : {}) }));
const MOOD_COLOR = { perigo: '#ef4444', alerta: '#f59e0b', normal: '#2dd4bf', confiante: '#4ade80' };

const STAGE_COLOR ={ go: '#4ade80', ready: '#fb923c', watch: '#fbbf24', none: '#7b8a96' };
const money = v => `${v < 0 ? '−' : '+'}US$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Tema: 'night' (cidade à noite, visual 1) ou 'day' (luz do dia, tons creme; visual 2).
let DAY = false;
const T = (night, day) => (DAY ? day : night);

export function createOfficeScene(host, { onSelect, onProject, onReady, onError, onCamera, theme = 'night' }) {
  DAY = theme === 'day';
  const kit = createKit();
  const { box, group } = kit;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(T('#0b1322', '#efe6d6'));
  scene.fog = new THREE.Fog(T('#0b1322', '#efe6d6'), T(95, 110), T(210, 260));

  const camera = new THREE.OrthographicCamera(-15, 15, 12, -12, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = T(1.15, 1.02);
  renderer.domElement.setAttribute('aria-label', 'Escritório 3D em blocos na cobertura de um prédio. Use os botões dos agentes para selecionar.');
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.32;
  controls.minZoom = 0.28;
  controls.maxZoom = 3.4;
  // Celular/tablet: 1 dedo rola a página (não prende o usuário na cena); 2 dedos giram e aproximam.
  if (window.matchMedia?.('(pointer: coarse)').matches) {
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    renderer.domElement.style.touchAction = 'pan-y';
  }

  // ── Lights ────────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(T('#b7c7e6', '#fff7e8'), T('#1d2534', '#cdbb9c'), T(1.6, 2.1)));
  const key = new THREE.DirectionalLight(T('#fff1dc', '#fff0d6'), T(2.7, 2.9));
  key.position.set(8, 22, 12);
  key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 60 });
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.03;
  scene.add(key);
  const fill = new THREE.DirectionalLight(T('#7fa5d8', '#ffe2b8'), T(0.9, 0.7));
  fill.position.set(-14, 10, -8);
  scene.add(fill);

  if (!DAY) buildCity(kit, scene);
  buildFloor(kit, scene);
  const school = buildSchool(kit, scene);

  // ── Wall screen (pregão) and risk panel ─────────────────────────────────
  box(scene, [9.6, 3.7, 0.18], [0.8, 2.3, -8.82], '#0d1218');
  const wall = canvasPanel(scene, 9.2, 3.35, [0.8, 2.3, -8.71], makeCanvas(1500, 546));
  box(scene, [0.18, 2.6, 4.9], [-11.82, 2.2, 4.4], '#0d1218');
  // Goals board (the rule, the goal and achievements) on the back wall, right of the main screen.
  box(scene, [5.6, 2.7, 0.16], [8.7, 2.45, -8.83], '#0d1218');
  const board = canvasPanel(scene, 5.3, 2.45, [8.7, 2.45, -8.73], makeCanvas(1060, 490));
  const riskPanel = canvasPanel(scene, 4.6, 2.3, [-11.71, 2.2, 4.4], makeCanvas(920, 460), Math.PI / 2);

  // ── Stations and people ─────────────────────────────────────────────────
  const people = [];
  for (const s of STATIONS) {
    const g = group(scene, [s.x, 0, s.z], s.ry);
    const screens = buildDesk(kit, g, s);
    const character = buildCharacter(kit, LOOKS[s.id]);
    // Characters live in world space so they can leave their desks.
    const seat = new THREE.Vector3(0, 0, 0.1).applyAxisAngle(UP, s.ry).add(new THREE.Vector3(s.x, 0, s.z));
    const seatYaw = s.ry + Math.PI;
    character.root.position.copy(seat);
    character.root.rotation.y = seatYaw;
    character.root.userData.agentId = s.id;
    scene.add(character.root);
    const bubble = createBubble(s.name, s.color);
    bubble.sprite.position.set(0, 3.75, 0);
    character.root.add(bubble.sprite);
    // Invisible hit volume makes the whole seated figure easy to click.
    const hit = box(character.root, [1.3, 2.4, 1.6], [0, 1.2, 0.2], '#fff', { transparent: true, opacity: 0, depthWrite: false }, { shadow: false });
    hit.userData.agentId = s.id;
    const zzz = textSprite('Zzz…', { w: 260, h: 120, font: '800 60px sans-serif', color: '#3d4b8c', scale: 1.1 });
    zzz.visible = false;
    zzz.position.set(-1.1, 2.3, 0); // beside the head, clear of the nameplate
    character.root.add(zzz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.95, 40),
      new THREE.MeshBasicMaterial({ color: s.color, side: THREE.DoubleSide, transparent: true, opacity: 0.2, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(seat.x, 0.04, seat.z);
    scene.add(ring);
    // Route nodes: 0 = own chair; errands (lounge, Arthur's office, water cooler) append the rest.
    const route = [{ pos: seat, yaw: seatYaw }];
    people.push({ s, g, character, screens, zzz, bubble, ring, state: 'idle', route, node: 0, goal: 0, errand: null });
  }

  // ── Max, the office dog ─────────────────────────────────────────────────
  const dog = buildDog(kit);
  scene.add(dog.root);
  const walkDog = createDogWalker(dog, [
    // Aisles only: around the operations desks, the TV stand and the sofa.
    [0, 0, 0.6], [5, 0, 0.9], [7.2, 0, 2.6], [4.4, 0, 2.8], [4.4, 0, 7.2], [2.6, 0, 6.8], [2.6, 0, 0.9],
    [-4, 0, 0.9], [-4.2, 0, -1.4], [-1.2, 0, -1.6], [6.2, 0, -1.5], [6.2, 0, 0.8],
  ], { guardApproach: [3.3, 0, -1.6] });
  const dogPos = new THREE.Vector3();
  const dogBubble = createBubble('MAX', '#d9a066');
  dogBubble.sprite.position.set(0, 2.85, 0);
  dog.root.add(dogBubble.sprite);

  // Blinking aviation light on the tallest tower; alarm light above the risk panel.
  const beacon = scene.getObjectByName('beacon');
  const alarm = box(scene, [0.3, 0.3, 0.9], [-11.75, 3.7, 4.4], '#5a1f24', { emissive: '#ff2020', emissiveIntensity: 0 });

  // Lounge TV shows a little game while someone is playing.
  const tv = canvasPanel(scene, 2.6, 1.4, [7.6, 1.4, 4.28], makeCanvas(320, 172));
  // Water cooler: where the team stops for a chat.
  const [cx, cz] = COOLER.at;
  box(scene, [0.55, 0.95, 0.55], [cx, 0.48, cz], '#e9eef2');
  box(scene, [0.42, 0.55, 0.42], [cx, 1.25, cz], '#7cc3ea', { transparent: true, opacity: 0.75 });
  box(scene, [0.12, 0.08, 0.1], [cx - 0.3, 0.8, cz], '#3b82c4');
  buildCoffeeMachine(kit, scene, MACHINES.coffee.at);
  const vending = buildVending(kit, scene, MACHINES.energy.at);
  drawTv(tv, 0, false);

  // ── Data → screens and reactions ──────────────────────────────────────
  let data = null, selected = 'analyst', motion = true;
  const seen = new Set();
  let primed = false, lastMood = null, lastCooldown = false, lastLevel = null, lastGoal = false, lastFull = false;
  const pending = []; // errands asked by real events (trade closed, school graded)
  const byId = id => people.find(p => p.s.id === id);
  const say = (id, text, ms = 9000) => (id === 'dog' ? dogBubble : byId(id)?.bubble)?.show(text, ms);
  const trader = () => data?.crew?.trader;
  function agentState(id) {
    const agent = data?.agents?.find(a => a.id === id);
    if (agent?.state === 'working') return 'working';
    if (agent?.state === 'error') return 'error';
    const f = facts(data);
    if (id === 'trader') return f.signals && !f.deskFull ? 'monitoring' : 'sleeping'; // sem vaga ou sem sinal: nada a fazer
    if (id === 'analyst' && f.deskFull) return 'idle'; // mesa cheia: sinal novo não entra
    if (agent?.state === 'monitoring') return 'monitoring';
    if (id === 'risk' && trader()?.cooldown) return 'monitoring';
    return 'idle';
  }
  // Speech bubbles come only from things that actually happened (alerts, bot log, tasks, mood changes).
  function react() {
    const fresh = [];
    for (const a of data?.monitor?.alerts || []) if (!seen.has(a.id)) { seen.add(a.id); fresh.push({ kind: 'alert', ...a }); }
    for (const e of data?.events || []) if (!seen.has(e.id)) { seen.add(e.id); fresh.push({ kind: 'event', ...e }); }
    const mood = trader();
    const ladder = data?.game?.ladder;
    const f = facts(data);
    if (!primed) { primed = true; lastMood = mood?.mood; lastCooldown = !!mood?.cooldown; lastLevel = ladder?.level ?? null; lastGoal = !!data?.game?.goal?.reached; lastFull = f.deskFull; return; }
    if (f.deskFull !== lastFull) {
      lastFull = f.deskFull;
      if (f.deskFull) { say('trader', `${f.open}/${f.max} abertas. Cochilo até abrir vaga 😴`); say('analyst', 'Mesa cheia: sinal novo espera vaga.'); }
      else { say('trader', 'Abriu vaga! Voltei.'); say('analyst', 'Vaga livre. De volta ao radar.'); }
    }
    if (ladder && lastLevel != null && ladder.level !== lastLevel) {
      if (ladder.level > lastLevel) { say('ceo', `Subimos: risco ${ladder.riskPct}%!`); say('risk', 'Aprovado. Teto continua 2×.'); }
      else say('risk', `Desce um degrau: risco ${ladder.riskPct}%.`);
    }
    lastLevel = ladder?.level ?? lastLevel;
    if (data?.game?.goal?.reached && !lastGoal) { say('ceo', 'Meta batida! (demo)'); say('dog', 'Au! 🎉'); }
    lastGoal = !!data?.game?.goal?.reached;
    for (const item of fresh.sort((a, b) => a.ts - b.ts)) {
      const sym = (item.symbol || item.message?.split(' ')[0] || '').replace('USDT', '');
      if (item.kind === 'alert' && item.type === 'signal.detected') say('analyst', `${sym}: ${item.signal === 'LONG' ? 'compra' : 'venda'} na mira!`);
      if (item.kind === 'alert' && item.type === 'signal.withdrawn') say('analyst', `${sym}: sinal retirado`);
      if (item.kind !== 'event') continue;
      if (item.source === 'bot') {
        if (item.type === 'opened') say('trader', `Entrei em ${sym} (demo)`);
        if (item.type === 'closed') { say('trader', `Fechei ${sym}. Registrado.`); pending.push({ id: 'trader', kind: 'closed', sym }); }
        if (item.type === 'would_open') say('trader', `Entraria em ${sym} (dry-run)`);
        if (item.type === 'error') say('auditor', 'Erro no log do bot!');
        if (item.type === 'approved') say('risk', `Aprovado: ${sym} ✓`);
        if (item.type === 'blocked') say('risk', `Barrado: ${sym} ✗`);
      } else if (item.type === 'task.started') say(item.agentId, 'Deixa comigo!', 4000);
      else if (item.type === 'task.completed') say(item.agentId, 'Pronto!', 4000);
      else if (item.type === 'task.failed') say(item.agentId, 'Ih, falhou…', 5000);
      else if (item.type === 'manager.review') say('ceo', 'Chegou o parecer do gerente.');
      else if (item.type === 'school.graded') pending.push({ id: 'scientist', kind: 'report' });
      else if (item.type === 'school.promoted') say('scientist', 'Temos um formando! 🎓');
      else if (item.type === 'school.demoted') say('scientist', 'Promoção suspensa.');
      else if (item.type === 'school.failed') say('scientist', 'A avaliação falhou.', 5000);
    }
    if (mood && mood.mood !== lastMood) {
      const line = { perigo: 'Preciso parar um pouco…', alerta: 'Atenção redobrada.', confiante: 'Sequência boa!', normal: 'Tudo sob controle.' }[mood.mood];
      if (!mood.cooldown) say('trader', line);
      lastMood = mood.mood;
    }
    if (!!mood?.cooldown !== lastCooldown) {
      lastCooldown = !!mood?.cooldown;
      if (lastCooldown) {
        say('trader', 'Cansei. Videogame!');
        say('risk', 'Trava ativa. Mesa fechada.');
        say('dog', 'Au! Au!');
      } else {
        say('trader', 'De volta à mesa.');
        say('risk', 'Travas liberadas.');
      }
    }
  }
  function drawAll() {
    react();
    const mood = trader();
    for (const p of people) {
      p.state = agentState(p.s.id);
      p.screens.forEach((screen, i) => drawMonitor(screen, monitorContent(p.s, i, data), p.s.color));
    }
    walkDog.guard(mood?.cooldown ? [3.3, 0, -2.9] : null);
    // Lucas goes to the lounge during the cooldown and comes back when it ends.
    const lucas = byId('trader');
    lucas.wantLounge = !!mood?.cooldown;
    if (lucas.errand && (lucas.errand.kind === 'lounge') !== lucas.wantLounge) sendHome(lucas);
    drawWall(wall, data);
    drawRisk(riskPanel, data);
    drawBoard(board, data);
    school.update(data?.school);
  }

  // ── Interaction ─────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  const onDown = e => { down = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObjects(people.map(p => p.character.root), true)) {
      for (let o = hit.object; o; o = o.parent) if (o.userData.agentId) return onSelect(o.userData.agentId);
    }
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  const lost = e => { e.preventDefault(); onError?.('O contexto 3D foi interrompido. Recarregue a página para restaurar o escritório.'); };
  renderer.domElement.addEventListener('webglcontextlost', lost);

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const half = Math.max(11.5, (15 * h) / w);
    camera.left = (-half * w) / h;
    camera.right = (half * w) / h;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // ── Cameras: presets, smooth moves, follow and tour ─────────────────────
  let activeCam = null, anim = null, tourOn = false, tourAt = 0;
  const presetGoal = preset => {
    if (DAY && DAY_CAM[preset.id]) preset = { ...preset, ...DAY_CAM[preset.id] };
    const target = preset.follow === 'dog' ? dogPos.clone().add(new THREE.Vector3(0, 0.9, 0)) : new THREE.Vector3(...preset.target);
    return { target, pos: target.clone().add(new THREE.Vector3(...preset.offset)), zoom: preset.zoom };
  };
  function emitCamera() {
    const preset = CAMERAS.find(c => c.id === activeCam);
    onCamera?.({ id: activeCam, label: preset?.label || 'CÂMERA LIVRE', index: preset ? CAMERAS.indexOf(preset) + 1 : null, tour: tourOn });
  }
  function setCamera(id, { instant = false } = {}) {
    const preset = CAMERAS.find(c => c.id === id);
    if (!preset) return;
    activeCam = id;
    anim = { preset, from: { pos: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom },
      t0: performance.now(), dur: instant || !motion ? 0 : 1400 };
    controls.enabled = false;
    emitCamera();
  }
  controls.addEventListener('start', () => {
    if (anim) return;
    if (activeCam || tourOn) { activeCam = null; tourOn = false; emitCamera(); }
  });
  setCamera('cam02', { instant: true });

  // ── Errands: report to Arthur, chat by the cooler, Lucas's lounge break ──
  const timers = [];
  let nextIdleAt = performance.now() + 20_000, lastErrandCheck = 0;
  const later = (ms, fn) => timers.push({ at: performance.now() + ms, fn });
  const atDesk = p => !p.errand && p.node === 0 && p.goal === 0;
  // Free for a walk: at the desk with nothing running (Arthur stays in his office, Lucas only walks for a reason).
  const isFree = p => atDesk(p) && canWalk(p.s.id) && p.s.id !== 'trader' && p.state === 'idle';
  function sendOn(p, kind, nodes, { hold = 9, lines = [] } = {}) {
    if (!nodes || !atDesk(p)) return false;
    p.route = [p.route[0], ...nodes];
    p.goal = p.route.length - 1;
    p.errand = { kind, hold, lines, arrived: false, returning: false, until: Infinity, partner: null };
    if (!motion) p.node = p.goal;
    return true;
  }
  function sendHome(p) {
    if (!p.errand || p.errand.returning) return;
    p.errand.returning = true;
    p.goal = 0;
  }
  const bossBusy = () => people.some(p => p.errand && ['report', 'closed'].includes(p.errand.kind));
  const coolerBusy = () => people.some(p => p.errand?.kind === 'cooler');
  const machineBusy = kind => people.some(p => p.errand?.kind === kind);
  function startDrink(p, kind, f) {
    if (machineBusy(kind)) return false;
    return sendOn(p, kind, routeTo(p.s.id, kind), { hold: 8, lines: [[p.s.id, drinkLine(p.s.id, kind, f)]] });
  }
  function startReport(p, lines) {
    if (!lines || bossBusy()) return false;
    return sendOn(p, 'report', routeTo(p.s.id, 'boss'), { hold: 9, lines: [[p.s.id, lines[0]], ['ceo', lines[1]]] });
  }
  function startGossip(f) {
    if (coolerBusy()) return false;
    const free = people.filter(isFree).sort(() => Math.random() - 0.5).slice(0, 2);
    if (free.length < 2) return false;
    const [a, b] = free;
    const chat = gossipLines(f, a.s.id, b.s.id);
    sendOn(a, 'cooler', routeTo(a.s.id, 'cooler', 0), { hold: Math.max(13, chat.length * 3.4 + 2), lines: chat });
    sendOn(b, 'cooler', routeTo(b.s.id, 'cooler', 1), { hold: Math.max(13, chat.length * 3.4 + 2) });
    a.errand.partner = b;
    b.errand.partner = a;
    return true;
  }
  // Lines start once everyone is in place (both chatters, or the visitor seated).
  function begin(p, now) {
    for (const q of [p, p.errand.partner].filter(Boolean)) q.errand.until = now + q.errand.hold * 1000;
    p.errand.lines.forEach(([who, text], k) => later(k * 3200, () => say(who, text, 6000)));
  }
  function errandTick(now) {
    for (let i = timers.length - 1; i >= 0; i--) if (now >= timers[i].at) timers.splice(i, 1)[0].fn();
    for (const p of people) {
      const e = p.errand;
      if (!e) continue;
      if (e.returning) {
        if (p.node === 0 && p.goal === 0) { p.errand = null; p.route = [p.route[0]]; }
        continue;
      }
      if (e.kind !== 'lounge' && e.kind !== 'closed' && ['working', 'error'].includes(p.state)) { sendHome(p); continue; }
      if (!e.arrived && p.node === p.goal) {
        e.arrived = true;
        if (e.kind === 'lounge') continue; // stays until the cooldown ends
        if (!e.partner) begin(p, now);
        else if (e.partner.errand?.arrived) begin(e.lines.length ? p : e.partner, now);
        continue;
      }
      if (e.arrived && e.kind !== 'lounge' && now > e.until) sendHome(p);
    }
    if (now - lastErrandCheck < 1000) return;
    lastErrandCheck = now;
    const f = facts(data);
    const lucas = byId('trader');
    if (lucas.wantLounge && atDesk(lucas)) sendOn(lucas, 'lounge', LOUNGE_ROUTE, { hold: Infinity });
    // Event-driven first: Lucas reports a closed trade, Sofia reports the school.
    for (let i = 0; i < pending.length; i++) {
      const job = pending[i], p = byId(job.id);
      let ok = false;
      if (atDesk(p) && !bossBusy() && !(job.id === 'trader' && lucas.wantLounge)) {
        if (job.kind === 'closed') {
          const t = f.today;
          const day = t ? `Hoje estamos ${t.netUsd >= 0 ? '+' : '−'}US$ ${Math.abs(Math.round(t.netUsd)).toLocaleString('pt-BR')}.` : 'Segue a regra.';
          ok = sendOn(p, 'closed', routeTo('trader', 'boss'), { hold: 8, lines: [['trader', `Chefe, fechei ${job.sym}.`], ['ceo', `${day} Obrigado, Lucas.`]] });
        } else ok = startReport(p, reportLines(job.id, f));
      }
      job.tries = (job.tries || 0) + 1;
      if (ok || job.tries > 60) { pending.splice(i, 1); i--; }
    }
    // Now and then, someone free takes a walk: a chat, a report, or a coffee/energy drink.
    if (motion && now > nextIdleAt) {
      nextIdleAt = now + 20_000 + Math.random() * 25_000;
      const roll = Math.random();
      const pick = list => list[Math.floor(Math.random() * list.length)];
      if (roll < 0.35) startGossip(f);
      else if (roll < 0.65) {
        const who = pick(people.filter(p => isFree(p) && reportLines(p.s.id, f)));
        if (who) startReport(who, reportLines(who.s.id, f));
      } else {
        // Lucas only gets up for an energy drink when the desk is full (nothing to do anyway).
        const drinkers = people.filter(p => isFree(p) || (p.s.id === 'trader' && f.deskFull && atDesk(p) && !lucas.wantLounge));
        const who = pick(drinkers);
        if (who) startDrink(who, who.s.id === 'trader' || Math.random() < 0.4 ? 'energy' : 'coffee', f);
      }
    }
  }
  drawAll();

  // ── Render loop ─────────────────────────────────────────────────────────
  let frame, disposed = false, lastFrame = 0, last = performance.now(), tvAt = 0;
  const headPos = new THREE.Vector3();
  // Walk node by node towards p.goal; returns the pose to use this frame.
  function moveAlongRoute(p, dt, animate) {
    const root = p.character.root;
    if (!animate) p.node = p.goal;
    if (p.node === p.goal) {
      const spot = p.route[p.node];
      root.position.copy(spot.pos);
      root.rotation.y = spot.yaw;
      return p.node === 0 ? p.state : p.route[p.node].pose || 'idle';
    }
    const next = p.route[p.node + Math.sign(p.goal - p.node)];
    const to = next.pos.clone().sub(root.position);
    const len = to.length();
    if (len > 1e-3) {
      const yaw = Math.atan2(to.x, to.z);
      root.rotation.y += Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y)) * Math.min(1, dt * 10);
      root.position.add(to.multiplyScalar(Math.min(len, dt * 1.7) / len));
    }
    if (root.position.distanceTo(next.pos) < 0.04) p.node += Math.sign(p.goal - p.node);
    return 'walking';
  }
  function render(now) {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    if (document.hidden || now - lastFrame < 32) return;
    lastFrame = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    dogPos.copy(walkDog(dt, t, motion));
    errandTick(now);
    let gaming = false;
    for (const p of people) {
      const state = moveAlongRoute(p, dt, motion);
      pose(p.character, state, t, motion);
      if (state === 'gaming') gaming = true;
      p.zzz.visible = state === 'sleeping';
      if (p.zzz.visible) p.zzz.position.y = 2.3 + (motion ? Math.sin(t * 1.5) * 0.12 : 0);
      p.bubble.tick(now);
      const root = p.character.root.position;
      p.ring.position.set(root.x, 0.04, root.z);
      p.ring.material.opacity = p.s.id === selected ? 0.95 : 0.15;
      p.ring.scale.setScalar(p.s.id === selected ? 1.1 + (motion ? Math.sin(t * 3) * 0.03 : 0) : 1);
    }
    school.tick(t, motion);
    dogBubble.tick(now);
    if (now - tvAt > 90) { tvAt = now; drawTv(tv, t, gaming); }
    vending.glow.material.emissiveIntensity = 0.9 + (motion ? Math.sin(t * 2) * 0.25 : 0);
    if (beacon) beacon.material.emissiveIntensity = Math.sin(t * 3) > 0.6 ? 3 : 0.2;
    alarm.material.emissiveIntensity = trader()?.cooldown ? (Math.sin(t * 6) > 0 ? 2.5 : 0.3) : 0;

    if (tourOn && now - tourAt > TOUR_MS) {
      tourAt = now;
      setCamera(TOUR[(TOUR.indexOf(activeCam) + 1) % TOUR.length]);
    }
    if (anim) {
      const goal = presetGoal(anim.preset);
      const k = anim.dur ? Math.min(1, (now - anim.t0) / anim.dur) : 1;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(anim.from.pos, goal.pos, e);
      controls.target.lerpVectors(anim.from.target, goal.target, e);
      camera.zoom = THREE.MathUtils.lerp(anim.from.zoom, goal.zoom, e);
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      if (k >= 1) { anim = null; controls.enabled = true; controls.update(); }
    } else if (activeCam === 'cam07') {
      const goal = presetGoal(CAMERAS.find(c => c.id === 'cam07'));
      controls.target.lerp(goal.target, 0.12);
      camera.position.lerp(goal.pos, 0.12);
      camera.lookAt(controls.target);
    } else {
      controls.update();
    }

    renderer.render(scene, camera);
    const hideLabels = activeCam === 'cam01' || camera.zoom < 0.55;
    onProject(people.map(p => {
      p.character.head.getWorldPosition(headPos);
      headPos.y += 1.25;
      const v = headPos.project(camera);
      const offscreen = Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      return { id: p.s.id, x: (v.x * 0.5 + 0.5) * 100, y: (-0.5 * v.y + 0.5) * 100, hidden: hideLabels || offscreen, talking: p.bubble.sprite.visible };
    }));
  }
  frame = requestAnimationFrame(render);
  onReady?.();

  return {
    cameras: CAMERAS,
    debug: () => ({ dog: dogPos.toArray().map(v => +v.toFixed(2)), cooldown: !!trader()?.cooldown,
      trader: byId('trader').character.root.position.toArray().map(v => +v.toFixed(2)),
      errands: people.filter(p => p.errand).map(p => ({ id: p.s.id, kind: p.errand.kind, node: p.node, goal: p.goal, arrived: p.errand.arrived })),
      states: Object.fromEntries(people.map(p => [p.s.id, p.state])) }),
    // Dev only (window.__officeScene): start a walk now, to check the paths.
    debugErrand(kind, id = 'risk', other = 'auditor') {
      const p = byId(id), f = facts(data);
      if (kind === 'coffee' || kind === 'energy') return startDrink(p, kind, f);
      if (kind === 'cooler') { const q = byId(other); sendOn(p, 'cooler', routeTo(id, 'cooler', 0), { hold: 13, lines: gossipLines(f, id, other) }); sendOn(q, 'cooler', routeTo(other, 'cooler', 1), { hold: 13 }); p.errand.partner = q; q.errand.partner = p; }
      else startReport(p, reportLines(id, f) || ['Teste.', 'Ok.']);
    },
    update(next, id) { data = next; selected = id; drawAll(); },
    motion(value) { motion = value; },
    zoom(delta) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom + delta * camera.zoom, controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
    },
    focus(id) { if (FOCUS[id]) { tourOn = false; setCamera(FOCUS[id]); } },
    setCamera(id) { tourOn = false; setCamera(id); },
    tour(on) {
      tourOn = on;
      tourAt = performance.now();
      if (on) setCamera(TOUR.includes(activeCam) ? activeCam : 'cam02');
      else emitCamera();
    },
    reset() { tourOn = false; setCamera('cam02'); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(o => {
        if (o.geometry) geometries.add(o.geometry);
        for (const m of [o.material].flat().filter(Boolean)) {
          materials.add(m);
          for (const tex of [m.map, m.emissiveMap]) if (tex) textures.add(tex);
        }
      });
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      textures.forEach(t => t.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// ── Builders ──────────────────────────────────────────────────────────────

function buildDesk(kit, g, s) {
  const { box } = kit;
  const top = s.executive ? '#7a5236' : '#eef1f3';
  const w = s.monitors === 3 ? 3.2 : s.executive ? 2.9 : 2.5;
  box(g, [w, 0.1, 1.15], [0, 1.05, -1.15], top);
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) box(g, [0.1, 1.0, 1.0], [x, 0.5, -1.15], s.executive ? '#5b3c28' : '#c9cfd4');
  if (s.executive) box(g, [w - 0.2, 0.75, 0.06], [0, 0.6, -0.62], '#5b3c28');
  box(g, [0.95, 0.04, 0.3], [0, 1.12, -0.8], '#2a2f36');
  box(g, [0.16, 0.04, 0.22], [0.7, 1.12, -0.8], '#2a2f36');
  box(g, [0.2, 0.22, 0.2], [-w / 2 + 0.35, 1.21, -0.85], s.color);
  // Chair
  box(g, [0.78, 0.12, 0.74], [0, 0.4, 0.12], '#2c3440');
  box(g, [0.78, 0.9, 0.12], [0, 0.9, 0.52], '#2c3440');
  box(g, [0.08, 0.36, 0.08], [0, 0.18, 0.12], '#7d8790');
  box(g, [0.7, 0.05, 0.1], [0, 0.03, 0.12], '#3a424c');
  box(g, [0.1, 0.05, 0.7], [0, 0.03, 0.12], '#3a424c');
  // Monitors facing the person
  const screens = [];
  const spacing = s.monitors === 3 ? 1.02 : 1.05;
  for (let i = 0; i < s.monitors; i++) {
    const x = (i - (s.monitors - 1) / 2) * spacing;
    const yaw = s.monitors === 3 ? (i - 1) * -0.25 : s.monitors === 2 ? (i - 0.5) * -0.2 : 0;
    const mount = kit.group(g, [x, 0, -1.5], yaw);
    box(mount, [0.98, 0.62, 0.06], [0, 1.6, 0], '#0f141a');
    box(mount, [0.08, 0.25, 0.08], [0, 1.2, -0.02], '#2a2f36');
    box(mount, [0.36, 0.03, 0.24], [0, 1.11, -0.02], '#2a2f36');
    screens.push(canvasPanel(mount, 0.9, 0.54, [0, 1.6, 0.035], makeCanvas(320, 192)));
  }
  return screens;
}

// Espresso machine on a small counter (front faces +Z).
function buildCoffeeMachine(kit, scene, [x, z]) {
  const { box, group } = kit;
  const g = group(scene, [x, 0, z]);
  box(g, [1.1, 1.0, 0.75], [0, 0.5, 0], '#5a6670');
  box(g, [1.15, 0.06, 0.8], [0, 1.03, 0], '#d6c3a5');
  box(g, [0.55, 0.62, 0.5], [-0.15, 1.37, -0.05], '#2b2f36');
  box(g, [0.36, 0.2, 0.06], [-0.15, 1.5, 0.22], '#b8c0c8');
  box(g, [0.06, 0.06, 0.03], [-0.32, 1.6, 0.21], '#ff4d4d', { emissive: '#ff4d4d', emissiveIntensity: 1.5 }, { shadow: false });
  box(g, [0.14, 0.14, 0.14], [-0.15, 1.13, 0.12], '#f4f1ea');
  for (let i = 0; i < 3; i++) box(g, [0.14, 0.16, 0.14], [0.2, 1.14 + i * 0.16, 0.18], '#f4f1ea');
  box(g, [0.24, 0.36, 0.24], [0.38, 1.24, -0.1], '#7a4b2a'); // coffee beans jar
}

// Energy-drink vending machine with a glowing front (generic brand, front faces +Z).
function buildVending(kit, scene, [x, z]) {
  const { box, group } = kit;
  const g = group(scene, [x, 0, z]);
  box(g, [1.05, 2.15, 0.85], [0, 1.08, 0], '#15181d');
  const glow = box(g, [0.95, 0.12, 0.04], [0, 2.05, 0.44], '#38e8ff', { emissive: '#38e8ff', emissiveIntensity: 1 }, { shadow: false });
  const front = canvasPanel(g, 0.92, 1.6, [0, 1.13, 0.435], makeCanvas(184, 320));
  drawVending(front);
  return { glow };
}

function drawVending({ ctx, texture }) {
  const W = 184, H = 320;
  ctx.fillStyle = '#0b0e12';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#38e8ff';
  ctx.font = '900 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('VOLT ⚡', W / 2, 36);
  ctx.font = '700 13px sans-serif';
  ctx.fillStyle = '#9fb3c8';
  ctx.fillText('ENERGÉTICO GELADO', W / 2, 56);
  const colors = ['#38e8ff', '#a3ff3c', '#ff5ad1', '#ffd23f'];
  for (let row = 0; row < 4; row++) {
    ctx.fillStyle = '#1b222b';
    ctx.fillRect(10, 72 + row * 52, W - 20, 46);
    for (let col = 0; col < 4; col++) {
      const cx = 22 + col * 36, cy = 78 + row * 52;
      ctx.fillStyle = '#20252c';
      ctx.fillRect(cx, cy, 24, 36);
      ctx.fillStyle = colors[(row + col) % colors.length];
      ctx.fillRect(cx, cy + 12, 24, 10);
    }
  }
  ctx.fillStyle = '#2a323c';
  ctx.fillRect(10, 284, W - 20, 18);
  texture.needsUpdate = true;
}

function buildFloor(kit, scene) {
  const { box } = kit;
  // Slab + building body (with lit windows) below the office floor.
  box(scene, [24.6, 0.4, 18.6], [0, -0.2, 0], '#cfd5da');
  if (DAY) {
    // maquete: base de madeira clara em vez do prédio
    box(scene, [25, 0.9, 19], [0, -0.85, 0], '#d9c3a0');
    box(scene, [25.4, 0.12, 19.4], [0, -1.32, 0], '#bfa47c');
  } else {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(26, 40, 20), windowMaterials(kit, 26, 40, 3));
    tower.position.set(0, -20.42, 0);
    scene.add(tower);
  }
  floorPlane(scene, 24, 18, [0, 0.005, 0], tileTexture());
  floorPlane(scene, 7, 6.5, [-8.5, 0.012, -5.75], plankTexture());
  floorPlane(scene, 7, 7.5, [-8.5, 0.012, 5.25], DAY ? plankTexture() : null, '#3b4660');
  floorPlane(scene, 5.4, 3.6, [7.6, 0.012, 6.1], null, T('#4b5d78', '#e3cfae'));

  // Outer glass walls (back and left); front and right stay open as a cutaway.
  if (DAY) {
    // paredes de fundo opacas, cor de areia, com rodapé de madeira e a marca dourada
    box(scene, [24.2, 3.6, 0.2], [0, 1.8, -9.1], '#efe4d2');
    box(scene, [0.2, 3.6, 18.2], [-12.1, 1.8, 0], '#ebdfcb');
    box(scene, [24.2, 0.22, 0.24], [0, 0.11, -8.98], '#b48a5c');
    box(scene, [0.24, 0.22, 18.2], [-11.98, 0.11, 0], '#b48a5c');
    brandPlaque(scene);
  } else {
    glassRun(kit, scene, [-12, -9], [12, -9], 3.6);
    glassRun(kit, scene, [-12, -9], [-12, 9], 3.6);
  }
  // Diretoria and risk-room partitions, with door gaps.
  glassRun(kit, scene, [-5, -9], [-5, -4.6], 3.2);
  glassRun(kit, scene, [-12, -2.5], [-7.2, -2.5], 3.2);
  glassRun(kit, scene, [-5.9, -2.5], [-5, -2.5], 3.2);
  glassRun(kit, scene, [-12, 1.5], [-6.6, 1.5], 3.2);
  glassRun(kit, scene, [-5, 2.9], [-5, 9], 3.2);

  // Diretoria: visitor chairs, credenza, books.
  for (const x of [-9.4, -7.6]) {
    box(scene, [0.75, 0.12, 0.7], [x, 0.42, -3.4], '#3f6066');
    box(scene, [0.75, 0.7, 0.12], [x, 0.8, -3.0], '#4a6b70');
    box(scene, [0.1, 0.4, 0.1], [x, 0.2, -3.4], '#2a3238');
  }
  box(scene, [4, 1.0, 0.6], [-8.5, 0.5, -8.5], '#5b3c28');
  for (let i = 0; i < 10; i++) box(scene, [0.18, 0.32 + (i % 3) * 0.08, 0.3], [-10.1 + i * 0.22, 1.18 + (i % 3) * 0.04, -8.5], ['#c1b18e', '#678b8c', '#a17c65'][i % 3]);
  plant(kit, scene, -11.2, -8.3, 1.2);

  // Former operations room is now the traders' school (school3d.js).

  // Lounge: pink sofa, coffee table, TV + console, bean bag.
  box(scene, [3.8, 0.5, 1.1], [7.6, 0.25, 8.0], '#e48aa6');
  box(scene, [3.8, 0.9, 0.35], [7.6, 0.75, 8.5], '#d77897');
  for (const x of [5.55, 9.65]) box(scene, [0.35, 0.75, 1.1], [x, 0.37, 8.0], '#d77897');
  box(scene, [1.6, 0.4, 0.8], [7.6, 0.2, 6.2], '#a9774f');
  box(scene, [0.5, 0.08, 0.3], [7.4, 0.44, 6.2], '#2a2f36');
  box(scene, [3.2, 0.5, 0.6], [7.6, 0.25, 4.2], '#2b313a');
  box(scene, [2.8, 1.6, 0.12], [7.6, 1.4, 4.2], '#0f141a');
  box(scene, [0.9, 0.7, 0.9], [10.3, 0.35, 5.8], '#8f5bd6');
  box(scene, [0.7, 0.3, 0.7], [10.3, 0.75, 5.8], '#9c6ce0');
  plant(kit, scene, 11.2, 8.2, 1.1);
  plant(kit, scene, 4.6, 8.3, 0.9);

  // Coffee corner and plants along the glass.
  box(scene, [2.6, 1.05, 0.7], [-1.0, 0.52, 8.4], '#5a6670');
  box(scene, [2.7, 0.08, 0.8], [-1.0, 1.08, 8.4], '#d6c3a5');
  box(scene, [0.5, 0.6, 0.45], [-0.4, 1.4, 8.45], '#1e252c');
  plant(kit, scene, -11.2, -0.5, 1.2);
  plant(kit, scene, 11.3, -8.4, 1.0);
  plant(kit, scene, -4.2, -8.4, 0.9);

  // Floor signs.
  floorSign(scene, 'DIRETORIA', -8.5, -2.95, 3, '#7a5236');
  floorSign(scene, 'PREGÃO', 0.8, -1.9, 3, '#5d7f8a');
  floorSign(scene, 'PESQUISA & AUDITORIA', 9.0, -0.6, 4.4, '#5d7f8a');
  floorSign(scene, 'GERÊNCIA DE RISCO', -8.5, 2.05, 4, '#c6a7ef');
  floorSign(scene, 'ESCOLA DE TRADERS', -1.4, 1.35, 4, '#4f7a5c');
  floorSign(scene, 'LOUNGE', 7.6, 3.4, 2.4, '#d77897');
}

function buildCity(kit, scene) {
  const rand = rng(20261110);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: T('#171e2b', '#d9cfbd'), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -40.4;
  scene.add(ground);
  let tallest = null;
  for (let gx = -8; gx <= 8; gx++) for (let gz = -8; gz <= 8; gz++) {
    const x = gx * 9.5, z = gz * 9.5;
    if (Math.abs(x) < 17 && Math.abs(z) < 14) continue;
    if (Math.hypot(x, z) > 82) continue;
    if (gx % 3 === 0 || gz % 4 === 0) continue; // avenues
    if (rand() < 0.14) { park(kit, scene, x, z, rand); continue; }
    const w = 5 + rand() * 2.8, d = 5 + rand() * 2.8;
    // Our tower tops out at 0: nearby blocks stay lower so it stands out; far ones frame the skyline.
    const dist = Math.hypot(x, z);
    const h = dist < 34 ? 10 + rand() * 22 : 14 + rand() * (24 + (dist - 34) * 0.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), windowMaterials(kit, w, h, Math.floor(rand() * 3)));
    mesh.position.set(x + (rand() - 0.5) * 1.5, -40.4 + h / 2, z + (rand() - 0.5) * 1.5);
    scene.add(mesh);
    if (rand() < 0.5) kit.box(scene, [w * 0.3, 1, d * 0.3], [mesh.position.x, -40.4 + h + 0.5, mesh.position.z], T('#3a4352', '#cbbfa9'), {}, { shadow: false });
    if (!tallest || h > tallest.h) tallest = { h, x: mesh.position.x, z: mesh.position.z };
  }
  if (tallest && !DAY) {
    kit.box(scene, [0.3, 3, 0.3], [tallest.x, -40.4 + tallest.h + 1.5, tallest.z], '#4a5262', {}, { shadow: false });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshStandardMaterial({ color: '#ff4040', emissive: '#ff2020', emissiveIntensity: 2 }));
    beacon.name = 'beacon';
    beacon.position.set(tallest.x, -40.4 + tallest.h + 3.2, tallest.z);
    scene.add(beacon);
  }
}

function park(kit, scene, x, z, rand) {
  kit.box(scene, [8, 0.2, 8], [x, -40.3, z], T('#24432f', '#9fbf86'), {}, { shadow: false });
  for (let i = 0; i < 5; i++) {
    const tx = x + (rand() - 0.5) * 6, tz = z + (rand() - 0.5) * 6, s = 0.8 + rand() * 0.8;
    kit.box(scene, [0.4 * s, 1.4 * s, 0.4 * s], [tx, -40.2 + 0.7 * s, tz], '#5b4130', {}, { shadow: false });
    kit.box(scene, [1.8 * s, 1.6 * s, 1.8 * s], [tx, -40.2 + 2 * s, tz], rand() < 0.5 ? '#3f7d4a' : '#4d9457', {}, { shadow: false });
  }
}

const windowCache = new Map();
function windowTexture(variant) {
  const id = `${DAY ? 'd' : 'n'}${variant}`;
  if (windowCache.has(id)) return windowCache.get(id);
  const rand = rng(77 + variant);
  const c = makeCanvas(128, 256), ctx = c.getContext('2d');
  ctx.fillStyle = DAY ? ['#e8dcc6', '#d9cdb8', '#efe7d8', '#e2d4bb'][variant] : ['#2a3344', '#323a48', '#263040'][variant];
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
    const lit = rand() < 0.38;
    ctx.fillStyle = DAY ? (lit ? '#a9c4d6' : '#8eaec4') : lit ? (rand() < 0.8 ? '#ffd68a' : '#cfe6ff') : '#151b26';
    ctx.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  windowCache.set(id, tex);
  return tex;
}

function windowMaterials(kit, w, h, variant) {
  const side = width => {
    const tex = windowTexture(variant).clone();
    tex.repeat.set(Math.max(1, Math.round(width / 5)), Math.max(1, Math.round(h / 10)));
    tex.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: DAY ? 0 : 0.55, roughness: 0.9 });
  };
  const roof = kit.material(T('#2f3644', '#c9bda6'));
  const a = side(w), b = side(w);
  return [b, b, roof, roof, a, a];
}

function glassRun(kit, scene, [x1, z1], [x2, z2], height) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const alongX = Math.abs(z2 - z1) < 1e-6;
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const glass = { transparent: true, opacity: 0.16, metalness: 0.2, roughness: 0.1, depthWrite: false };
  const size = alongX ? [len, height, 0.06] : [0.06, height, len];
  kit.box(scene, size, [cx, height / 2, cz], '#a8d4e6', glass, { shadow: false });
  kit.box(scene, alongX ? [len, 0.1, 0.12] : [0.12, 0.1, len], [cx, height, cz], '#8796a3');
  kit.box(scene, alongX ? [len, 0.12, 0.12] : [0.12, 0.12, len], [cx, 0.06, cz], '#8796a3');
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    kit.box(scene, [0.08, height, 0.08], [x1 + (x2 - x1) * f, height / 2, z1 + (z2 - z1) * f], '#8796a3');
  }
}

function plant(kit, scene, x, z, s = 1) {
  const g = kit.group(scene, [x, 0, z]);
  g.scale.setScalar(s);
  kit.box(g, [0.6, 0.6, 0.6], [0, 0.3, 0], '#d9d2c5');
  kit.box(g, [0.5, 0.06, 0.5], [0, 0.62, 0], '#4a3a2c');
  const greens = ['#3f7d4a', '#4d9457', '#5aa564'];
  [[0, 1.0, 0, 0.6], [0.18, 1.45, 0.1, 0.45], [-0.15, 1.75, -0.1, 0.4], [0.05, 2.05, 0.05, 0.3]].forEach(([dx, y, dz, b], i) =>
    kit.box(g, [b, b, b], [dx, y, dz], greens[i % 3]));
}

function floorPlane(scene, w, d, [x, y, z], texture, color = '#ffffff') {
  const mat = new THREE.MeshStandardMaterial({ color, map: texture || null, roughness: 0.85 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (texture) texture.repeat.set(w / 2, d / 2);
}

function brandPlaque(scene) {
  // placa clara com a logo, na parede esquerda da diretoria, de frente para a sala
  const c = makeCanvas(1024, 368), ctx = c.getContext('2d');
  ctx.fillStyle = '#fbf6ec';
  ctx.fillRect(0, 0, 1024, 368);
  const p = canvasPanel(scene, 4.4, 1.58, [-11.97, 2.45, -5.8], c);
  p.mesh.rotation.y = Math.PI / 2;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(980 / img.width, 340 / img.height), w = img.width * k, h = img.height * k;
    ctx.drawImage(img, (1024 - w) / 2, (368 - h) / 2, w, h);
    p.texture.needsUpdate = true;
  };
  img.src = logoUrl;
}

function tileTexture() {
  const c = makeCanvas(128, 128), ctx = c.getContext('2d');
  ctx.fillStyle = DAY ? '#f1ebe1' : '#e4e8eb';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = DAY ? '#e2d8c7' : '#cdd3d8';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function plankTexture() {
  const c = makeCanvas(128, 128), ctx = c.getContext('2d');
  ['#9a6b45', '#a7774f', '#8f6240', '#a06f49'].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, i * 32, 128, 32); });
  ctx.fillStyle = '#7a5236';
  for (let i = 0; i < 4; i++) { ctx.fillRect(0, i * 32, 128, 2); ctx.fillRect((i * 47) % 128, i * 32, 2, 32); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function floorSign(scene, text, x, z, width, color) {
  const c = makeCanvas(768, 96), ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = '700 46px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 384, 64);
  const p = canvasPanel(scene, width, (width * 96) / 768, [x, 0.03, z], c);
  p.mesh.rotation.x = -Math.PI / 2;
  p.mesh.material.transparent = true;
  p.mesh.material.depthWrite = false;
}

// ── Speech bubbles ────────────────────────────────────────────────────────

// Speech bubble with the speaker's name on top (the HTML nameplate hides while someone talks).
function createBubble(name = '', color = '#1b2430') {
  const W = 720, H = 230;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }));
  sprite.renderOrder = 10;
  sprite.scale.set(5, 5 * H / W, 1);
  sprite.visible = false;
  let until = 0;
  return {
    sprite,
    show(text, ms) {
      ctx.clearRect(0, 0, W, H);
      ctx.font = '700 50px sans-serif';
      const w = Math.min(W - 20, Math.max(ctx.measureText(text).width, 200) + 80);
      const x = (W - w) / 2;
      ctx.fillStyle = '#fffaf0';
      ctx.strokeStyle = '#1b2430';
      ctx.lineWidth = 6;
      roundRect(ctx, x, 10, w, 170, 34);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W / 2 - 22, 178);
      ctx.lineTo(W / 2, 222);
      ctx.lineTo(W / 2 + 24, 178);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (name) {
        ctx.fillStyle = color;
        ctx.font = '800 34px sans-serif';
        ctx.fillText(name.toUpperCase(), W / 2, 50, w - 60);
      }
      ctx.fillStyle = '#1b2430';
      ctx.font = '700 50px sans-serif';
      ctx.fillText(text, W / 2, name ? 118 : 95, w - 50);
      texture.needsUpdate = true;
      sprite.visible = true;
      until = performance.now() + ms;
    },
    tick(now) { if (sprite.visible && now > until) sprite.visible = false; },
  };
}

function drawTv({ ctx, texture }, t, playing) {
  ctx.fillStyle = playing ? '#14183a' : '#1d2f4d';
  ctx.fillRect(0, 0, 320, 172);
  if (!playing) {
    ctx.fillStyle = '#7fa5d8';
    ctx.font = '700 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LOUNGE', 160, 80);
    ctx.font = '15px monospace';
    ctx.fillText('pausa = parte da regra', 160, 110);
    ctx.textAlign = 'left';
  } else {
    // A tiny block game: a runner jumping over obstacles.
    ctx.fillStyle = '#2b3170';
    ctx.fillRect(0, 140, 320, 32);
    const jump = Math.max(0, Math.sin(t * 4)) * 50;
    ctx.fillStyle = '#ee927b';
    ctx.fillRect(60, 112 - jump, 24, 28);
    ctx.fillStyle = '#4ade80';
    for (let i = 0; i < 3; i++) ctx.fillRect(((i * 140 - t * 120) % 420 + 420) % 420 - 50, 120, 18, 20);
    ctx.fillStyle = '#ffd68a';
    ctx.font = '700 18px monospace';
    ctx.fillText(`SCORE ${Math.floor(t * 10) % 10000}`, 12, 26);
  }
  texture.needsUpdate = true;
}

// ── Screen drawing (real snapshot data only; nothing invented) ────────────

function monitorContent(s, i, data) {
  const agent = data?.agents?.find(a => a.id === s.id);
  const items = data?.monitor?.items || [];
  const bot = data?.bot;
  const stateText = { working: 'EM CONSULTA', monitoring: 'MONITORANDO', error: 'FALHOU' }[agent?.state] || 'EM ESPERA';
  if (!data) return { title: s.role, big: 'CONECTANDO…', lines: [] };
  if (s.id === 'analyst') {
    if (i === 0) return { title: 'RADAR', bars: items.map(it => ({ label: it.symbol.replace('USDT', ''), value: it.error || it.stale ? null : it.probability, stage: it.stage })) };
    const btc = items.find(it => it.symbol === 'BTCUSDT' && !it.error && !it.stale);
    return { title: 'BTC/USDT', big: btc ? btc.price.toLocaleString('en-US') : '—', lines: [btc ? `${btc.decision} · ${btc.probability}/100` : 'sem leitura válida'] };
  }
  if (s.id === 'trader') {
    if (i === 0) {
      const best = items.filter(it => !it.error && !it.stale).sort((a, b) => b.probability - a.probability)[0];
      return { title: 'MELHOR LEITURA', big: best ? best.symbol.replace('USDT', '') : '—', lines: best ? [`${best.decision}`, `score ${best.probability}/100`] : ['aguardando radar'] };
    }
    if (i === 1) return { title: 'BOT DEMO', big: !bot?.enabled ? 'DESLIGADO' : bot.paused ? 'PAUSADO' : bot.dryRun ? 'DRY-RUN' : 'ATIVO', lines: [`${bot?.positions?.length || 0} posições (local)`] };
    const lastTrade = bot?.closedTrades?.at(-1);
    return { title: 'ÚLTIMO TRADE', big: lastTrade ? money(lastTrade.pnlUsd) : '—', lines: lastTrade ? [`${lastTrade.symbol} ${lastTrade.dir}`] : ['nenhum registrado'] };
  }
  if (s.id === 'ceo') {
    const sum = bot?.summary;
    return { title: 'RELATÓRIO', big: sum?.n ? `${Math.round(sum.winRate * 100)}% acerto` : 'SEM TRADES', lines: sum?.n ? [`${sum.n} trades · ${sum.expectancyR} R`] : ['histórico local vazio'] };
  }
  if (s.id === 'risk') {
    const cfg = bot?.config;
    return i === 0
      ? { title: 'LIMITES', big: cfg ? `${cfg.riskPct}% / trade` : '—', lines: cfg ? [`perda diária ${cfg.dailyLossLimitPct}%`] : [] }
      : { title: 'KILL SWITCH', big: bot?.paused ? 'PAUSADO' : 'LIBERADO', lines: [bot?.enabled ? 'bot habilitado' : 'bot desligado'] };
  }
  if (s.id === 'scientist' && agent?.result?.kind === 'backtest' && i === 1) {
    return { title: 'CURVA (BACKTEST)', curve: agent.result.stats.equityCurve };
  }
  if (s.id === 'scientist' && agent?.result?.kind === 'backtest') {
    const st = agent.result.stats;
    return { title: 'BACKTEST', big: `${st.expectancyR} R`, lines: [`${st.n} trades · ${Math.round(st.winRate * 100)}%`] };
  }
  if (s.id === 'auditor' && i === 0) {
    const errors = (data.events || []).filter(e => e.source === 'bot' && ['error', 'blocked'].includes(e.type)).length;
    return { title: 'AUDITORIA', big: `${errors} alertas`, lines: ['últimos 60 eventos'] };
  }
  return { title: s.role, big: stateText, lines: [agent?.lastRun ? `última: ${new Date(agent.lastRun).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'nenhuma consulta'] };
}

function drawMonitor(screen, content, color) {
  const { ctx, texture } = screen;
  ctx.fillStyle = '#0c1a24';
  ctx.fillRect(0, 0, 320, 192);
  ctx.fillStyle = color;
  ctx.fillRect(14, 16, 4, 18);
  ctx.font = '700 17px sans-serif';
  ctx.fillText(content.title, 26, 31);
  if (content.bars) {
    content.bars.forEach((b, i) => {
      const y = 52 + i * 26;
      ctx.fillStyle = '#9fb2bb';
      ctx.font = '14px monospace';
      ctx.fillText(b.label, 16, y + 12);
      ctx.fillStyle = '#1d3340';
      ctx.fillRect(66, y, 230, 14);
      if (b.value != null) {
        ctx.fillStyle = STAGE_COLOR[b.stage] || STAGE_COLOR.none;
        ctx.fillRect(66, y, 2.3 * b.value, 14);
      }
    });
  } else if (content.curve?.length) {
    const curve = content.curve, lo = Math.min(...curve), hi = Math.max(...curve);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    curve.forEach((v, j) => {
      const x = 16 + (j / (curve.length - 1 || 1)) * 288, y = 170 - ((v - lo) / (hi - lo || 1)) * 110;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.font = '700 32px monospace';
    ctx.fillText(content.big || '', 16, 100, 290);
    ctx.fillStyle = '#87a0aa';
    ctx.font = '15px monospace';
    (content.lines || []).forEach((l, i) => ctx.fillText(l, 16, 138 + i * 22, 290));
  }
  texture.needsUpdate = true;
}

function drawWall(panel, data) {
  const { ctx, texture } = panel;
  const W = 1500, H = 546;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#08130f');
  g.addColorStop(1, '#0c1d17');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#6f8f86';
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  ctx.fillText('PREGÃO · BYBIT DEMO', 48, 56);
  ctx.textAlign = 'right';
  ctx.fillText('registros locais · não reconciliados', W - 48, 56);
  ctx.textAlign = 'left';

  const trades = [...(data?.bot?.closedTrades || [])].sort((a, b) => a.closedAt - b.closedAt);
  const total = trades.reduce((s, t) => s + (Number(t.pnlUsd) || 0), 0);
  ctx.fillStyle = '#d6efe4';
  ctx.font = '700 34px sans-serif';
  ctx.fillText('LUCRO ACUMULADO (DEMO)', 48, 124);
  ctx.fillStyle = !trades.length ? '#8aa39b' : total >= 0 ? '#4ade80' : '#f87171';
  ctx.font = '800 96px sans-serif';
  ctx.fillText(trades.length ? money(total) : 'SEM TRADES', 48, 232);

  // Cumulative PnL curve
  const box = { x: 48, y: 262, w: 820, h: 160 };
  ctx.strokeStyle = '#1e3a30';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  if (trades.length) {
    const pts = [0];
    trades.forEach(t => pts.push(pts.at(-1) + (Number(t.pnlUsd) || 0)));
    const lo = Math.min(...pts), hi = Math.max(...pts);
    ctx.strokeStyle = total >= 0 ? '#e8c35a' : '#f87171';
    ctx.lineWidth = 5;
    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = box.x + 16 + (i / (pts.length - 1)) * (box.w - 32);
      const y = box.y + box.h - 16 - ((v - lo) / (hi - lo || 1)) * (box.h - 32);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  } else {
    ctx.fillStyle = '#58716a';
    ctx.font = '26px sans-serif';
    ctx.fillText('A curva aparece quando o bot demo registrar trades.', box.x + 24, box.y + box.h / 2);
  }

  // Trader mood meter: perigo · alerta · normal · confiante (from the server's mood rule).
  const mood = data?.crew?.trader;
  ctx.fillStyle = '#8fb5a6';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('HUMOR DO LUCAS', 48, 462);
  ['perigo', 'alerta', 'normal', 'confiante'].forEach((m, i) => {
    const x = 290 + i * 145, active = mood?.mood === m;
    ctx.globalAlpha = active ? 1 : 0.28;
    ctx.fillStyle = MOOD_COLOR[m];
    roundRect(ctx, x, 438, 135, 36, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = active ? '#06110d' : '#c9d8d2';
    ctx.font = '800 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.toUpperCase(), x + 67, 462);
    ctx.textAlign = 'left';
  });
  ctx.fillStyle = mood?.cooldown ? '#fca5a5' : '#a9c4b9';
  ctx.font = '22px sans-serif';
  ctx.fillText(mood ? `${mood.reason}${mood.cooldown ? ' · pausa no lounge' : ''}` : '—', 48, 512, 830);

  // Today's scoreboard (same UTC day rule as the mood)
  const wins = mood?.today?.wins ?? 0;
  const losses = mood?.today?.losses ?? 0;
  ctx.fillStyle = '#10241c';
  roundRect(ctx, 920, 96, 532, 150, 18);
  ctx.fill();
  ctx.fillStyle = '#8fb5a6';
  ctx.font = '600 24px "IBM Plex Mono", monospace';
  ctx.fillText('PLACAR DE HOJE', 950, 138);
  ctx.fillStyle = '#e9f5ef';
  ctx.font = '800 72px sans-serif';
  ctx.fillText(`${wins}V · ${losses}D`, 950, 222);

  // Radar ribbon
  ctx.fillStyle = '#8fb5a6';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('RADAR DA ALICE', 920, 290);
  (data?.monitor?.items || []).slice(0, 5).forEach((it, i) => {
    const y = 312 + i * 40;
    const ok = !it.error && !it.stale;
    ctx.fillStyle = ok ? STAGE_COLOR[it.stage] || STAGE_COLOR.none : '#f87171';
    ctx.fillRect(920, y, 10, 28);
    ctx.fillStyle = '#e1eee8';
    ctx.font = '700 24px sans-serif';
    ctx.fillText(it.symbol.replace('USDT', ''), 944, y + 23);
    ctx.fillStyle = '#a9c4b9';
    ctx.font = '22px sans-serif';
    ctx.fillText(ok ? `${it.decision} · ${it.probability}` : 'indisponível', 1050, y + 23, 400);
  });
  texture.needsUpdate = true;
}

function drawBoard(panel, data) {
  const { ctx, texture } = panel;
  const W = 1060, H = 490;
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e8c35a';
  ctx.font = 'italic 700 54px Georgia, serif';
  ctx.fillText('a regra', 36, 66);
  const game = data?.game;
  if (!game) { texture.needsUpdate = true; return; }
  const { ladder, goal, achievements } = game;
  ctx.fillStyle = '#9fb2bb';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${ladder.name.toUpperCase()} · RISCO ${ladder.riskPct}%`, W - 36, 60);
  ctx.textAlign = 'left';
  const dots = (y, label, value, total, color, note) => {
    ctx.fillStyle = '#16221c';
    roundRect(ctx, 36, y, W - 72, 92, 14);
    ctx.fill();
    ctx.fillStyle = '#e9f5ef';
    ctx.font = '800 30px sans-serif';
    ctx.fillText(label, 60, y + 40);
    ctx.fillStyle = '#8fa39b';
    ctx.font = '20px sans-serif';
    ctx.fillText(note, 60, y + 74);
    for (let i = 0; i < total; i++) {
      ctx.beginPath();
      ctx.arc(520 + i * 46, y + 46, 16, 0, Math.PI * 2);
      ctx.fillStyle = i < value ? color : '#24302b';
      ctx.fill();
    }
  };
  dots(96, `${ladder.winsToUp} VITÓRIAS`, ladder.wins, ladder.winsToUp, '#4ade80', '+1 degrau de risco');
  dots(204, `${ladder.lossesToDown} DERROTAS`, ladder.losses, ladder.lossesToDown, '#ef4444', `−1 degrau (ou queda de ${ladder.ddDownPct}%)`);
  // Goal bar
  ctx.fillStyle = '#9fb2bb';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('META DO ESCRITÓRIO (DEMO)', 36, 350);
  ctx.fillStyle = '#1d3340';
  roundRect(ctx, 36, 366, W - 72, 30, 15);
  ctx.fill();
  ctx.fillStyle = goal.reached ? '#e8c35a' : '#4ade80';
  roundRect(ctx, 36, 366, Math.max(30, (W - 72) * goal.pct), 30, 15);
  ctx.fill();
  ctx.fillStyle = '#e9f5ef';
  ctx.font = '700 24px sans-serif';
  ctx.fillText(`US$ ${goal.totalUsd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} / ${goal.targetUsd.toLocaleString('pt-BR')}`, 36, 432);
  const done = achievements.filter(a => a.done).length;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f5dfa0';
  ctx.fillText(`★ ${done}/${achievements.length} conquistas`, W - 36, 432);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6f8793';
  ctx.font = '18px sans-serif';
  ctx.fillText(ladder.appliedToBot ? 'Regra aplicada ao bot demo.' : 'Regra só no placar · bot usa o risco base (BOT_LADDER=0).', 36, 470);
  texture.needsUpdate = true;
}

function drawRisk(panel, data) {
  const { ctx, texture } = panel;
  ctx.fillStyle = '#140f1c';
  ctx.fillRect(0, 0, 920, 460);
  ctx.fillStyle = '#c6a7ef';
  ctx.font = '700 34px sans-serif';
  ctx.fillText('PAINEL DE RISCO', 40, 64);
  const bot = data?.bot, cfg = bot?.config;
  const status = !bot ? '—' : bot.paused ? 'PAUSADO' : bot.enabled ? (bot.dryRun ? 'DRY-RUN' : 'DEMO ATIVO') : 'DESLIGADO';
  ctx.fillStyle = bot?.paused ? '#f87171' : '#4ade80';
  ctx.font = '700 30px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(status, 880, 64);
  ctx.textAlign = 'left';
  const rows = cfg ? [
    ['Risco por trade', `${cfg.riskPct}%`],
    ['Máx. posições', `${cfg.maxOpen}`],
    ['Perda diária (trava)', `${cfg.dailyLossLimitPct}%`],
    ['Teto por posição', `${Math.round(cfg.maxNotionalPct * 100)}% da conta`],
    ['Gate de entrada', `score ≥ ${cfg.minProb}`],
  ] : [['Aguardando dados', '']];
  const mood = data?.crew?.trader;
  ctx.fillStyle = mood?.cooldown ? '#7f1d1d' : '#14532d';
  ctx.fillRect(0, 400, 920, 60);
  ctx.fillStyle = '#fff';
  ctx.font = '800 28px sans-serif';
  ctx.fillText(mood?.cooldown ? `TRAVA ATIVA · ${mood.cooldownReason}` : 'SEM TRAVAS ATIVAS', 40, 440, 840);
  // Última proposta do bot e a decisão do Ricardo (checklist do bot).
  const last = data?.proposals?.[0];
  ctx.font = '700 22px sans-serif';
  ctx.fillStyle = !last ? '#8b7da3' : last.decision === 'approved' ? '#4ade80' : '#f87171';
  ctx.fillText(!last ? 'ÚLTIMA PROPOSTA: nenhuma registrada'
    : `ÚLTIMA PROPOSTA: ${last.symbol?.replace('USDT', '')} ${last.dir || ''} · ${last.decision === 'approved' ? 'APROVADA' : `BARRADA · ${last.reason || ''}`}`, 40, 388, 840);
  rows.forEach(([k, v], i) => {
    const y = 120 + i * 56;
    ctx.fillStyle = '#251c33';
    ctx.fillRect(40, y - 38, 840, 52);
    ctx.fillStyle = '#b8a9cf';
    ctx.font = '26px sans-serif';
    ctx.fillText(k, 60, y);
    ctx.fillStyle = '#f1eaff';
    ctx.font = '700 28px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(v, 860, y);
    ctx.textAlign = 'left';
  });
  texture.needsUpdate = true;
}
