/**
 * gather-singapore-stats — refresh the PGL Singapore 2026 team dossiers (PHA-5255).
 *
 * For each of the 32 field teams (HLTV ids from src/fixtures/singapore-stories.json)
 * it loads the HLTV team profile through the in-network Trawl scraper (a
 * FlareSolverr-compatible service that clears HLTV's Cloudflare challenge) and
 * reads, deterministically (no LLM):
 *
 *   - world rank and the team's country flag
 *   - the current five (the profile's bodyshot block: nick, flag, IGL/AWP role
 *     pill, portrait) with their Rating 3.0 from the players table
 *   - the last five completed results
 *
 * Writes:
 *   - public/players/<pickid>-<hltvPlayerId>.webp   self-hosted portraits
 *   - public/flags/<cc>.svg                         self-hosted flags (flag-icons, MIT)
 *   - src/lib/team-stats-singapore.ts               generated snapshot, merged over
 *                                                   the frozen Cologne map in team-stats-core
 *   - the player-portrait section of public/photos/CREDITS.md
 *
 *   node scripts/gather-singapore-stats.mjs            # fetch + write
 *   node scripts/gather-singapore-stats.mjs --offline  # reuse cached html in $HLTV_CACHE
 *
 * Needs TRAWL_URL (default http://10.0.0.100:8191/v1). Manual ops tool, not CI.
 * Re-run at each stage boundary (docs/PRE-MAJOR-CHECKLIST.md).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TRAWL = process.env.TRAWL_URL ?? "http://10.0.0.100:8191/v1";
const CACHE = process.env.HLTV_CACHE ?? resolve(process.env.PAPERCLIP_TASK_SCRATCH_DIR ?? "/tmp", "hltv-sg");
const OFFLINE = process.argv.includes("--offline");
const OUT_TS = resolve(ROOT, "src/lib/team-stats-singapore.ts");
const PLAYERS_DIR = resolve(ROOT, "public/players");
const FLAGS_DIR = resolve(ROOT, "public/flags");
const CREDITS = resolve(ROOT, "public/photos/CREDITS.md");
const FLAG_ICONS = "https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3";
for (const d of [CACHE, PLAYERS_DIR, FLAGS_DIR]) mkdirSync(d, { recursive: true });

/**
 * Registered Major stand-ins HLTV doesn't list as starters yet (the profile shows
 * four). pickid → HLTV player id/slug; sourced in the team's storyline
 * (src/fixtures/singapore-stories.json). Only used to fill a roster below five.
 */
const STAND_INS = {
  60: [{ id: 20417, slug: "anlelele" }], // Astralis: Anlelele on loan from Sashi (HLTV news 45939)
  112: [{ id: 20939, slug: "history" }], // 9z: history replaces benched meyern (HLTV news 45940)
};

const stories = JSON.parse(readFileSync(resolve(ROOT, "src/fixtures/singapore-stories.json"), "utf8")).teams;
const strip = (s) => s.replace(/<svg[\s\S]*?<\/svg>/g, "");
const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(url, file, marker = "bodyshot-team") {
  if (OFFLINE && existsSync(file)) return readFileSync(file, "utf8");
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(TRAWL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 150000 }),
        signal: AbortSignal.timeout(170000),
      });
      const j = await r.json();
      const h = j.solution?.response ?? "";
      if (j.status === "ok" && h.includes(marker)) {
        writeFileSync(file, h);
        return h;
      }
    } catch {}
    await sleep(3000 * (a + 1));
  }
  throw new Error(`no profile html for ${url}`);
}

export function parse(html, hltvId) {
  const t = strip(html);
  const rank = Number(/World ranking[\s\S]{0,400}?#(\d+)/.exec(t)?.[1]) || null;
  const tc = /<div class="team-country[^"]*"><img alt="([^"]+)" src="\/img\/static\/flags\/30x20\/(\w+)\.gif"/.exec(t);
  const country = tc ? { code: tc[2].toUpperCase(), name: decode(tc[1]) } : null;

  // Current five: the bodyshot block at the top of the profile.
  const start = t.indexOf("bodyshot-team g-grid");
  const block = start >= 0 ? t.slice(start, start + 20000) : "";
  const players = [];
  for (const m of block.matchAll(/<a href="\/player\/(\d+)\/([^"]+)" class="col-custom" title="([^"]*)">([\s\S]*?)<\/a>/g)) {
    const [, id, slug, nick, body] = m;
    const role = /role-pill--igl/.test(body) ? "IGL" : /role-pill--awp/.test(body) ? "AWP" : "Rifler";
    const img = /<img alt="Image of[^"]*" src="([^"]+)"/.exec(body)?.[1];
    const flag = /<img alt="([^"]+)" src="\/img\/static\/flags\/30x20\/(\w+)\.gif"/.exec(body);
    players.push({
      id: Number(id),
      slug,
      name: decode(nick),
      role,
      img: img && !/blankplayer|silhouette/i.test(img) ? decode(img) : null,
      cc: flag ? flag[2].toUpperCase() : null,
      countryName: flag ? decode(flag[1]) : null,
    });
    if (players.length === 5) break;
  }

  // Rating 3.0 from the "Players" table (team-period stats).
  const ratings = {};
  const ti = t.indexOf("Rating 3.0</th>");
  if (ti >= 0) {
    const table = t.slice(ti, t.indexOf("</table>", ti));
    for (const row of table.split("<tr>").slice(1)) {
      const id = /href="\/player\/(\d+)\//.exec(row)?.[1];
      const r = /rating-cell[^"]*">([0-9.]+)\*?</.exec(row)?.[1];
      if (id && r) ratings[id] = Number(r);
    }
  }

  // Last five completed results (upcoming rows carry "-" scores and are skipped).
  const recent = [];
  for (const m of t.matchAll(/<tr class="team-row"><td class="date-cell"><span[^>]*>(\d{2}\/\d{2}\/\d{4})<\/span><\/td><td class="team-center-cell">([\s\S]*?)<\/td>/g)) {
    const cell = m[2];
    const sc = [...cell.matchAll(/<span class="score[^"]*">(\d+)<\/span>/g)].map((x) => Number(x[1]));
    const names = [...cell.matchAll(/class="team-name team-(\d)">([^<]+)</g)].map((x) => ({ side: x[1], name: decode(x[2]) }));
    const ids = [...cell.matchAll(/href="\/team\/(\d+)\/[^"]+" class="team-name team-(\d)"/g)].map((x) => ({ id: Number(x[1]), side: x[2] }));
    if (sc.length < 2 || names.length < 2) continue;
    const mine = ids.find((x) => x.id === hltvId)?.side ?? "1";
    const a = mine === "1" ? sc[0] : sc[1];
    const b = mine === "1" ? sc[1] : sc[0];
    const opp = names.find((n) => n.side !== mine)?.name ?? "?";
    recent.push({ date: m[1], opponent: opp, score: `${a}-${b}`, result: a > b ? "W" : a < b ? "L" : "T" });
    if (recent.length === 5) break;
  }
  return { rank, country, players, ratings, recent };
}

/** A stand-in from their own HLTV player page (no team-period rating here). */
async function standIn({ id, slug }) {
  const t = strip(await page(`https://www.hltv.org/player/${id}/${slug}`, `${CACHE}/player-${id}.html`, "player-summary-stat-box"));
  const box = t.slice(t.indexOf("player-summary-stat-box-left"), t.indexOf("player-summary-stat-box-left") + 3000);
  const img = /src="([^"]+)" class="player-summary-stat-box-left-bodyshot"/.exec(box)?.[1];
  const flag = /<img alt="([^"]+)" src="\/img\/static\/flags\/30x20\/(\w+)\.gif"/.exec(box);
  const nick = /title="[^"]*'([^']+)'[^"]*" itemprop="image"/.exec(box)?.[1] ?? slug;
  return {
    id,
    slug,
    name: decode(nick),
    role: /role-pill--igl/.test(box) ? "IGL" : /role-pill--awp/.test(box) ? "AWP" : "Rifler",
    img: img ? decode(img) : null,
    cc: flag ? flag[2].toUpperCase() : null,
    countryName: flag ? decode(flag[1]) : null,
    standIn: true,
  };
}

async function portrait(pid, p) {
  if (!p.img) return null;
  const file = `${pid}-${p.id}.webp`;
  const dest = resolve(PLAYERS_DIR, file);
  if (existsSync(dest)) return `/players/${file}`;
  for (let a = 0; a < 3; a++) {
    try {
      // curl, not fetch: HLTV's image CDN 403s Node's TLS fingerprint but serves curl.
      const { stdout: buf } = await execFileP(
        "curl",
        ["-sfL", "--max-time", "30", "-A", "Mozilla/5.0 (compatible; phatt-picks/1.0)", "-e", "https://www.hltv.org/", p.img],
        { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
      );
      const meta = await sharp(buf).metadata();
      if (!meta.width || meta.width < 100) return null;
      await sharp(buf).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 82 }).toFile(dest);
      return `/players/${file}`;
    } catch {}
    await sleep(1500);
  }
  return null;
}

/**
 * Self-host a flag for an HLTV country code: the flag-icons SVG rasterised to a
 * 64×48 webp (a few hundred bytes; some source SVGs carry 100 KB+ coats of
 * arms). HLTV's regional codes (EU has a real flag; NAM / SAM / WORLD don't)
 * share the committed globe mark /flags/world.svg.
 */
const flagCache = new Map();
async function flag(cc) {
  if (!cc) return null;
  const code = cc.toLowerCase();
  if (flagCache.has(code)) return flagCache.get(code);
  let out = null;
  if (!/^[a-z]{2}$/.test(code)) out = "/flags/world.svg";
  else {
    const dest = resolve(FLAGS_DIR, `${code}.webp`);
    if (existsSync(dest)) out = `/flags/${code}.webp`;
    else {
      try {
        const r = await fetch(`${FLAG_ICONS}/${code}.svg`, { signal: AbortSignal.timeout(20000) });
        const svg = await r.text();
        if (r.ok && svg.includes("<svg")) {
          await sharp(Buffer.from(svg), { density: 144 }).resize(64, 48, { fit: "fill" }).webp({ quality: 90 }).toFile(dest);
          out = `/flags/${code}.webp`;
        }
      } catch {}
    }
  }
  flagCache.set(code, out);
  return out;
}

const results = {};
const entries = Object.entries(stories);
let idx = 0;
async function worker() {
  while (idx < entries.length) {
    const [pid, s] = entries[idx++];
    const url = `https://www.hltv.org/team/${s.hltvId}/${s.hltvSlug}`;
    try {
      const html = await page(url, `${CACHE}/${pid}.html`);
      const d = parse(html, s.hltvId);
      for (const si of STAND_INS[pid] ?? []) {
        if (d.players.length < 5 && !d.players.some((p) => p.id === si.id)) d.players.push(await standIn(si));
      }
      for (const p of d.players) p.photo = await portrait(pid, p);
      if (d.country) await flag(d.country.code);
      for (const p of d.players) await flag(p.cc);
      results[pid] = { ...d, url };
      console.error(
        `OK   ${pid} ${s.name}: #${d.rank} ${d.country?.code ?? "?"} ` +
          `${d.players.map((p) => `${p.name}${p.photo ? "" : "(nophoto)"}${ratings(d, p) == null ? "(norating)" : ""}`).join(",")} ` +
          `recent=${d.recent.length}`,
      );
    } catch (e) {
      console.error(`FAIL ${pid} ${s.name}: ${e}`);
    }
  }
}
const ratings = (d, p) => d.ratings[p.id] ?? null;
await Promise.all([worker(), worker(), worker()]);
writeFileSync(`${CACHE}/parsed.json`, JSON.stringify(results, null, 1));

const bad = entries.filter(([pid]) => {
  const r = results[pid];
  return !r || r.players.length !== 5 || !r.rank || r.recent.length === 0 || !r.country;
});
console.error(`\nparsed ${Object.keys(results).length}/${entries.length}; incomplete: ${bad.map(([, s]) => s.name).join(", ") || "none"}`);
if (Object.keys(results).length !== entries.length) {
  console.error("not writing: some profiles failed to load");
  process.exit(1);
}

// ── emit src/lib/team-stats-singapore.ts ──────────────────────────────────────
const d = new Date();
const asOf = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const q = (s) => JSON.stringify(s);
const lines = [
  "/**",
  " * GENERATED by scripts/gather-singapore-stats.mjs (PHA-5255) — do not hand-edit;",
  " * re-run the script at each stage boundary. HLTV snapshot of the PGL Singapore",
  " * 2026 field: world rank, country flag, current five with role, Rating 3.0 and a",
  " * self-hosted portrait, and the last five completed results. Merged over the",
  " * frozen Cologne map in team-stats-core (Singapore wins on shared pickids).",
  " */",
  "",
  'import type { TeamStats } from "./team-stats-core";',
  "",
  `export const SINGAPORE_STATS_AS_OF = ${q(asOf)};`,
  "",
  "export const SINGAPORE_TEAM_STATS: Record<number, TeamStats> = {",
];
for (const [pid, s] of entries.sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const r = results[pid];
  lines.push(`  ${pid}: { // ${s.name}`);
  lines.push(`    worldRank: ${r.rank ?? "null"},`);
  lines.push(`    country: ${r.country ? `{ code: ${q(r.country.code)}, name: ${q(r.country.name)}, flag: ${q(flagCache.get(r.country.code.toLowerCase()) ?? null)} }` : "null"},`);
  lines.push(`    roster: [`);
  for (const p of r.players) {
    lines.push(
      `      { name: ${q(p.name)}, position: ${q(p.role)}, rating: ${ratings(r, p) ?? "null"}, ` +
        `hltvUrl: ${q(`https://www.hltv.org/player/${p.id}/${p.slug}`)}, ${p.photo ? `photo: ${q(p.photo)}, ` : ""}` +
        `country: ${p.cc ? `{ code: ${q(p.cc)}, name: ${q(p.countryName)}, flag: ${q(flagCache.get(p.cc.toLowerCase()) ?? null)} }` : "null"}` +
        `${p.standIn ? ", standIn: true" : ""} },`,
    );
  }
  lines.push(`    ],`);
  lines.push(`    recent: [`);
  for (const m of r.recent) {
    lines.push(`      { date: ${q(m.date)}, opponent: ${q(m.opponent)}, score: ${q(m.score)}, result: ${q(m.result)} },`);
  }
  lines.push(`    ],`);
  lines.push(`    hltvUrl: ${q(`https://www.hltv.org/team/${s.hltvId}/${s.hltvSlug}`)},`);
  lines.push(`    asOf: SINGAPORE_STATS_AS_OF,`);
  lines.push(`  },`);
}
lines.push("};", "");
writeFileSync(OUT_TS, lines.join("\n"));

// ── player-portrait credits ───────────────────────────────────────────────────
const BEGIN = "<!-- players:begin (generated by scripts/gather-singapore-stats.mjs) -->";
const END = "<!-- players:end -->";
const rows = [];
for (const [pid, s] of entries) {
  for (const p of results[pid].players) {
    if (!p.photo) continue;
    rows.push(`| ${p.photo.replace("/players/", "")} | ${p.name} (${s.name}) | [HLTV profile](https://www.hltv.org/player/${p.id}/${p.slug}) |`);
  }
}
const section = [
  BEGIN,
  "## Player portraits (`public/players/`)",
  "",
  `Bodyshot portraits of the PGL Singapore 2026 field, from each player's HLTV team`,
  `profile (snapshot ${asOf}), resized to 320px webp. Credited \`Photo · HLTV\` in the`,
  "team drawer. **Rights:** same posture as the stills above (the HLTV/ESL licensing",
  "Brandon is clearing). Players with no portrait show a styled silhouette with their",
  "name. Flags in `public/flags/` are [flag-icons](https://github.com/lipis/flag-icons) (MIT).",
  "",
  "| File | Player | Source |",
  "|---|---|---|",
  ...rows,
  END,
].join("\n");
const credits = readFileSync(CREDITS, "utf8");
const i0 = credits.indexOf(BEGIN);
const i1 = credits.indexOf(END);
writeFileSync(
  CREDITS,
  i0 >= 0 && i1 > i0 ? credits.slice(0, i0) + section + credits.slice(i1 + END.length) : credits.trimEnd() + "\n\n" + section + "\n",
);
console.error(`wrote ${OUT_TS} (as-of ${asOf}), ${rows.length} portraits credited`);
