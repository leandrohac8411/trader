// Low-poly / voxel building blocks shared by the office scene.
// Everything is procedural boxes: no external models or textures.
import * as THREE from 'three';

export function createKit() {
  const materials = new Map();
  const geometries = new Map();
  function material(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...opts }));
    return materials.get(key);
  }
  function geometry(w, h, d) {
    const key = `${w}|${h}|${d}`;
    if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
    return geometries.get(key);
  }
  function box(parent, [w, h, d], [x, y, z], color, opts = {}, { shadow = true } = {}) {
    const mesh = new THREE.Mesh(geometry(w, h, d), typeof color === 'string' ? material(color, opts) : color);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    parent.add(mesh);
    return mesh;
  }
  function group(parent, [x, y, z] = [0, 0, 0], ry = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    parent.add(g);
    return g;
  }
  return { material, geometry, box, group };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasPanel(parent, w, h, [x, y, z], canvas, ry = 0) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return { canvas, texture, mesh, ctx: canvas.getContext('2d') };
}

export function textSprite(text, { color = '#1b2430', bg = '#fff6df', font = '700 54px sans-serif', w = 320, h = 120, scale = 1 } = {}) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, w - 12, h - 12, 26);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set((w / h) * 0.55 * scale, 0.55 * scale, 1);
  return sprite;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Deterministic PRNG so the city looks the same on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
