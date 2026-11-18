// Dominant vivid colour per team mark -> src/fixtures/team-colors.json (fallback when no storyline colour).
import sharp from "sharp";
import fs from "node:fs";
const field = JSON.parse(fs.readFileSync("src/fixtures/singapore-field.json", "utf8")).teams;
const out = {};
for (const t of field) {
  const f = `public/logos/${t.logo}.png`;
  if (!fs.existsSync(f)) continue;
  const { data } = await sharp(f).resize(48, 48, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    if (sat < 0.35 || mx < 70) continue;
    const k = `${r >> 5},${g >> 5},${b >> 5}`;
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += sat; e.r += r; e.g += g; e.b += b; bins.set(k, e);
  }
  let best = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  if (!best) { out[t.logo] = "#8a93a6"; continue; }
  const cnt = [...bins.values()].length && best.n;
  // average colour of winning bin (n is saturation-weighted; recompute count via r/g/b sums is lossy, so normalise by max channel)
  let [r, g, b] = [best.r, best.g, best.b];
  const m = Math.max(r, g, b); const s = 255 / m; // lift to full brightness so it reads on dark
  [r, g, b] = [r, g, b].map((v) => Math.min(255, Math.round(v * s * 0.95)));
  out[t.logo] = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
// Monochrome marks have no dominant hue; use the org's brand colour.
Object.assign(out, { nine: "#6f9cff", chin: "#e8402f", mibr: "#f5c518", mouz: "#ff2a45", spir: "#e6e6e6", furi: "#d4d4d4" });
fs.writeFileSync("src/fixtures/team-colors.json", JSON.stringify(out, null, 1) + "\n");
console.log(out);
