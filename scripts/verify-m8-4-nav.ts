/**
 * verify-m8-4-nav - PHA-840 proof: leaderboard rows are tappable, /players/[id]
 * exists, /profile has a graceful sign-in fallback (no redirect), and the
 * home header surfaces a "You" label.
 *
 * Pure file-shape assertions — no DB, no Next runtime.
 * Run: node --env-file=.env scripts/verify-m8-4-nav.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

console.log("\nm8.4 - /players/[id] route");

const playerRoute = "src/app/(app)/players/[id]/page.tsx";
check("players/[id]/page.tsx exists", existsSync(join(ROOT, playerRoute)));

const playerSrc = read(playerRoute);
check("player page is a default async export", /export default async function/.test(playerSrc));
check("player page calls notFound() when player missing", playerSrc.includes("notFound()"));
check("player page imports reveal-core", playerSrc.includes('from "@/lib/reveal-core"'));
check(
  "player page reveals own picks even pre-lock (isSelf bypass)",
  /isSelf \|\|\s*arePicksRevealed/.test(playerSrc),
);
check(
  'compare CTA targets /leaderboard/compare?b=<id>',
  /\/leaderboard\/compare\?b=\$\{encodeURIComponent\(player\.id\)\}/.test(playerSrc),
);
// Bottom nav moved out of each page into the shared (app) route-group layout
// (HeatBottomNav). The layout wraps every app page, so the profile route gets it.
const appLayoutSrc = read("src/app/(app)/layout.tsx");
check("(app) layout mounts the bottom nav for every page", appLayoutSrc.includes("<HeatBottomNav />"));

console.log("\nm8.4 - leaderboard rows are clickable");

const lbSrc = read("src/app/(app)/leaderboard/page.tsx");
check("leaderboard imports Link", /import Link from "next\/link"/.test(lbSrc));
check(
  "each row is a <Link href=\"/players/{id}\">",
  /<Link[\s\S]*?href=\{`\/players\/\$\{encodeURIComponent\(row\.playerId\)\}`\}/.test(lbSrc),
);
check(
  "no plain <div> row wrapper left behind",
  // narrowly: the old block that opened with `<div key={row.playerId}` must be gone
  !/<div\s+key=\{row\.playerId\}/.test(lbSrc),
);
check("rows close with </Link>", /<\/Link>\s*\);\s*\}\)\}/.test(lbSrc));

console.log("\nm8.4 - /profile graceful sign-in card (no redirect)");

const profileSrc = read("src/app/(app)/profile/page.tsx");
check(
  'profile no longer imports redirect from next/navigation',
  !/from "next\/navigation"/.test(profileSrc),
);
check(
  'profile no longer calls redirect("/login")',
  !/redirect\("\/login"\)/.test(profileSrc),
);
check(
  "profile renders SignedOutProfile when session missing",
  /if \(!session\) return <SignedOutProfile/.test(profileSrc),
);
check(
  "SignedOutProfile component defined",
  /function SignedOutProfile\(\)/.test(profileSrc),
);
check(
  "SignedOutProfile offers Steam sign-in",
  /\/api\/auth\/steam/.test(profileSrc),
);
check(
  "SignedOutProfile offers local play",
  /\/api\/auth\/local/.test(profileSrc),
);
check(
  "SignedOutProfile mentions session expired copy",
  /Session expired/i.test(profileSrc),
);

console.log("\nm8.4 - app header surfaces the 'You' chip next to the profile icon");

// The 'You' label + profile link moved out of each page's header into the shared
// (app) layout's HeatHeader (the YouChip). Deep YouChip behaviour is covered by
// verify-m9-2-topbar-you; here we just assert the home route inherits the header.
check(
  "(app) layout mounts the HOTLINE header (carries the You chip)",
  /<HeatHeader\b/.test(appLayoutSrc),
);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
