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
import {
  isAllowedOrigin,
  parseAllowedOrigins,
  hostOriginVariants,
} from "@/lib/security-core";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/**
 * True when the request's Origin/Referer is one of our own origins.
 *
 * The allowed set blends three sources so the guard tracks how the app is really
 * reached: the request's own origin, the configured NEXTAUTH_URL, and BOTH
 * scheme variants of the forwarded Host. The last one matters behind the TLS-
 * terminating proxy (PHA-1225): the container sees http while the browser uses
 * https, so without the https variant a genuine same-origin sign-out 403'd.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const forwardedHost =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return isAllowedOrigin(
    req.headers.get("origin"),
    req.headers.get("referer"),
    parseAllowedOrigins(
      req.nextUrl.origin,
      BASE_URL,
      ...hostOriginVariants(forwardedHost),
    ),
  );
}
