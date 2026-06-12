/**
 * Steam OpenID 2.0 sign-in initiation.
 *
 * next-auth v5 has no native OpenID 2.0 support and breaks on Steam.
 * This is a custom route handler using the openid npm package.
 *
 * Flow:
 * 1. GET /api/auth/steam → redirect to Steam login
 * 2. Steam redirects to /api/auth/steam/callback
 * 3. Callback verifies and upserts Player, sets session cookie
 */

import { NextResponse } from "next/server";
import Openid from "openid";

const { RelyingParty } = Openid;

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const RETURN_URL = `${BASE_URL}/api/auth/steam/callback`;
const REALM = BASE_URL;

export async function GET() {
  const party = new RelyingParty(RETURN_URL, REALM, true, true, []);

  return new Promise<NextResponse>((resolve) => {
    party.authenticate("https://steamcommunity.com/openid", false, (err, url) => {
      if (err || !url) {
        resolve(
          NextResponse.json({ error: "Steam auth initiation failed", detail: String(err) }, { status: 500 })
        );
      } else {
        resolve(NextResponse.redirect(url));
      }
    });
  });
}
