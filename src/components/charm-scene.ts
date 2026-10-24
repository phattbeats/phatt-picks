/**
 * The charm viewer's WebGL half (PHA-4505): loads one meshopt glTF charm, lights
 * it with a small studio rig and turns it. Loaded on demand by Keyring (dynamic
 * import), so three.js only ships to people who wake a charm. It draws only
 * while something moves: a steady turn while hovered or focused, a pendulum
 * swing when it settles, nothing once it is back at rest.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface CharmScene {
  /** Spin while true; the charm eases back to face front when it turns false. */
  setActive(active: boolean): void;
  dispose(): void;
}

export async function mountCharm(host: HTMLElement, url: string, reducedMotion: boolean): Promise<CharmScene> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "kr-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 3, 4);
  scene.add(key);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;

  // Centre on the origin and fit the camera to its bounds.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  model.position.sub(centre);
  const pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);
  const radius = Math.max(size.x, size.y, size.z) / 2 || 1;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, radius * 4.1);

  host.appendChild(renderer.domElement);

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(() => {
    resize();
    draw();
  });
  ro.observe(host);

  let active = false;
  let raf = 0;
  let last = 0;
  let t = 0;

  const draw = () => renderer.render(scene, camera);

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (active) {
      pivot.rotation.y += dt * 1.6;
    } else {
      // Ease to the nearest front-facing turn, then stop drawing.
      const turn = Math.PI * 2;
      const target = Math.round(pivot.rotation.y / turn) * turn;
      const d = target - pivot.rotation.y;
      if (Math.abs(d) < 0.002) {
        pivot.rotation.y = target;
        draw();
        return;
      }
      pivot.rotation.y += d * Math.min(1, dt * 6);
    }
    t += dt;
    pivot.rotation.z = Math.sin(t * 2.1) * 0.03 * (active ? 1 : 0);
    draw();
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  draw();
  return {
    setActive(next) {
      if (reducedMotion) return;
      active = next;
      kick();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
