/**
 * M2 spike — prove the Steam OpenID 2.0 path BEFORE building on it.
 *
 * next-auth v5 has no native OpenID 2.0 support and breaks on Steam, so the
 * app uses a dedicated route handler over the `openid` npm package (the same
 * library passport-steam wraps). This spike exercises the real library, the
 * real Prisma schema, and the real src/lib/crypto.ts module to de-risk the
 * three claims that are verifiable without a live Steam account:
 *
 *   1. INITIATION  — RelyingParty.authenticate() discovers Steam's OpenID
 *      endpoint over the network and returns a valid checkid_setup redirect.
 *   2. STEAMID64   — the claimed_id regex yields a 17-digit string that
 *      survives Prisma persistence with no precision loss (rule #2).
 *   3. AUTH CODE   — crypto.ts AES-256-GCM round-trips and rejects tampering,
 *      so per-user Valve auth codes can be stored encrypted at rest.
 *
 * The one leg this cannot cover offline is verifyAssertion() of a *real* Steam
 * assertion (Steam must redirect a logged-in browser back to a public callback
 * URL). That is documented as the residual live check in the issue thread.
 *
 * Run:  DATABASE_URL="file:./dev.db" node --env-file=.env scripts/spike-steam-auth.ts
 */

import Openid from "openid";
import { PrismaClient } from "@prisma/client";
import { encryptAuthCode, decryptAuthCode } from "../src/lib/crypto.ts";

const { RelyingParty } = Openid as unknown as {
  RelyingParty: new (
    returnUrl: string,
    realm: string,
    stateless: boolean,
    strict: boolean,
    extensions: unknown[],
  ) => { authenticate: (id: string, immediate: boolean, cb: (err: unknown, url: string | null) => void) => void };
};

// Same constants the live routes use.
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const RETURN_URL = `${BASE_URL}/api/auth/steam/callback`;
const STEAM_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

async function proveInitiation(): Promise<void> {
  console.log("\n[1] INITIATION — RelyingParty.authenticate() against live Steam");
  const party = new RelyingParty(RETURN_URL, BASE_URL, true, true, []);
  const url: string = await new Promise((resolve, reject) =>
    party.authenticate("https://steamcommunity.com/openid", false, (err, u) =>
      err || !u ? reject(err ?? new Error("no url")) : resolve(u),
    ),
  );
  const parsed = new URL(url);
  check("redirects to steamcommunity.com/openid/login", parsed.host === "steamcommunity.com" && parsed.pathname === "/openid/login", url.slice(0, 60) + "…");
  check("openid.mode=checkid_setup", parsed.searchParams.get("openid.mode") === "checkid_setup");
  check("openid.ns is OpenID 2.0", parsed.searchParams.get("openid.ns") === "http://specs.openid.net/auth/2.0");
  check("openid.return_to is our callback", parsed.searchParams.get("openid.return_to") === RETURN_URL, parsed.searchParams.get("openid.return_to") ?? "");
  check("openid.realm is our origin", parsed.searchParams.get("openid.realm") === BASE_URL);
}

async function proveSteamIdString(prisma: PrismaClient): Promise<void> {
  console.log("\n[2] STEAMID64 — 17-digit string survives extraction + persistence");
  // Canonical claimed_id Steam returns. Last digit '7' makes the value odd, so
  // any float64 round-trip (>2^53) corrupts it — a clean proof of why we store a string.
  const claimed = "https://steamcommunity.com/openid/id/76561198000000007";
  const m = STEAM_ID_RE.exec(claimed);
  const steamId = m?.[1] ?? "";
  check("regex extracts the id", typeof steamId === "string" && /^\d{17}$/.test(steamId), steamId);
  check("Number() would corrupt it (why string matters)", String(Number(steamId)) !== steamId, `Number→${Number(steamId)}`);

  await prisma.player.deleteMany({ where: { steamId } });
  const created = await prisma.player.create({ data: { steamId, displayName: "spike", isLocal: false } });
  const read = await prisma.player.findUniqueOrThrow({ where: { id: created.id } });
  check("persisted value is a JS string", typeof read.steamId === "string");
  check("17 digits intact after DB round-trip", read.steamId === steamId, `${read.steamId}`);
  await prisma.player.delete({ where: { id: created.id } });
}

function proveCrypto(): void {
  console.log("\n[3] AUTH CODE — crypto.ts AES-256-GCM round-trip + tamper rejection");
  const plain = "ABCD-12345-WXYZ"; // sample Valve steamidkey shape, not a real secret
  const enc = encryptAuthCode(plain);
  check("ciphertext differs from plaintext", enc !== plain && !enc.includes(plain));
  check("decrypt recovers original (server-side only)", decryptAuthCode(enc) === plain);
  let tamperRejected = false;
  try {
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    decryptAuthCode(buf.toString("base64"));
  } catch {
    tamperRejected = true;
  }
  check("tampered ciphertext is rejected (GCM integrity)", tamperRejected);
}

(async () => {
  console.log("=== HOTLINE M2 spike: Steam OpenID 2.0 path ===");
  const prisma = new PrismaClient();
  try {
    await proveInitiation();
    await proveSteamIdString(prisma);
    proveCrypto();
  } finally {
    await prisma.$disconnect();
  }
  console.log(`\n${failures === 0 ? "SPIKE PASSED — path proven, safe to build" : `SPIKE FAILED — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
