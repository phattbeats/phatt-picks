/**
 * The coin inspector's WebGL scene. It builds the coin from the same relief as
 * the Blender renders (scripts/coins/): each face is a dense polar mesh
 * displaced by the struck height field, shaded with a 2048px normal map and a
 * tier PBR material (mirror field, satin relief, glossy enamel, cavity patina).
 * Edges are reeded and diamond carries two cut stones. It's lit by a dark
 * studio of softbox panels (like the render rig), so the metal throws hard
 * reflections that slide across it as you turn it.
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

/**
 * Turn a face's surface mask (R polish, G enamel, B frosted, A cavity) into the
 * tier's albedo, roughness/metalness and clearcoat maps.
 */
function surfaceTextures(img: HTMLImageElement, tier: CoinTier) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const read = document.createElement("canvas");
  read.width = w;
  read.height = h;
  const rctx = read.getContext("2d", { willReadFrequently: true })!;
  rctx.drawImage(img, 0, 0);
  const src = rctx.getImageData(0, 0, w, h).data;

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

  const loader = new THREE.TextureLoader();
  const loadTex = (src: string) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(src, (t) => resolve(t), undefined, reject);
    });

  const rings = 320;
  const segs = 640;
  const discGeo = polarDisc(rings, segs);
  disposables.push(discGeo);

  async function face(prefix: string, side: 1 | -1) {
    const [height, normal, surfImg] = await Promise.all([
      loadTex(`${prefix}-h.webp`),
      loadTex(`${prefix}-n.webp`),
      loadImage(`${prefix}-s.webp`),
    ]);
    height.colorSpace = THREE.NoColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    normal.anisotropy = 8;
    const { map, orm, coat } = surfaceTextures(surfImg, tier);
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

  const ready = Promise.all([face(opts.front, 1), face(opts.back, -1)]).then(() => undefined);

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
