/**
 * Steam OpenID 2.0 callback handler.
 * Verifies assertion, upserts Player, issues session cookie.
 *
 * SteamID64 (17+ digits) is extracted as a string and never cast to Number.
 */

import { NextRequest, NextResponse } from "next/server";
import Openid from "openid";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";

const { RelyingParty } = Openid;
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const RETURN_URL = `${BASE_URL}/api/auth/steam/callback`;
const REALM = BASE_URL;

const STEAM_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

function getSessionSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return new TextEncoder().encode(secret);
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

        const player = await prisma.player.upsert({
          where: { steamId },
          update: { displayName, avatarUrl, isLocal: false },
          create: { steamId, displayName, avatarUrl, isLocal: false },
        });

        // Issue a session JWT (short-lived, HttpOnly, SameSite=Lax)
        const token = await new SignJWT({ sub: player.id, steamId, displayName })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .sign(getSessionSecret());

        const response = NextResponse.redirect(new URL("/", BASE_URL));
        response.cookies.set("phatt_session", token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
          secure: process.env.NODE_ENV === "production",
        });

        resolve(response);
      } catch (dbErr) {
        console.error("Steam callback DB error:", dbErr);
        resolve(NextResponse.redirect(new URL("/login/auth?error=db_error", BASE_URL)));
      }
    });
  });
}
