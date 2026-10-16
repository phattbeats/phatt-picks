/**
 * Team-mark ingest — download each layout team's real logo mark into
 * public/logos/<logo-slug>.png (the self-host tier of the logo cascade).
 *
 * WHY: the ByMykel manifest (build-logos.ts) maps every team to its
 * tournament STICKER — for Cologne that is a round stained-glass roundel with
 * "Cologne 2026" lettered under the mark. Shrunk to a 20–34px tile it reads as
 * a grey/olive disc, not a team logo. The self-hosted mark is the team's own
 * logo, so `resolveLogoTiers` now tries it first and keeps the sticker as the
 * fallback.
 *
 * SOURCE: Liquipedia's MediaWiki API (two batched `action=query` calls — page
 * props for each team page's infobox image, then imageinfo for the icon
 * variant). Liquipedia asks for a descriptive UA with a contact and ≥2s between
 * calls; both are honoured below. Prefers the dark-mode icon (the app is
 * carbon-dark), then all-mode, then light-mode; never the wide "full" wordmark
 * when an icon exists.
 *
 * Run:  node --experimental-strip-types scripts/build-team-marks.ts [layout-fixture-basename]
 *       (defaults to cologne-layout). Re-run for the next Major once its
 *       layout fixture lands; existing files are overwritten.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://liquipedia.net/counterstrike/api.php";
const USER_AGENT = "HOTLINE/1.0 (CS2 Major Pick'Em companion; contact: admin@phatt.vip)";
const MIN_INTERVAL_MS = 2_100;
const THUMB_WIDTH = 256;

/** Layout team name → Liquipedia page title, where they differ. */
const TITLE_OVERRIDES: Record<string, string> = {
  Tyloo: "TYLOO",
  Vitality: "Team Vitality",
  "Lynn Vision": "Lynn Vision Gaming",
  Flyquest: "FlyQuest",
  Aurora: "Aurora Gaming",
  BetBoom: "BetBoom Team",
  Falcons: "Team Falcons",
  Parivision: "PARIVISION",
  FUT: "FUT Esports",
  Sinners: "SINNERS Esports",
};

/** Explicit file candidates for teams whose page image is wrong/missing. */
const FILE_OVERRIDES: Record<string, string[]> = {
  // Liquipedia redirects "Sharks Esports" to its successor org; keep Sharks' own mark.
  "Sharks Esports": ["Sharks Esports 2026 allmode.png", "Sharks Esports 2024 allmode.png"],
  // Page title doesn't resolve; the files are under the run-together name.
  "THUNDER dOWNUNDER": ["THUNDERdOWNUNDER 2026 allmode.png", "THUNDERdOWNUNDER darkmode.png"],
  // The 2026 page image only ships as a wide wordmark; the bee icon reads at tile size.
  Vitality: ["Team Vitality 2023 darkmode.png"],
};

interface LayoutTeam {
  pickid: number;
  logo: string;
  name: string;
}

let last = 0;
async function api(params: Record<string, string>): Promise<unknown> {
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const qs = new URLSearchParams({ format: "json", ...params });
  const res = await fetch(`${API}?${qs}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
  });
  if (!res.ok) throw new Error(`Liquipedia ${res.status} for ${qs}`);
  return res.json();
}

/** Icon-first candidate filenames derived from a page's infobox image. */
function variants(meta: string): string[] {
  const icon = meta.replace(/ full(?= )/, "");
  const out: string[] = [];
  for (const base of [icon, meta]) {
    for (const mode of ["darkmode", "allmode", "lightmode"]) {
      out.push(base.replace(/(dark|all|light)mode/, mode));
    }
    out.push(base);
  }
  return [...new Set(out)];
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function main() {
  const fixture = process.argv[2] ?? "cologne-layout";
  const layout = JSON.parse(readFileSync(join(ROOT, `src/fixtures/${fixture}.json`), "utf8")).result as {
    teams: LayoutTeam[];
  };
  const teams = layout.teams.filter((t) => t.pickid !== 0 && t.logo);
  const titleOf = (t: LayoutTeam) => TITLE_OVERRIDES[t.name] ?? t.name;

  // 1. Infobox image per team page (one batched call; ≤50 titles).
  const props = (await api({
    action: "query",
    prop: "pageprops",
    ppprop: "metaimage",
    titles: teams.map(titleOf).join("|"),
  })) as { query: { normalized?: { from: string; to: string }[]; pages: Record<string, { title: string; pageprops?: { metaimage?: string } }> } };
  const norm = new Map((props.query.normalized ?? []).map((n) => [n.from, n.to]));
  const metaByTitle = new Map<string, string>();
  for (const p of Object.values(props.query.pages)) {
    if (p.pageprops?.metaimage) metaByTitle.set(p.title, p.pageprops.metaimage);
  }

  const candidatesByTeam = new Map<LayoutTeam, string[]>();
  for (const t of teams) {
    const title = norm.get(titleOf(t)) ?? titleOf(t);
    const meta = metaByTitle.get(title);
    candidatesByTeam.set(t, [...(FILE_OVERRIDES[t.name] ?? []), ...(meta ? variants(meta) : [])]);
  }

  // 2. Which candidate files exist, with a thumbnail URL (batched ≤50).
  const allFiles = [...new Set([...candidatesByTeam.values()].flat())];
  const urlByFile = new Map<string, string>();
  for (const batch of chunk(allFiles, 50)) {
    const info = (await api({
      action: "query",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: String(THUMB_WIDTH),
      titles: batch.map((f) => `File:${f}`).join("|"),
    })) as { query: { normalized?: { from: string; to: string }[]; pages: Record<string, { title: string; imageinfo?: { thumburl?: string; url: string }[] }> } };
    const fnorm = new Map((info.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of Object.values(info.query.pages)) {
      // Files live in the shared commons repo: the local wiki reports them
      // `missing` + `known`, so existence is "imageinfo came back", not !missing.
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const asked = (fnorm.get(p.title) ?? p.title).replace(/^File:/, "");
      urlByFile.set(asked, ii.thumburl ?? ii.url);
      urlByFile.set(p.title.replace(/^File:/, ""), ii.thumburl ?? ii.url);
    }
  }

  // 3. Download the first existing candidate per team.
  mkdirSync(join(ROOT, "public/logos"), { recursive: true });
  const missing: string[] = [];
  for (const [t, cands] of candidatesByTeam) {
    const file = cands.find((c) => urlByFile.has(c));
    if (!file) {
      missing.push(t.name);
      continue;
    }
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(urlByFile.get(file)!, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      missing.push(`${t.name} (${res.status})`);
      continue;
    }
    writeFileSync(join(ROOT, `public/logos/${t.logo}.png`), Buffer.from(await res.arrayBuffer()));
    process.stdout.write(`${t.logo.padEnd(5)} ${t.name} ← ${file}\n`);
  }
  if (missing.length) process.stdout.write(`\nNo mark found (sticker fallback stays): ${missing.join(", ")}\n`);

  // 4. Index every mark on disk (accumulates across Majors) so the cascade only
  //    tries /logos/<slug>.png for slugs that exist — no 404 round-trip.
  const marks = readdirSync(join(ROOT, "public/logos"))
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -4))
    .sort();
  writeFileSync(
    join(ROOT, "src/fixtures/team-marks.json"),
    JSON.stringify(
      {
        note: "Generated by scripts/build-team-marks.ts — logo slugs with a self-hosted mark at public/logos/<slug>.png (source: Liquipedia).",
        marks,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`\nIndexed ${marks.length} marks → src/fixtures/team-marks.json\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
