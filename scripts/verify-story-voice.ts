/**
 * verify-story-voice - guard for PHA-5262 (Brandon: "all of this type of
 * language needs fixed. and the profiles need to add some hype").
 *
 * Team storylines are broadcast copy, not a research log. Sourcing lives in
 * the credit line under the story; the prose itself must never talk about
 * where a fact came from or how sure we are of it. This fails if any headline
 * or storyline in the Singapore stories fixture:
 *   • matches the banned research-memo phrases ("as of", "Liquipedia",
 *     "per HLTV", "listed", "not confirmed", "this batch", ...);
 *   • breaks the length budget the team page and picks drawer are laid out
 *     for (headline 4-9 words, storyline <= 75 words).
 *
 * Offline:  node scripts/verify-story-voice.ts
 * Live:     node scripts/verify-story-voice.ts --live https://hotline.phatt.vip
 *           fetches every /teams/<slug> page and checks the rendered story
 *           block (headline, storyline, sources summary), not just the JSON.
 *           Needs HOTLINE_SESSION=<phatt_session cookie value> in the env.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Story {
  slug: string;
  headline: string;
  storyline: string;
}
const teams = Object.values(
  (JSON.parse(readFileSync(join(ROOT, "src/fixtures/singapore-stories.json"), "utf8")) as {
    teams: Record<string, Story>;
  }).teams,
);

const BANNED =
  /\b(as of|liquipedia|per hltv|listings?|listed|not confirmed|reported|batch|this group|according to)\b/i;

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
const words = (s: string) => s.trim().split(/\s+/).length;

check("fixture has all 32 Singapore teams", teams.length === 32);
for (const t of teams) {
  for (const field of ["headline", "storyline"] as const) {
    const hit = t[field].match(BANNED);
    check(`${t.slug} ${field} free of research-memo language${hit ? ` (found "${hit[0]}")` : ""}`, !hit);
  }
  const hw = words(t.headline);
  check(`${t.slug} headline is 4-9 words (${hw})`, hw >= 4 && hw <= 9);
  const sw = words(t.storyline);
  check(`${t.slug} storyline <= 75 words (${sw})`, sw <= 75);
}

const liveAt = process.argv.indexOf("--live");
if (liveAt !== -1) {
  const base = (process.argv[liveAt + 1] ?? "").replace(/\/$/, "");
  check("--live has a base URL", base.startsWith("http"));
  // Team pages sit behind the splash gate; pass a session via the environment
  // (never argv, so it stays out of shell history and process lists).
  const session = process.env.HOTLINE_SESSION;
  check("HOTLINE_SESSION is set for --live", Boolean(session));
  const headers = { cookie: `phatt_session=${session}` };
  for (const t of teams) {
    const res = await fetch(`${base}/teams/${t.slug}`, { headers, redirect: "manual" });
    const html = await res.text();
    check(`${t.slug} page responds 200 (${res.status})`, res.ok);
    // The story block runs from the .sgt-story wrapper to the sources list;
    // source labels themselves are credits and are allowed to name outlets.
    const start = html.indexOf('class="sgt-story"');
    const end = html.indexOf("<ul", start);
    check(`${t.slug} page renders the story block`, start !== -1 && end > start);
    const text = html
      .slice(start, end)
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    const hit = text.match(BANNED);
    check(`${t.slug} live story free of research-memo language${hit ? ` (found "${hit[0]}")` : ""}`, !hit);
    check(`${t.slug} live page shows the current headline`, text.includes(t.headline));
  }
}

console.log(`verify-story-voice: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
