/**
 * GET /api/auth/logout — clear the session cookie and return to /login.
 */

import { NextResponse } from "next/server";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function GET() {
  const response = NextResponse.redirect(new URL("/login", BASE_URL));
  response.cookies.set("phatt_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
