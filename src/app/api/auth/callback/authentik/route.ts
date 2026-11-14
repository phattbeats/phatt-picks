/**
 * PHA-4101: PHATT ID callback. Verifies the id_token, then links (see decideLink in phatt-id-core):
 * existing PHATT ID player -> existing Steam player with the same SteamID64 -> new player.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { attributeReferral } from "@/lib/invite";
import { signSessionToken, sessionCookieOptions } from "@/lib/session-core";
import { phattIdConfig, exchangeAndVerify } from "@/lib/phatt-id";
import { decideLink, isPhattIdSub, phattIdDisplayName, steamClaim } from "@/lib/phatt-id-core";
import { syncPlayerToArcade } from "@/lib/arcade-sync";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const fail = (code: string) => {
  const r = NextResponse.redirect(new URL(`/login/auth?error=${code}`, BASE_URL));
  r.cookies.set("phatt_oidc", "", { path: "/api/auth/callback/authentik", maxAge: 0 });
  return r;
};

export async function GET(req: NextRequest) {
  const cfg = phattIdConfig();
  if (!cfg) return NextResponse.json({ error: "phatt_id_not_configured" }, { status: 404 });
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return fail("db_error");

  const q = req.nextUrl.searchParams;
  let saved: { state?: string; nonce?: string; verifier?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get("phatt_oidc")?.value ?? "{}");
  } catch {}
  const code = q.get("code");
  if (q.get("error") || !code || !saved.state || q.get("state") !== saved.state || !saved.nonce || !saved.verifier) {
    return fail("phatt_id_auth_failed");
  }

  let claims: Record<string, unknown>;
  try {
    claims = (await exchangeAndVerify(cfg, code, saved.verifier, saved.nonce)) as Record<string, unknown>;
  } catch (e) {
    console.error("PHATT ID token verify failed:", (e as Error).message);
    return fail("phatt_id_auth_failed");
  }
  const sub = claims.sub;
  if (!isPhattIdSub(sub)) return fail("phatt_id_auth_failed");
  const steamId = steamClaim(claims);

  try {
    const [bySub, bySteam] = await Promise.all([
      prisma.player.findUnique({ where: { phattIdSub: sub }, select: { id: true, phattIdSub: true } }),
      steamId ? prisma.player.findUnique({ where: { steamId }, select: { id: true, phattIdSub: true } }) : null,
    ]);
    const d = decideLink(sub, steamId, bySub, bySteam);
    if (d.kind === "conflict") return fail("steam_linked_elsewhere");

    let player;
    if (d.kind === "create") {
      player = await prisma.player.create({
        data: { phattIdSub: sub, steamId: d.steamId, displayName: phattIdDisplayName(claims, sub), isLocal: !d.steamId },
        // no Steam link yet -> plays like a local player (unsynced picks) until Steam is linked
      });
      try {
        await attributeReferral(player.id, req.cookies.get("hotline_ref")?.value);
      } catch (refErr) {
        console.error("Referral attribution error (phatt-id):", refErr);
      }
    } else {
      // existing / link-steam: keep the player's name, picks and history; only stamp the link.
      player = await prisma.player.update({
        where: { id: d.playerId },
        data: { phattIdSub: sub },
      });
      if (d.kind === "link-steam") console.log(`PHATT ID linked to existing Steam player ${player.id}`);
    }
    // PHA-4506: bring this player's Hotline progression onto their PHATT ID now, not at the next hourly sweep.
    // Fire-and-forget: sign-in never waits on the arcade, and a failure is retried by the sweep.
    void syncPlayerToArcade(player.id).catch((e) => console.error("[arcade-sync] sign-in sync failed:", (e as Error).message));

    const token = await signSessionToken(
      player.steamId
        ? { sub: player.id, displayName: player.displayName, steamId: player.steamId }
        : { sub: player.id, displayName: player.displayName, isLocal: player.isLocal },
      secret,
    );
    const res = NextResponse.redirect(new URL("/", BASE_URL));
    res.cookies.set("phatt_session", token, sessionCookieOptions(process.env.NODE_ENV === "production"));
    res.cookies.set("hotline_ref", "", { path: "/", maxAge: 0 });
    res.cookies.set("phatt_oidc", "", { path: "/api/auth/callback/authentik", maxAge: 0 });
    return res;
  } catch (dbErr) {
    console.error("PHATT ID callback DB error:", dbErr);
    return fail("db_error");
  }
}
