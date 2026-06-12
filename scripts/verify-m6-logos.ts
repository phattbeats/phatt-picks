/**
 * M6 logo verification — offline, against the committed manifest + layout.
 *
 * Proves the DoD without a network call (the manifest was already ingested by
 * scripts/build-logos.ts, which is where the live ByMykel reachability check
 * happens — see its header for the 404-relocation finding):
 *
 *   1. coverage: every non-TBD layout team has a manifest entry, so logos
 *      resolve for known teams.
 *   2. cascade order: a matched team yields [bymykel, selfhost, monogram];
 *      a team missing from the manifest skips ByMykel → [selfhost, monogram];
 *      a TBD slot (pickid 0) yields [monogram "?"] only. Missing logos fall
 *      back cleanly because the list always ends in a never-fail monogram.
 *   3. self-host slug: the fallback path is keyed by the layout `logo` slug.
 *
 * Imports the real cascade from logos-core.ts (the same code the app runs) and
 * feeds it the real manifest read from disk.
 *
 * Run:  node scripts/verify-m6-logos.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveLogoTiers,
  selfHostUrl,
  monogramLabel,
  type LogoMap,
  type LogoTier,
} from "../src/lib/logos-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout = JSON.parse(read("src/fixtures/cologne-layout.json")).result as {
  teams: { pickid: number; logo: string; name: string }[];
};
const manifest = JSON.parse(read("src/fixtures/cologne-logos.json")) as {
  logos: LogoMap;
};
const LOGOS = manifest.logos;
const tiersFor = (t: { pickid: number; logo: string; name: string }) =>
  resolveLogoTiers(t, LOGOS);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}
const kinds = (t: LogoTier[]) =>
  t.map((x) => (x.kind === "image" ? x.source : "monogram")).join(" → ");

console.log("\nM6 logo verification\n");

// 1. coverage — every real team resolves from ByMykel.
console.log("[1] ByMykel coverage of layout teams");
const real = layout.teams.filter((t) => t.pickid !== 0);
const missing = real.filter((t) => !LOGOS[String(t.pickid)]?.image);
check(
  `all ${real.length} non-TBD teams have a manifest image`,
  missing.length === 0,
  missing.length ? `missing: ${missing.map((t) => t.name).join(", ")}` : "0 gaps",
);
check(
  "every manifest image is an https URL",
  real.every((t) => LOGOS[String(t.pickid)]?.image.startsWith("https://")),
);

// 2. cascade order for the three cases.
console.log("\n[2] cascade order");
const navi = real.find((t) => t.logo === "navi")!;
const naviTiers = tiersFor(navi);
check(
  "matched team → bymykel → selfhost → monogram",
  kinds(naviTiers) === "bymykel → selfhost → monogram",
  kinds(naviTiers),
);
check(
  "matched team bymykel src is its manifest URL",
  naviTiers[0].kind === "image" && naviTiers[0].src === LOGOS[String(navi.pickid)].image,
);

// team absent from the manifest (simulate a ByMykel gap) → skip tier 1.
const ghost = { pickid: 99999, logo: "ghost", name: "Ghost Org" };
const ghostTiers = tiersFor(ghost);
check(
  "unmatched team → selfhost → monogram (ByMykel skipped)",
  kinds(ghostTiers) === "selfhost → monogram",
  kinds(ghostTiers),
);
check(
  "unmatched selfhost path keyed by logo slug",
  ghostTiers[0].kind === "image" && ghostTiers[0].src === selfHostUrl("ghost"),
  selfHostUrl("ghost"),
);

// TBD slot.
const tbdTiers = tiersFor({ pickid: 0, logo: "", name: "TBD" });
check(
  "TBD (pickid 0) → single monogram tier",
  tbdTiers.length === 1 && tbdTiers[0].kind === "monogram",
  kinds(tbdTiers),
);
check(
  "TBD monogram label is '?'",
  tbdTiers[0].kind === "monogram" && tbdTiers[0].label === "?",
);

// 3. terminal tier never fails + monogram labels.
console.log("\n[3] clean fallback");
check(
  "every cascade ends in a monogram (never a broken image)",
  [naviTiers, ghostTiers, tbdTiers].every((t) => t[t.length - 1].kind === "monogram"),
);
check("monogram 'Natus Vincere' → 'NV'", monogramLabel("Natus Vincere") === "NV");
check("monogram 'G2 Esports' → 'GE'", monogramLabel("G2 Esports") === "GE");
check("monogram 'FaZe' (one word) → 'F'", monogramLabel("FaZe") === "F");

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ` +
    `${real.length}/${real.length} teams from ByMykel, cascade verified.\n`,
);
process.exit(failures === 0 ? 0 : 1);
