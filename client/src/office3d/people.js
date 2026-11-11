// Blocky, articulated characters (and Max, the office dog).
// Each character faces +Z in its own frame. Poses are set every frame by `pose()`.
import * as THREE from 'three';
import { textSprite } from './voxel.js';

export const LOOKS = {
  ceo: { skin: '#e9b98f', hair: '#2a2120', hairStyle: 'swept', jacket: '#1f2f5c', shirt: '#f4f4f0', tie: '#d9a441', pants: '#1f2a4a', shoes: '#1a1a1e', glasses: '#1b1b1f' },
  analyst: { skin: '#f3c9a6', hair: '#a4472c', hairStyle: 'bob', jacket: '#7fd3c8', shirt: '#7fd3c8', pants: '#f3c9a6', skirt: '#24305a', shoes: '#22263a', glasses: '#3a2a26' },
  risk: { skin: '#e2b08a', hair: '#cfcfd3', hairStyle: 'swept', jacket: '#3b3f46', shirt: '#b9a3d9', tie: '#5a4a7a', pants: '#33363c', shoes: '#18181b', glasses: '#7a7a80' },
  trader: { skin: '#c98d63', hair: '#1e1714', hairStyle: 'spiky', jacket: '#1d2a44', shirt: '#e9785e', pants: '#2b2f36', shoes: '#f2f2f2' },
  scientist: { skin: '#e7b48e', hair: '#3b2418', hairStyle: 'long', jacket: '#f1f1ee', shirt: '#a9c9ec', pants: '#2a2e38', shoes: '#2a2224' },
  auditor: { skin: '#f0c29b', hair: '#6b4428', hairStyle: 'short', jacket: '#22355e', shirt: '#b9cfa4', tie: '#3f5a3a', pants: '#22355e', shoes: '#1a1a1e', glasses: '#1b1b1f', roundGlasses: true },
};

const HIP_STAND = 0.97;
const HIP_SIT = 0.6;

export function buildCharacter(kit, look) {
  const { box, group } = kit;
  const root = new THREE.Group();
  const hips = group(root, [0, HIP_STAND, 0]);

  const legs = [-1, 1].map(side => {
    const hip = group(hips, [side * 0.19, 0, 0]);
    box(hip, [0.32, 0.45, 0.34], [0, -0.225, 0], look.pants);
    const knee = group(hip, [0, -0.45, 0]);
    box(knee, [0.3, 0.42, 0.32], [0, -0.21, 0], look.pants);
    box(knee, [0.33, 0.1, 0.46], [0, -0.47, 0.06], look.shoes);
    return { hip, knee };
  });
  if (look.skirt) box(hips, [0.84, 0.42, 0.5], [0, -0.12, 0], look.skirt);

  const torso = group(hips, [0, 0, 0]);
  box(torso, [0.8, 0.86, 0.46], [0, 0.43, 0], look.jacket);
  box(torso, [0.28, 0.66, 0.02], [0, 0.5, 0.235], look.shirt);
  if (look.tie) box(torso, [0.09, 0.5, 0.02], [0, 0.5, 0.25], look.tie);

  const arms = [-1, 1].map(side => {
    const shoulder = group(torso, [side * 0.52, 0.78, 0]);
    box(shoulder, [0.24, 0.72, 0.3], [0, -0.33, 0], look.jacket);
    box(shoulder, [0.22, 0.2, 0.24], [0, -0.76, 0], look.skin);
    return shoulder;
  });

  // Game controller, only visible while playing in the lounge.
  const controller = box(torso, [0.46, 0.1, 0.22], [0, 0.36, 0.64], '#22252c');
  box(controller, [0.08, 0.04, 0.06], [-0.12, 0.06, 0.04], '#d4453b', {}, { shadow: false });
  box(controller, [0.08, 0.04, 0.06], [0.12, 0.06, 0.04], '#3e6db3', {}, { shadow: false });
  controller.visible = false;

  const neck = group(torso, [0, 0.86, 0]);
  const head = group(neck, [0, 0, 0]);
  box(head, [0.82, 0.76, 0.74], [0, 0.4, 0], look.skin);
  // Face
  for (const x of [-0.17, 0.17]) box(head, [0.11, 0.15, 0.02], [x, 0.43, 0.375], '#20160f', {}, { shadow: false });
  box(head, [0.2, 0.05, 0.02], [0, 0.24, 0.375], '#9a5a48', {}, { shadow: false });
  if (look.glasses) {
    for (const x of [-0.17, 0.17]) {
      const w = look.roundGlasses ? 0.27 : 0.25;
      box(head, [w, 0.035, 0.03], [x, 0.53, 0.39], look.glasses, {}, { shadow: false });
      box(head, [w, 0.035, 0.03], [x, 0.33, 0.39], look.glasses, {}, { shadow: false });
      box(head, [0.035, 0.2, 0.03], [x - w / 2, 0.43, 0.39], look.glasses, {}, { shadow: false });
      box(head, [0.035, 0.2, 0.03], [x + w / 2, 0.43, 0.39], look.glasses, {}, { shadow: false });
    }
    box(head, [0.09, 0.03, 0.03], [0, 0.48, 0.39], look.glasses, {}, { shadow: false });
  }
  addHair(kit, head, look);

  return { root, hips, torso, arms, legs, neck, head, controller, look, phase: Math.random() * 10 };
}

function addHair(kit, head, { hair, hairStyle }) {
  const { box } = kit;
  box(head, [0.88, 0.2, 0.8], [0, 0.85, -0.01], hair);
  if (hairStyle !== 'spiky') box(head, [0.88, 0.5, 0.14], [0, 0.6, -0.37], hair);
  if (hairStyle === 'swept') {
    const fringe = box(head, [0.88, 0.12, 0.26], [0, 0.76, 0.3], hair);
    fringe.rotation.x = -0.25;
    for (const x of [-0.44, 0.44]) box(head, [0.06, 0.28, 0.5], [x, 0.66, -0.08], hair);
  }
  if (hairStyle === 'short') {
    for (const x of [-0.44, 0.44]) box(head, [0.06, 0.22, 0.46], [x, 0.7, -0.1], hair);
  }
  if (hairStyle === 'bob') {
    for (const x of [-0.46, 0.46]) box(head, [0.12, 0.66, 0.78], [x, 0.5, -0.02], hair);
    box(head, [0.92, 0.72, 0.16], [0, 0.46, -0.38], hair);
    box(head, [0.62, 0.12, 0.08], [0.1, 0.75, 0.38], hair);
  }
  if (hairStyle === 'long') {
    for (const x of [-0.46, 0.46]) box(head, [0.12, 0.95, 0.6], [x, 0.38, -0.1], hair);
    box(head, [0.92, 1.25, 0.16], [0, 0.22, -0.38], hair);
    box(head, [0.88, 0.1, 0.12], [0, 0.78, 0.36], hair);
  }
  if (hairStyle === 'spiky') {
    box(head, [0.88, 0.45, 0.14], [0, 0.65, -0.37], hair);
    const spikes = [[-0.28, 0.25], [0, 0.32], [0.28, 0.22], [-0.14, -0.1], [0.16, -0.12], [0, 0.05]];
    for (const [x, z] of spikes) {
      const s = box(head, [0.2, 0.26, 0.2], [x, 1.02, z], hair);
      s.rotation.set(0.35 * Math.sign(z || 1), 0.6, 0.25 * Math.sign(x || 1));
    }
  }
}

// state: 'working' | 'monitoring' | 'idle' | 'sleeping' | 'error' | 'walking' | 'gaming'
export function pose(c, state, t, motion) {
  const m = motion ? 1 : 0;
  const ph = c.phase;
  const seated = state !== 'walking';
  c.controller.visible = state === 'gaming';
  c.hips.position.y = seated ? HIP_SIT : HIP_STAND + Math.abs(Math.sin(t * 8)) * 0.04 * m;
  c.torso.rotation.set(0, 0, 0);
  c.head.rotation.set(0, 0, 0);
  for (const { hip, knee } of c.legs) {
    hip.rotation.x = seated ? -Math.PI / 2 : 0;
    knee.rotation.x = seated ? Math.PI / 2 : 0;
  }
  const [left, right] = c.arms;
  left.rotation.set(0, 0, 0);
  right.rotation.set(0, 0, 0);

  if (state === 'walking') {
    const s = Math.sin(t * 8) * 0.55 * m;
    c.legs[0].hip.rotation.x = s;
    c.legs[1].hip.rotation.x = -s;
    left.rotation.x = -s;
    right.rotation.x = s;
    return;
  }
  if (state === 'working' || state === 'monitoring') {
    const speed = state === 'working' ? 22 : 9;
    const amp = (state === 'working' ? 0.13 : 0.07) * m;
    left.rotation.x = -1.25 + Math.sin(t * speed + ph) * amp;
    right.rotation.x = -1.25 + Math.sin(t * speed + ph + Math.PI) * amp;
    c.torso.rotation.x = 0.08;
    c.head.rotation.y = state === 'monitoring' ? Math.sin(t * 0.7 + ph) * 0.35 * m : 0;
    c.head.rotation.x = 0.05;
    return;
  }
  if (state === 'gaming') {
    const jitter = Math.sin(t * 17 + ph) * 0.05 * m;
    left.rotation.x = -1.0 + jitter;
    right.rotation.x = -1.0 - jitter;
    left.rotation.z = 0.32;
    right.rotation.z = -0.32;
    c.torso.rotation.x = -0.12 + Math.sin(t * 2.2) * 0.04 * m;
    c.head.rotation.x = 0.12;
    c.head.rotation.z = Math.sin(t * 1.3 + ph) * 0.08 * m;
    return;
  }
  if (state === 'sleeping') {
    c.torso.rotation.x = 0.7 + Math.sin(t * 1.4) * 0.02 * m;
    c.head.rotation.x = 0.45;
    c.head.rotation.z = 0.2;
    left.rotation.x = -1.65;
    right.rotation.x = -1.65;
    left.rotation.z = -0.35;
    right.rotation.z = 0.35;
    return;
  }
  if (state === 'error') {
    right.rotation.x = -2.7;
    right.rotation.z = 0.5;
    left.rotation.x = -1.1;
    c.head.rotation.z = Math.sin(t * 3 + ph) * 0.08 * m;
    c.head.rotation.x = -0.1;
    return;
  }
  // idle: relaxed, breathing, glancing around
  left.rotation.x = -0.65;
  right.rotation.x = -0.65;
  c.torso.rotation.x = -0.06 + Math.sin(t * 1.6 + ph) * 0.015 * m;
  c.head.rotation.y = Math.sin(t * 0.35 + ph) * 0.3 * m;
}

export function buildDog(kit) {
  const { box, group } = kit;
  const fur = '#e9c98c', dark = '#c99a5b', light = '#f6e3bd';
  const root = new THREE.Group();
  const body = group(root, [0, 0, 0]);
  box(body, [0.55, 0.48, 1.0], [0, 0.62, 0], fur);
  box(body, [0.58, 0.08, 0.12], [0, 0.9, 0.42], '#d4453b'); // collar
  const head = group(body, [0, 0.95, 0.5]);
  box(head, [0.56, 0.52, 0.5], [0, 0.05, 0.05], fur);
  box(head, [0.3, 0.22, 0.24], [0, -0.06, 0.38], light);
  box(head, [0.12, 0.08, 0.06], [0, 0.02, 0.51], '#2a1c14');
  for (const x of [-0.14, 0.14]) box(head, [0.08, 0.1, 0.03], [x, 0.14, 0.31], '#1e140f', {}, { shadow: false });
  const ears = [-1, 1].map(side => {
    const ear = group(head, [side * 0.3, 0.22, 0.02]);
    box(ear, [0.12, 0.34, 0.24], [0, -0.14, 0], dark);
    return ear;
  });
  const legs = [[-0.17, 0.32], [0.17, 0.32], [-0.17, -0.32], [0.17, -0.32]].map(([x, z]) => {
    const leg = group(body, [x, 0.45, z]);
    box(leg, [0.16, 0.45, 0.16], [0, -0.22, 0], fur);
    return leg;
  });
  const tail = group(body, [0, 0.78, -0.5]);
  box(tail, [0.11, 0.11, 0.42], [0, 0, -0.2], fur);
  tail.rotation.x = 0.7;
  const label = textSprite('Max 🐾', { w: 300, h: 110, font: '700 52px sans-serif', scale: 0.9 });
  label.position.set(0, 1.85, 0);
  root.add(label);
  return { root, body, head, ears, legs, tail, label };
}

// Max wanders between waypoints, pausing to sit and look around.
// step.guard([x,0,z] | null): walk to that spot via the aisle and stay there (e.g. guarding a locked desk).
export function createDogWalker(dog, waypoints, { guardApproach = null } = {}) {
  let route = waypoints.map(p => new THREE.Vector3(...p));
  let index = 0, pause = 1.5, guarding = null;
  const pos = route[0].clone();
  dog.root.position.copy(pos);
  const nearest = () => route.reduce((best, p, i) => (p.distanceTo(pos) < route[best].distanceTo(pos) ? i : best), 0);
  const current = () => (guarding ? guarding[Math.min(index, guarding.length - 1)] : route[index]);
  function step(dt, t, motion) {
    if (motion && pause > 0) pause -= dt;
    // Arrival is checked every frame (not only while walking), so a dog that starts on a node still sets off.
    if (pos.distanceTo(current()) < 0.06 && pause <= 0) {
      if (guarding) index = Math.min(index + 1, guarding.length - 1);
      else {
        index = (index + 1) % route.length;
        pause = 1.5 + ((index * 7919) % 30) / 10;
      }
    }
    const target = current();
    const toTarget = target.clone().sub(pos);
    const parked = guarding && index >= guarding.length - 1 && toTarget.length() < 0.06;
    const walking = motion && !parked && pause <= 0 && toTarget.length() > 0.05;
    if (walking) {
      const stepLen = Math.min(toTarget.length(), dt * (guarding ? 2.2 : 1.5));
      pos.add(toTarget.clone().normalize().multiplyScalar(stepLen));
      const yaw = Math.atan2(toTarget.x, toTarget.z);
      dog.root.rotation.y += shortest(yaw - dog.root.rotation.y) * Math.min(1, dt * 8);
    }
    if (parked) dog.root.rotation.y += shortest(Math.PI - dog.root.rotation.y) * Math.min(1, dt * 4);
    dog.root.position.copy(pos);
    const swing = walking ? Math.sin(t * 11) * 0.6 : 0;
    dog.legs.forEach((leg, i) => { leg.rotation.x = i === 0 || i === 3 ? swing : -swing; });
    dog.body.position.y = walking ? Math.abs(Math.sin(t * 11)) * 0.04 : 0;
    dog.tail.rotation.y = motion ? Math.sin(t * (walking || parked ? 14 : 7)) * 0.6 : 0;
    dog.head.rotation.y = !walking && motion ? Math.sin(t * 0.8) * 0.5 : 0;
    dog.ears.forEach(ear => { ear.rotation.z = walking ? Math.sin(t * 11) * 0.15 : 0; });
    dog.label.position.y = 1.85 + (motion ? Math.sin(t * 2) * 0.04 : 0);
    return pos;
  }
  step.guard = point => {
    const key = point ? point.join(',') : null;
    if (key === (guarding?.key ?? null)) return;
    if (point) {
      guarding = [route[nearest()].clone(), ...(guardApproach ? [new THREE.Vector3(...guardApproach)] : []), new THREE.Vector3(...point)];
      guarding.key = key;
      index = 0;
      pause = 0;
    } else {
      guarding = null;
      index = nearest();
      pause = 0.5;
    }
  };
  return step;
}

function shortest(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
