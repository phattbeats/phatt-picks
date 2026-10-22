/**
 * The coin inspector's WebGL scene. It builds the coin from the same relief as
 * the Blender renders (scripts/coins/): each face is a dense polar mesh
 * displaced by the struck height field, shaded with a 2048px normal map and a
 * tier PBR material (mirror field, satin relief, glossy enamel, cavity patina).
 * Edges are reeded and diamond carries two cut stones. It's lit by a dark
 * studio of softbox panels (like the render rig), so the metal throws hard
 * reflections that slide across it as you turn it.
 *
 * The reverse carries the holder's name, struck at load time into the shared
 * back maps (engrave) with the same bevel and heights build-coin-maps.py uses,
 * so it reads as part of the die rather than a label on top.
 *
 * Loaded on demand by CoinInspector (dynamic import), so three.js only ships to
 * people who open a coin. Geometry constants mirror render-coin.py.
 */

import * as THREE from "three";
import type { CoinTier } from "@/lib/challenge-coin-core";

const R = 1.0; // coin radius
const T = 0.15; // body thickness, excluding relief
const RELIEF = 0.034; // height 1.0 → world units
const RIM_LIP_H = 0.38; // relief height at the very edge (build-coin-maps.py)
const REEDS = 192;
const GEM_RING = 0.7935;
const GEM_R = 0.05;
// Relief levels and the inner field edge, from build-coin-maps.py.
const H_RELIEF = 0.86;
const R_FIELD = 0.695;
const COIN_FONT = '"Big Shoulders Display", Impact, sans-serif';

/** Tier palettes, linear RGB (render-coin.py TIERS). */
const TIERS: Record<CoinTier, { metal: [number, number, number]; frost: number; enamel: [number, number, number]; patina: number }> = {
  diamond: { metal: [0.86, 0.89, 0.93], frost: 0.8, enamel: [0.01, 0.05, 0.17], patina: 0.25 },
  gold: { metal: [1.0, 0.6, 0.2], frost: 0.78, enamel: [0.0045, 0.0042, 0.004], patina: 0.3 },
  silver: { metal: [0.93, 0.93, 0.92], frost: 0.7, enamel: [0.0045, 0.0045, 0.005], patina: 0.45 },
  bronze: { metal: [0.74, 0.4, 0.2], frost: 0.62, enamel: [0.042, 0.004, 0.003], patina: 0.6 },
};

export interface CoinSceneOptions {
  canvas: HTMLCanvasElement;
  tier: CoinTier;
  /** Map prefixes under /public, e.g. "/coins/3d/iem-cologne-2026-gold" (adds -h/-n/-s.webp). */
  front: string;
  back: string;
  /** Struck into the reverse below the CS2 mark; omit for an unnamed coin. */
  inscription?: { name: string; line?: string | null } | null;
  reducedMotion: boolean;
}

export interface CoinScene {
  ready: Promise<void>;
  resize(px: number): void;
  /** Drag deltas in CSS px. */
  drag(dx: number, dy: number): void;
  release(): void;
  /** Coin toss: up, over, and it lands on the other face. */
  flip(): void;
  /** A hard spin about the vertical axis that winds down. */
  spin(): void;
  /** Multiply the camera distance (<1 zooms in). */
  zoom(factor: number): void;
  reset(): void;
  /** Pointer position over the canvas, -1..1, so the key light follows the hand. */
  aim(x: number, y: number): void;
  dispose(): void;
}

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`coin map failed: ${src}`));
    img.src = src;
  });
}

/** A dense polar disc facing +Z with planar UVs (u = x, v = y), like the render's relief mesh. */
function polarDisc(rings: number, segs: number): THREE.BufferGeometry {
  const count = 1 + rings * segs;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const nor = new Float32Array(count * 3);
  uv[0] = 0.5;
  uv[1] = 0.5;
  for (let i = 0; i < count; i++) nor[i * 3 + 2] = 1;
  let v = 1;
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * R;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = rr * Math.cos(a);
      const y = rr * Math.sin(a);
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      uv[v * 2] = 0.5 + 0.5 * x;
      uv[v * 2 + 1] = 0.5 + 0.5 * y;
      v++;
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs;
    const b0 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, b0 + s, b0 + s1, a0 + s, b0 + s1, a0 + s1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0);
  return c;
}

/** Separable gaussian blur of a w×h float field, in place. */
function blur(a: Float32Array, w: number, h: number, sigma: number) {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
      a[y * w + x] = v;
    }
}

/**
 * Where to wrap a long name: the separator (space, _, -, .) or case/digit
 * change nearest the middle, else the middle itself. Null when it's too short
 * to be worth wrapping.
 */
function splitName(name: string): [string, string] | null {
  const chars = [...name];
  if (chars.length < 12) return null;
  let best = -1;
  for (let i = 2; i < chars.length - 2; i++) {
    const prev = chars[i - 1];
    const cur = chars[i];
    const sep = /[\s_\-.]/.test(prev);
    const shift = (/[a-z]/.test(prev) && /[A-Z]/.test(cur)) || (/[A-Za-z]/.test(prev) && /\d/.test(cur));
    if ((sep || shift) && (best < 0 || Math.abs(i - chars.length / 2) < Math.abs(best - chars.length / 2))) best = i;
  }
  if (best < 0 || Math.abs(best - chars.length / 2) > chars.length / 4) best = Math.ceil(chars.length / 2);
  const a = chars.slice(0, best).join("").trim();
  const b = chars.slice(best).join("").trim();
  return a && b ? [a, b] : null;
}

/**
 * Strike the holder's name into the reverse's field, under the CS2 mark:
 * a small "STRUCK FOR", the name, and the finish beneath. The letters are
 * raised to the same height as the rest of the die lettering, with the same
 * rounded shoulder, polished against the frosted field. Edits the three back
 * maps (as canvases) in place, only inside the band the lettering occupies.
 */
function engrave(
  height: HTMLCanvasElement,
  normal: HTMLCanvasElement,
  surf: HTMLCanvasElement,
  text: { name: string; line?: string | null },
) {
  const N = height.width;
  const px = (u: number) => (u * N) / 2; // coin units → pixels
  // The band below the wordmark, inside the bead ring.
  const top = Math.round(px(1 + 0.27));
  const bot = Math.round(px(1 + 0.64));
  const left = Math.round(px(1 - 0.62));
  const W = Math.round(px(1 + 0.62)) - left;
  const H = bot - top;

  const mask = document.createElement("canvas");
  mask.width = W;
  mask.height = H;
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";

  ctx.font = `800 100px ${COIN_FONT}`;
  const emPerCap = 100 / (ctx.measureText("H").actualBoundingBoxAscent || 70);
  const widthAt = (str: string, capR: number, tracking: number) => {
    const size = px(capR) * emPerCap;
    ctx.font = `800 ${size}px ${COIN_FONT}`;
    return [...str].reduce((w, ch) => w + ctx.measureText(ch).width + tracking * size, -tracking * size);
  };
  // Widest the field allows at a line's lower edge.
  const maxWAt = (cy: number, cap: number) => {
    const yLow = Math.abs(cy) + cap / 2;
    return px(2 * Math.sqrt(Math.max(0, (R_FIELD - 0.05) ** 2 - yLow * yLow)));
  };

  // One line centred on x = 0 with its cap centred on coin y = `cy`
  // (negative = below centre), shrinking then condensing to fit the field.
  const line = (str: string, cy: number, cap: number, minCap: number, tracking: number) => {
    const s = str.toLocaleUpperCase();
    const maxW = maxWAt(cy, cap);
    let c = cap;
    while (c > minCap && widthAt(s, c, tracking) > maxW) c *= 0.96;
    const w = widthAt(s, c, tracking);
    const squeeze = Math.min(1, maxW / w);
    const size = px(c) * emPerCap;
    ctx.font = `800 ${size}px ${COIN_FONT}`;
    ctx.save();
    ctx.translate(px(1) - left, px(1 - cy) + px(c) / 2 - top);
    ctx.scale(squeeze, 1);
    let x = -w / 2;
    for (const ch of s) {
      ctx.fillText(ch, x, 0);
      x += ctx.measureText(ch).width + tracking * size;
    }
    ctx.restore();
  };

  const name = text.name.trim();
  const hasLine = !!text.line;
  const nameCy = hasLine ? -0.43 : -0.45;
  const split = splitName(name);
  line("Struck for", -0.315, 0.044, 0.044, 0.3);
  // A name too long to stay legible on one line wraps at its natural break.
  if (split && widthAt(name.toLocaleUpperCase(), 0.08, 0.05) > maxWAt(nameCy, 0.08)) {
    line(split[0], -0.395, 0.08, 0.045, 0.05);
    line(split[1], -0.49, 0.08, 0.045, 0.05);
    if (hasLine) line(text.line!, -0.575, 0.04, 0.034, 0.3);
  } else {
    line(name, nameCy, 0.13, 0.05, 0.05);
    if (hasLine) line(text.line!, -0.56, 0.044, 0.036, 0.3);
  }

  // Bevel exactly like build-coin-maps.py: blur, steepen, smoothstep.
  const m = ctx.getImageData(0, 0, W, H).data;
  const bev = new Float32Array(W * H);
  for (let i = 0; i < bev.length; i++) bev[i] = m[i * 4] / 255;
  blur(bev, W, H, 1.6);
  for (let i = 0; i < bev.length; i++) {
    const b = Math.min(1, Math.max(0, (bev[i] - 0.5) * 1.35 + 0.5));
    bev[i] = b * b * (3 - 2 * b);
  }

  const hctx = height.getContext("2d", { willReadFrequently: true })!;
  const nctx = normal.getContext("2d", { willReadFrequently: true })!;
  const sctx = surf.getContext("2d", { willReadFrequently: true })!;
  const hd = hctx.getImageData(left, top, W, H);
  const nd = nctx.getImageData(left, top, W, H);
  const sd = sctx.getImageData(left, top, W, H);

  const hf = new Float32Array(W * H);
  for (let i = 0; i < hf.length; i++) {
    const base = hd.data[i * 4] / 255;
    hf[i] = base + (H_RELIEF - base) * bev[i];
    const v = Math.round(hf[i] * 255);
    hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = v;
  }
  // Normals from the float height (build-inspect-maps.py: slope × RELIEF·N/2).
  const k = (RELIEF * N) / 2;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (bev[i - 1] + bev[i + 1] + bev[i - W] + bev[i + W] + bev[i] < 1e-3) continue;
      const dx = (hf[i + 1] - hf[i - 1]) / 2;
      const dyImg = (hf[i + W] - hf[i - W]) / 2;
      const nx = -dx * k;
      const ny = dyImg * k;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nd.data[i * 4] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      nd.data[i * 4 + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      nd.data[i * 4 + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    }
  // Polished letters on the frosted field.
  for (let i = 0; i < bev.length; i++) {
    if (bev[i] < 1e-3) continue;
    const p = sd.data[i * 4] / 255;
    const e = sd.data[i * 4 + 1] / 255;
    const polish = Math.max(p, bev[i]);
    sd.data[i * 4] = Math.round(polish * 255);
    sd.data[i * 4 + 2] = Math.round(Math.max(0, 1 - polish - e) * 255);
  }
  hctx.putImageData(hd, left, top);
  nctx.putImageData(nd, left, top);
  sctx.putImageData(sd, left, top);
}

/**
 * Turn a face's surface mask (R polish, G enamel, B frosted, A cavity) into the
 * tier's albedo, roughness/metalness and clearcoat maps.
 */
function surfaceTextures(read: HTMLCanvasElement, tier: CoinTier) {
  const w = read.width;
  const h = read.height;
  const src = read.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  const mk = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    return { c, ctx, img: ctx.createImageData(w, h) };
  };
  const albedo = mk();
  const orm = mk();
  const coat = mk();
  const t = TIERS[tier];
  const glitter = tier === "diamond";
  // Small deterministic hash so the glitter is fixed, not shimmering per load.
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const a = albedo.img.data;
  const o = orm.img.data;
  const k = coat.img.data;
  for (let i = 0; i < src.length; i += 4) {
    const polish = src[i] / 255;
    let enamel = src[i + 1] / 255;
    const frosted = src[i + 2] / 255;
    const cavity = src[i + 3] / 255;
    const metalW = polish + frosted;
    const tint = polish + frosted * t.frost;
    const shade = 1 - t.patina * (1 - cavity);
    let er = t.enamel[0];
    let eg = t.enamel[1];
    let eb = t.enamel[2];
    let flake = 0;
    if (glitter && enamel > 0.5 && rnd() < 0.08) {
      // Metallic flakes suspended in the sapphire enamel.
      flake = 1;
      er = 0.35;
      eg = 0.55;
      eb = 1.0;
      enamel = 0.5;
    }
    const lr = (t.metal[0] * tint + er * enamel) * shade;
    const lg = (t.metal[1] * tint + eg * enamel) * shade;
    const lb = (t.metal[2] * tint + eb * enamel) * shade;
    a[i] = Math.round(toSrgb(Math.min(1, lr)) * 255);
    a[i + 1] = Math.round(toSrgb(Math.min(1, lg)) * 255);
    a[i + 2] = Math.round(toSrgb(Math.min(1, lb)) * 255);
    a[i + 3] = 255;
    // three reads roughness from G and metalness from B.
    const rough = polish * 0.05 + frosted * 0.26 + enamel * 0.1 + flake * 0.12 + (1 - cavity) * 0.1;
    const metal = Math.min(1, metalW + flake);
    o[i] = 255;
    o[i + 1] = Math.round(Math.min(1, rough) * 255);
    o[i + 2] = Math.round(metal * 255);
    o[i + 3] = 255;
    const c = Math.round(enamel * 255);
    k[i] = c;
    k[i + 1] = c;
    k[i + 2] = c;
    k[i + 3] = 255;
  }
  albedo.ctx.putImageData(albedo.img, 0, 0);
  orm.ctx.putImageData(orm.img, 0, 0);
  coat.ctx.putImageData(coat.img, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.anisotropy = 8;
    return tx;
  };
  return { map: tex(albedo.c, true), orm: tex(orm.c, false), coat: tex(coat.c, false) };
}

/** A tileable normal map of flat-topped reeds for the milled edge. */
function reedNormalTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 8;
  const PER = 8; // reeds per tile
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const ph = (x / W) * PER * Math.PI * 2;
    // Slope of a flat-topped reed profile (clip(cos*1.6)).
    const slope = Math.abs(Math.cos(ph)) * 1.6 > 1 ? 0 : -Math.sin(ph) * 0.9;
    const len = Math.hypot(slope, 1);
    const nx = slope / len;
    const nz = 1 / len;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = 128;
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(REEDS / PER, 1);
  return t;
}

/** A round brilliant: table, crown, girdle, pavilion, faceted. */
function gemGeometry(): THREE.BufferGeometry {
  const r = GEM_R;
  const profile = [
    new THREE.Vector2(0.0001, r * 0.62),
    new THREE.Vector2(r * 0.55, r * 0.62),
    new THREE.Vector2(r, r * 0.18),
    new THREE.Vector2(r, r * 0.08),
    new THREE.Vector2(0.0001, -r * 0.86),
  ];
  const g = new THREE.LatheGeometry(profile, 16);
  g.rotateX(Math.PI / 2);
  return g.toNonIndexed();
}

/**
 * A dark studio with emissive softboxes, baked to an environment map. Metal
 * only looks like metal when it has bright things and dark things to reflect;
 * an evenly lit room makes it read as grey plastic.
 */
function studioScene(): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  const owned: { dispose(): void }[] = [];
  const roomGeo = new THREE.BoxGeometry(20, 20, 20);
  const roomMat = new THREE.MeshBasicMaterial({ color: 0x07070a, side: THREE.BackSide });
  scene.add(new THREE.Mesh(roomGeo, roomMat));
  owned.push(roomGeo, roomMat);
  const panel = (w: number, h: number, pos: [number, number, number], strength: number, tint = 0xffffff) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(strength), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    owned.push(g, m);
  };
  panel(9, 5, [0, 8, 3], 7); // overhead key softbox
  panel(2.2, 9, [-8, 1, 4], 5); // left strip
  panel(2.2, 9, [8, 0, 3], 3.2, 0xffe2b8); // warm right strip
  panel(7, 2.5, [0, -7, 5], 1.4); // floor bounce
  panel(3, 3, [5, 5, 8], 2.2); // front fill, off-axis so a head-on view never mirrors it whole
  panel(1.2, 6, [-3, 6, -8], 2.5, 0xcfe0ff); // cool back rim
  return { scene, dispose: () => owned.forEach((o) => o.dispose()) };
}

export function createCoinScene(opts: CoinSceneOptions): CoinScene {
  const { canvas, tier, reducedMotion } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = studioScene();
  const envTex = pmrem.fromScene(room.scene, 0.02).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  const BASE_DIST = 4.6;
  let dist = BASE_DIST;
  camera.position.set(0, 0, dist);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.2, 2.6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe8c8, 0.9);
  rim.position.set(-3, -1.5, -2.5);
  scene.add(rim);

  const coin = new THREE.Group();
  const holder = new THREE.Group(); // toss height lives here, rotation on `coin`
  holder.add(coin);
  scene.add(holder);

  const disposables: { dispose(): void }[] = [envTex, pmrem];
  const metalLinear = new THREE.Color().setRGB(...TIERS[tier].metal, THREE.LinearSRGBColorSpace);

  // Reeded edge wall spanning both rim lips.
  const wallH = T + 2 * RIM_LIP_H * RELIEF;
  const wallGeo = new THREE.CylinderGeometry(R, R, wallH, 768, 1, true);
  wallGeo.rotateX(Math.PI / 2);
  const reed = reedNormalTexture();
  const wallMat = new THREE.MeshPhysicalMaterial({
    color: metalLinear,
    metalness: 1,
    roughness: 0.14,
    normalMap: reed,
    normalScale: new THREE.Vector2(1.2, 1.2),
  });
  coin.add(new THREE.Mesh(wallGeo, wallMat));
  disposables.push(wallGeo, wallMat, reed);

  const rings = 320;
  const segs = 640;
  const discGeo = polarDisc(rings, segs);
  disposables.push(discGeo);

  async function face(prefix: string, side: 1 | -1, inscription?: CoinSceneOptions["inscription"]) {
    const [hImg, nImg, sImg] = await Promise.all([
      loadImage(`${prefix}-h.webp`),
      loadImage(`${prefix}-n.webp`),
      loadImage(`${prefix}-s.webp`),
      inscription ? document.fonts?.load(`800 100px ${COIN_FONT}`).catch(() => null) : null,
    ]);
    const hCan = toCanvas(hImg);
    const nCan = toCanvas(nImg);
    const sCan = toCanvas(sImg);
    if (inscription?.name.trim()) engrave(hCan, nCan, sCan, inscription);
    const height = new THREE.CanvasTexture(hCan);
    const normal = new THREE.CanvasTexture(nCan);
    height.colorSpace = THREE.NoColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    normal.anisotropy = 8;
    const { map, orm, coat } = surfaceTextures(sCan, tier);
    const mat = new THREE.MeshPhysicalMaterial({
      map,
      roughnessMap: orm,
      metalnessMap: orm,
      roughness: 1,
      metalness: 1,
      normalMap: normal,
      normalScale: new THREE.Vector2(1, 1),
      displacementMap: height,
      displacementScale: RELIEF,
      clearcoat: 1,
      clearcoatMap: coat,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.25,
    });
    const mesh = new THREE.Mesh(discGeo, mat);
    mesh.position.z = side * (T / 2);
    if (side === -1) mesh.rotation.y = Math.PI;
    coin.add(mesh);
    disposables.push(height, normal, map, orm, coat, mat);
    return mesh;
  }

  if (tier === "diamond") {
    const gemGeo = gemGeometry();
    const gemMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0,
      transmission: 1,
      thickness: 0.06,
      ior: 2.42,
      dispersion: 6,
      envMapIntensity: 2.4,
      flatShading: true,
    });
    for (const side of [1, -1] as const) {
      for (const ang of [0, Math.PI]) {
        const g = new THREE.Mesh(gemGeo, gemMat);
        g.position.set(GEM_RING * Math.cos(ang), GEM_RING * Math.sin(ang), side * (T / 2 + 0.3 * RELIEF));
        if (side === -1) g.rotation.y = Math.PI;
        coin.add(g);
      }
    }
    disposables.push(gemGeo, gemMat);
  }

  const ready = Promise.all([face(opts.front, 1), face(opts.back, -1, opts.inscription)]).then(() => undefined);

  // ── motion ──
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.22, 0.35, 0));
  const homeQ = q.clone();
  const omega = new THREE.Vector2(); // angular velocity, rad/frame (x: about world Y, y: about world X)
  const AX_X = new THREE.Vector3(1, 0, 0);
  const AX_Y = new THREE.Vector3(0, 1, 0);
  const AX_Z = new THREE.Vector3(0, 0, 1);
  const tmp = new THREE.Quaternion();
  let dragging = false;
  let lastInput = performance.now();
  let toss: { t0: number; q0: THREE.Quaternion; turns: number } | null = null;
  let distTarget = dist;
  const keyHome = key.position.clone();
  const keyAim = key.position.clone();

  const rotateWorld = (axis: THREE.Vector3, ang: number) => {
    tmp.setFromAxisAngle(axis, ang);
    q.premultiply(tmp);
  };

  let raf = 0;
  let disposed = false;
  const frame = (now: number) => {
    if (disposed) return;
    if (toss) {
      const DUR = 1100;
      const u = Math.min(1, (now - toss.t0) / DUR);
      const ease = 1 - Math.pow(1 - u, 3);
      // End over end about X, with a half twist about Z so it lands upright
      // on the other face rather than upside down.
      q.copy(toss.q0);
      tmp.setFromAxisAngle(AX_X, ease * toss.turns * Math.PI);
      q.premultiply(tmp);
      tmp.setFromAxisAngle(AX_Z, ease * Math.PI);
      q.premultiply(tmp);
      // Up and down, with a small landing bounce.
      const arc = u < 0.82 ? Math.sin((u / 0.82) * Math.PI) * 0.9 : Math.sin(((u - 0.82) / 0.18) * Math.PI) * 0.06;
      holder.position.y = arc;
      if (u >= 1) {
        toss = null;
        holder.position.y = 0;
      }
    } else if (!dragging) {
      if (Math.abs(omega.x) + Math.abs(omega.y) > 1e-4) {
        rotateWorld(AX_Y, omega.x);
        rotateWorld(AX_X, omega.y);
        omega.multiplyScalar(0.965);
      } else if (!reducedMotion && now - lastInput > 2500) {
        rotateWorld(AX_Y, 0.0035); // idle turn so the light keeps moving across it
      }
    }
    coin.quaternion.copy(q);
    dist += (distTarget - dist) * 0.15;
    camera.position.z = dist;
    key.position.lerp(keyAim, 0.08);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  ready.then(() => {
    if (!disposed) raf = requestAnimationFrame(frame);
  });

  const api: CoinScene = {
    ready,
    resize(px) {
      renderer.setSize(px, px, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    },
    drag(dx, dy) {
      dragging = true;
      toss = null;
      lastInput = performance.now();
      const k = 0.0105;
      rotateWorld(AX_Y, dx * k);
      rotateWorld(AX_X, dy * k);
      omega.set(dx * k, dy * k);
    },
    release() {
      dragging = false;
      lastInput = performance.now();
    },
    flip() {
      if (toss) return;
      lastInput = performance.now();
      omega.set(0, 0);
      toss = { t0: performance.now(), q0: q.clone(), turns: reducedMotion ? 1 : 5 };
    },
    spin() {
      lastInput = performance.now();
      toss = null;
      omega.set(reducedMotion ? 0.12 : 0.55, 0);
    },
    zoom(f) {
      lastInput = performance.now();
      distTarget = Math.min(7, Math.max(2.1, distTarget * f));
    },
    reset() {
      toss = null;
      omega.set(0, 0);
      q.copy(homeQ);
      distTarget = BASE_DIST;
      holder.position.y = 0;
      lastInput = performance.now();
    },
    aim(x, y) {
      keyAim.set(keyHome.x + x * 3.2, keyHome.y + y * 3.2, keyHome.z);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const d of disposables) d.dispose();
      room.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return api;
}

/** True when this browser can draw the WebGL coin. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
