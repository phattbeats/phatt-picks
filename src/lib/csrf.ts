/**
 * Same-origin (CSRF) guard for cookie-authed mutating routes (PHA-1045).
 *
 * The audit asked for an Origin/Referer allowlist on mutating routes, not just
 * logout: any state-changing POST that authenticates via the session cookie can
 * be driven cross-site. JSON-body routes are already shielded by the CORS
 * preflight (a cross-site `application/json` POST is blocked before it reaches
 * us), but a "simple" POST — no body or a form content-type — sails through, so
 * we check the request's own origin here.
 *
 * Thin next-aware wrapper over the pure helpers in security-core so routes share
 * one definition of "our origin" (the request's own origin plus NEXTAUTH_URL)
 * while the matching logic stays unit-testable without next/prisma.
 */

import { NextRequest } from "next/server";
import { isAllowedOrigin, parseAllowedOrigins } from "@/lib/security-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/** True when the request's Origin/Referer is one of our own origins. */
export function isSameOrigin(req: NextRequest): boolean {
  return isAllowedOrigin(
    req.headers.get("origin"),
    req.headers.get("referer"),
    parseAllowedOrigins(req.nextUrl.origin, BASE_URL),
  );
}
