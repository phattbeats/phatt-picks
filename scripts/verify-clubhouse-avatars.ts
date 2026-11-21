/**
 * verify-clubhouse-avatars — offline proof for PHA-5341 (Clubhouse avatars for local players).
 *
 *   1. the pool: 28 plain avatars, no `dealer-wanted`, no foil, every file on disk
 *   2. the random pick is always in the pool, for any rand() value
 *   3. the save decision rejects bad origin, signed-out, Steam players, unknown slugs and paths
 *   4. the backfill skips uploaded photos and Steam players, and is a no-op on a second run
 *
 * Run: node scripts/verify-clubhouse-avatars.ts
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLUBHOUSE_AVATARS,
  CLUBHOUSE_AVATAR_SIZES,
  clubhouseAvatarPath,
  clubhouseSlugFromUrl,
  decideClubhouseAvatarSave,
  isClubhouseAvatarSlug,
  planClubhouseAvatarBackfill,
  randomClubhouseAvatarSlug,
  randomClubhouseAvatarUrl,
  type BackfillCandidate,
} from "../src/lib/clubhouse-avatars.ts";

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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artDir = join(root, "public", "art", "clubhouse-avatars");

console.log("1. pool");
const slugs = CLUBHOUSE_AVATARS.map((a) => a.slug);
check("28 avatars", slugs.length === 28);
check("slugs unique", new Set(slugs).size === slugs.length);
check("no dealer-wanted (limited Shop drop)", !slugs.includes("dealer-wanted"));
check("no foil anywhere in the pool", slugs.every((s) => !s.includes("foil")));
check("every pool file exists (64 + 128)", slugs.every((s) => CLUBHOUSE_AVATAR_SIZES.every((z) => existsSync(join(artDir, `${s}-${z}.webp`)))));
const files = readdirSync(artDir).filter((f) => f.endsWith(".webp"));
check("no stray art (exactly pool x sizes)", files.length === slugs.length * CLUBHOUSE_AVATAR_SIZES.length);
check("no foil art on disk", readdirSync(artDir).every((f) => !/foil/i.test(f)));

console.log("2. random pick");
const rands = [0, 1e-9, 0.25, 0.5, 0.999999999, 1 - Number.EPSILON];
check("pick in pool for edge rand() values", rands.every((r) => isClubhouseAvatarSlug(randomClubhouseAvatarSlug(() => r))));
check("pick survives rand() = 1 and negatives", isClubhouseAvatarSlug(randomClubhouseAvatarSlug(() => 1)) && isClubhouseAvatarSlug(randomClubhouseAvatarSlug(() => -0.5)));
let allIn = true;
const seen = new Set<string>();
for (let i = 0; i < 5000; i++) {
  const u = randomClubhouseAvatarUrl();
  const s = clubhouseSlugFromUrl(u);
  if (!s) allIn = false;
  else seen.add(s);
}
check("5000 random URLs all parse back to a pool slug", allIn);
check("random pick reaches every avatar", seen.size === slugs.length);
check("path shape", clubhouseAvatarPath("sexton") === "/art/clubhouse-avatars/sexton-128.webp");
let threw = false;
try {
  clubhouseAvatarPath("../../etc/passwd");
} catch {
  threw = true;
}
check("path builder refuses a slug outside the pool", threw);
check("slugFromUrl: uploaded photo -> null", clubhouseSlugFromUrl("data:image/jpeg;base64,AAAA") === null);
check("slugFromUrl: Steam picture -> null", clubhouseSlugFromUrl("https://avatars.steamstatic.com/x_full.jpg") === null);
check("slugFromUrl: dealer-wanted path -> null", clubhouseSlugFromUrl("/art/clubhouse-avatars/dealer-wanted-128.webp") === null);

console.log("3. save decision");
const local = { isLocal: true, steamId: null };
const ok = decideClubhouseAvatarSave({ sameOrigin: true, signedIn: true, player: local, slug: "night-owl" });
check("local + pool slug -> saved, server-built path", ok.ok && ok.avatarUrl === "/art/clubhouse-avatars/night-owl-128.webp");
const st = (d: ReturnType<typeof decideClubhouseAvatarSave>) => (d.ok ? 200 : d.status);
check("bad origin -> 403", st(decideClubhouseAvatarSave({ sameOrigin: false, signedIn: true, player: local, slug: "night-owl" })) === 403);
check("signed out -> 401", st(decideClubhouseAvatarSave({ sameOrigin: true, signedIn: false, player: null, slug: "night-owl" })) === 401);
check("player row gone -> 404", st(decideClubhouseAvatarSave({ sameOrigin: true, signedIn: true, player: null, slug: "night-owl" })) === 404);
check("Steam player -> 403", st(decideClubhouseAvatarSave({ sameOrigin: true, signedIn: true, player: { isLocal: false, steamId: "76561198000000000" }, slug: "night-owl" })) === 403);
check("local flag but Steam-linked -> 403", st(decideClubhouseAvatarSave({ sameOrigin: true, signedIn: true, player: { isLocal: true, steamId: "76561198000000000" }, slug: "night-owl" })) === 403);
for (const bad of ["dealer-wanted", "night-owl.foil", "av.night-owl", "/art/clubhouse-avatars/night-owl-128.webp", "https://evil.example/x.png", "", null, 42, undefined]) {
  check(`unknown slug ${JSON.stringify(bad)} -> 400`, st(decideClubhouseAvatarSave({ sameOrigin: true, signedIn: true, player: local, slug: bad })) === 400);
}

console.log("4. backfill");
const photo = "data:image/jpeg;base64,AAAA";
const players: BackfillCandidate[] = [
  { id: "a", isLocal: true, steamId: null, avatarUrl: null },
  { id: "b", isLocal: true, steamId: null, avatarUrl: "" },
  { id: "c", isLocal: true, steamId: null, avatarUrl: "   " },
  { id: "photo", isLocal: true, steamId: null, avatarUrl: photo },
  { id: "chosen", isLocal: true, steamId: null, avatarUrl: "/art/clubhouse-avatars/sexton-128.webp" },
  { id: "steam", isLocal: false, steamId: "76561198000000000", avatarUrl: "https://avatars.steamstatic.com/x_full.jpg" },
  { id: "steam-noav", isLocal: false, steamId: "76561198000000001", avatarUrl: null },
];
const plan = planClubhouseAvatarBackfill(players);
check("backfills exactly the 3 local players without an avatar", plan.map((u) => u.id).join(",") === "a,b,c");
check("every backfill value is a pool path", plan.every((u) => clubhouseSlugFromUrl(u.avatarUrl) !== null));
const after = players.map((p) => ({ ...p, avatarUrl: plan.find((u) => u.id === p.id)?.avatarUrl ?? p.avatarUrl }));
check("uploaded photo untouched", after.find((p) => p.id === "photo")!.avatarUrl === photo);
check("Steam players untouched", after.filter((p) => p.steamId).every((p, i) => p.avatarUrl === players.filter((q) => q.steamId)[i].avatarUrl));
check("second run is a no-op", planClubhouseAvatarBackfill(after).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
