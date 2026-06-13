/**
 * verify-team-accent - offline proof for PHA-1043 follow-up (Brandon: "each
 * spotlight needs its accent color to be the team's color").
 *
 * The spotlight modal keys every accent off the team's color; a team missing
 * from the TEAM_ACCENT map silently falls back to the house orange — i.e. it
 * would NOT honor the request. This guards that:
 *   • every team in the committed layout fixture has a mapped accent (no team
 *     quietly reverts to --heat);
 *   • each mapped accent is a valid 3/6-digit hex color (so the inline
 *     `--team-accent` style is always well-formed);
 *   • an unknown slug returns null (the documented fallback contract).
 *
 * Run: node scripts/verify-team-accent.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { teamAccent } from "../src/lib/playoff-spotlights.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

interface LayoutResult {
  result: { teams: { pickid: number; logo: string; name: string }[] };
}
const teams = (JSON.parse(read("src/fixtures/cologne-layout.json")) as LayoutResult)
  .result.teams;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// WCAG relative luminance + contrast (sRGB). The accent is used as readable
// TEXT on the dark panel, so it must clear AA (4.5:1) against the LIGHTEST
// surface it sits on — that is the hardest test and covers the darker ones.
const SURF3 = "#35291f"; // .spot-odds / .surf-3, the lightest accent backdrop
function chan(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const w = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [parseInt(w.slice(0, 2), 16), parseInt(w.slice(2, 4), 16), parseInt(w.slice(4, 6), 16)];
}
function lin(c: number): number {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function lum(h: string): number {
  const [r, g, b] = chan(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const AA_TEXT = 4.5;

const seen = new Map<string, string>();
for (const t of teams) {
  const accent = teamAccent(t);
  check(`${t.name} (${t.logo}) has a mapped accent`, accent != null);
  if (accent != null) {
    check(`${t.name} (${t.logo}) accent is a valid hex`, HEX.test(accent));
    const ratio = contrast(accent, SURF3);
    check(
      `${t.name} (${t.logo}) accent ${accent} clears AA on surf-3 (${ratio.toFixed(2)}:1 >= ${AA_TEXT})`,
      ratio >= AA_TEXT,
    );
    // Unique color per team so two co-bracketed teams never share an accent.
    const dupe = seen.get(accent);
    check(`${t.name} (${t.logo}) accent ${accent} is unique${dupe ? ` (collides with ${dupe})` : ""}`, dupe == null);
    seen.set(accent, t.logo);
  }
}

// — fallback contract: an unmapped slug yields null so the modal keeps --heat —
check("unknown slug → null", teamAccent({ logo: "__nope__" }) === null);

// — anti-rigging: a deliberately too-dark color must fail the contrast gate —
check(
  "guard catches a sub-AA color (dark navy on surf-3)",
  contrast("#1f3a5f", SURF3) < AA_TEXT,
);

console.log(`\nverify-team-accent: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
