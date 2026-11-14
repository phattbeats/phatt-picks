/**
 * verify-phatt-id — offline proof for PHA-4101 (PHATT ID sign-in, Steam linking, arcade hook signature).
 * Run: node scripts/verify-phatt-id.ts
 */
import { decideLink, steamClaim, verifyHookSig, hookSign, isPhattIdSub, phattIdDisplayName } from "../src/lib/phatt-id-core.ts";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean) => { if (c) pass++; else { fail++; console.error("FAIL", name); } };
const SUB = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c", OTHER = "11111111-2222-4333-8444-555555555555";
const STEAM = "76561198000000001";

ok("linked sub wins", decideLink(SUB, STEAM, { id: "p1", phattIdSub: SUB }, { id: "p2", phattIdSub: null }).kind === "existing");
const l = decideLink(SUB, STEAM, null, { id: "p2", phattIdSub: null });
ok("existing Steam player linked, not re-created", l.kind === "link-steam" && l.playerId === "p2");
ok("Steam player of another PHATT ID never taken", decideLink(SUB, STEAM, null, { id: "p2", phattIdSub: OTHER }).kind === "conflict");
const c = decideLink(SUB, null, null, null);
ok("no match -> create without steam", c.kind === "create" && c.steamId === null);
ok("steam claim must be 17-digit string", steamClaim({ steam: STEAM }) === STEAM && steamClaim({ steam: 76561198000000001 }) === null && steamClaim({ steam: "" }) === null && steamClaim({}) === null);
ok("sub must be uuid", isPhattIdSub(SUB) && !isPhattIdSub("123") && !isPhattIdSub(undefined));
ok("display name = username", phattIdDisplayName({ preferred_username: "phattbeats", name: "Brandon X" }, SUB) === "phattbeats");

const secrets = { k1: "s3cret" };
const now = 1_800_000_000_000, ts = String(now / 1000), body = JSON.stringify({ sub: SUB });
const sig = hookSign("s3cret", ts, body);
ok("good signature", verifyHookSig(secrets, "k1", ts, sig, body, now));
ok("tampered body", !verifyHookSig(secrets, "k1", ts, sig, body + " ", now));
ok("unknown kid", !verifyHookSig(secrets, "k2", ts, sig, body, now));
ok("stale ts", !verifyHookSig(secrets, "k1", ts, sig, body, now + 6 * 60_000));
ok("no secrets configured fails closed", !verifyHookSig({}, "k1", ts, sig, body, now));
// Cross-check against the arcade's exact formula (phattbeats/arcade src/auth.js `sign`).
import { createHmac } from "node:crypto";
ok("matches arcade sign()", sig === createHmac("sha256", "s3cret").update(`${ts}.${body}`).digest("base64url"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
