/**
 * Steam OpenID 2.0 callback handler.
 * Verifies assertion, upserts Player, issues session cookie.
 *
 * SteamID64 (17+ digits) is extracted as a string and never cast to Number.
 */

import { NextRequest, NextResponse } from "next/server";
import Openid from "openid";
import { prisma } from "@/lib/db";
import { attributeReferral } from "@/lib/invite";
import { signSessionToken, sessionCookieOptions } from "@/lib/session-core";

const { RelyingParty } = Openid;
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const RETURN_URL = `${BASE_URL}/api/auth/steam/callback`;
const REALM = BASE_URL;

const STEAM_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

function requireSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return secret;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.toString();
  const party = new RelyingParty(RETURN_URL, REALM, true, true, []);

  return new Promise<NextResponse>((resolve) => {
    party.verifyAssertion(url, async (err, result) => {
      if (err || !result?.authenticated || !result.claimedIdentifier) {
        resolve(
          NextResponse.redirect(new URL("/login/auth?error=steam_auth_failed", BASE_URL))
        );
        return;
      }

      const match = STEAM_ID_RE.exec(result.claimedIdentifier);
      if (!match) {
        resolve(NextResponse.redirect(new URL("/login/auth?error=invalid_steam_id", BASE_URL)));
        return;
      }

      // steamId is always a string — 17 digits, never a JS number
      const steamId = match[1];

      try {
        // Fetch Steam profile for display name + avatar
        const apiKey = process.env.STEAM_API_KEY;
        let displayName = `Steam:${steamId.slice(-4)}`;
        let avatarUrl: string | undefined;

        if (apiKey) {
          const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`;
          const profileRes = await fetch(profileUrl, { next: { revalidate: 300 } });
          if (profileRes.ok) {
            const data = await profileRes.json();
            const player = data?.response?.players?.[0];
            if (player) {
              displayName = player.personaname ?? displayName;
              avatarUrl = player.avatarfull ?? undefined;
            }
          }
        }

        // Distinguish a brand-new Steam player from a returning one so we only
        // attribute a referral once, at first sign-in.
        const existing = await prisma.player.findUnique({
          where: { steamId },
          select: { id: true },
        });

        const player = await prisma.player.upsert({
          where: { steamId },
          update: { displayName, avatarUrl, isLocal: false },
          create: { steamId, displayName, avatarUrl, isLocal: false },
        });

        // Referral attribution for first-time Steam players — best-effort.
        if (!existing) {
          try {
            await attributeReferral(player.id, req.cookies.get("hotline_ref")?.value);
          } catch (refErr) {
            console.error("Referral attribution error (steam):", refErr);
          }
        }

        // Issue a session JWT. PHA-982: 30-day TTL (was 7d) and sliding —
        // the middleware re-stamps an active session, so a Steam user (who
        // eats a 2FA prompt on every re-login) is effectively never bounced
        // back through Steam while they keep using the app.
        const token = await signSessionToken(
          { sub: player.id, steamId, displayName },
          requireSecret(),
        );

        const response = NextResponse.redirect(new URL("/", BASE_URL));
        response.cookies.set(
          "phatt_session",
          token,
          sessionCookieOptions(process.env.NODE_ENV === "production"),
        );
        // Referral consumed (or no-op) — clear the capture cookie.
        response.cookies.set("hotline_ref", "", { path: "/", maxAge: 0 });

        resolve(response);
      } catch (dbErr) {
        console.error("Steam callback DB error:", dbErr);
        resolve(NextResponse.redirect(new URL("/login/auth?error=db_error", BASE_URL)));
      }
    });
  });
}
