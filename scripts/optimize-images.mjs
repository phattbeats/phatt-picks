// PHA-5360 — build the WebP variants the app actually serves.
//
//   node scripts/optimize-images.mjs            # (re)build missing/stale variants
//   node scripts/optimize-images.mjs --force    # rebuild everything
//
// The PNG/JPG originals stay where they are (they are the source of truth and
// keep any old URL working); the app references the generated .webp siblings:
//
//   public/logos/<slug>.png   → public/logos/<slug>.webp      (fit 256×256)
//                             → public/logos/sm/<slug>.webp   (fit 144×144)
//   public/photos/<name>.jpg  → public/photos/<name>.webp     (same pixels)
//
// Why static files and not next/image: vps1 gives the container 0.30 CPU, so
// on-the-fly encoding would compete with page renders. Pre-built files cost
// nothing at runtime and Cloudflare caches them by extension.
//
// Logos render at 18–56 CSS px in lists (≤ 144 device px at 2.6× DPR) and up to
// 240 CSS px on a team page hero, so two sizes cover every surface; TeamLogo
// picks between them with srcset. Run after scripts/build-team-marks.ts.
//
// sharp ships with Next (optional dependency), so no extra install is needed.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORCE = process.argv.includes("--force");

const JOBS = [
  {
    dir: "public/logos",
    match: /\.png$/,
    outputs: [
      { sub: "", fit: 256, opts: { quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true } },
      { sub: "sm", fit: 144, opts: { quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true } },
    ],
  },
  {
    dir: "public/photos",
    match: /\.jpe?g$/,
    outputs: [{ sub: "", fit: null, opts: { quality: 82, effort: 5, smartSubsample: true } }],
  },
];

const fresh = (src, out) => existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;

let before = 0;
let after = 0;
let built = 0;
for (const job of JOBS) {
  const dir = join(ROOT, job.dir);
  for (const file of readdirSync(dir).filter((f) => job.match.test(f)).sort()) {
    const src = join(dir, file);
    const base = file.replace(job.match, "");
    for (const o of job.outputs) {
      const outDir = join(dir, o.sub);
      mkdirSync(outDir, { recursive: true });
      const out = join(outDir, `${base}.webp`);
      if (FORCE || !fresh(src, out)) {
        let img = sharp(src);
        if (o.fit) img = img.resize(o.fit, o.fit, { fit: "inside", withoutEnlargement: true });
        await img.webp(o.opts).toFile(out);
        built++;
      }
      if (!o.sub) {
        before += statSync(src).size;
        after += statSync(out).size;
      }
    }
  }
}
const kb = (n) => `${Math.round(n / 1024)} KB`;
process.stdout.write(`Built ${built} variant(s). Originals ${kb(before)} → full-size WebP ${kb(after)}.\n`);
