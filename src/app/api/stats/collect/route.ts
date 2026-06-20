import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSameOrigin } from "@/lib/csrf";
import { clientIpFromForwarded, trustedProxyHops } from "@/lib/security-core";
import { prisma } from "@/lib/db";
import {
  deviceClass,
  browserFamily,
  osFamily,
  sanitizePath,
  sanitizeReferrer,
  sanitizeCountry,
  sanitizeEvent,
  sanitizeLabel,
  scrollBucket,
} from "@/lib/analytics-core";

/**
 * Built-in analytics collector (PHA-1277). Receives the inline tracker's beacon
 * and records ONE anonymous row — a pageview, or a named in-app event. Privacy
 * by construction:
 *   - no PII stored: no IP, no user id, no query strings, no cookies;
 *   - the only visitor id is a DAILY-ROTATING salted hash of IP+UA (one-way,
 *     resets every day → unique-visitor/session counting without cross-day
 *     tracking; the raw IP is hashed and discarded, never stored);
 *   - coarse device/browser/OS, country (2-letter, from Cloudflare — never the
 *     IP), and external referrer host only.
 * Honors Do-Not-Track server-side as a backstop to the tracker. Self-hosted: a
 * route in the app itself, so the whole stack stays in the one app container.
 *
 * Abuse controls (this is a public endpoint and isSameOrigin fails open when both
 * Origin and Referer are absent, so it can't be the only gate): a small body-size
 * cap rejects oversized payloads before parsing, and a per-visitor fixed-window
 * limit bounds insert spam. Cloudflare's edge WAF is the primary DoS defense;
 * these are defense-in-depth so a header-less curl loop can't fill the SQLite db.
 */

const MAX_BODY_BYTES = 2_048; // a beacon is ~100 bytes; nothing legitimate is bigger
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60; // inserts per IP per minute — far above real navigation

const rate = new Map<string, { window: number; count: number }>();
/** Fixed-window per-IP limiter. Returns true if this insert is allowed. Keyed on
 *  the raw IP (not the IP+UA visitor hash) so rotating the User-Agent from one IP
 *  can't mint a fresh bucket per request. Memory is bounded by evicting only
 *  stale-window keys — never by clearing live counters, which would briefly lift
 *  the cap for everyone under spam. The key is in-memory + ephemeral, never
 *  stored. CF's edge WAF remains the primary volumetric DoS defense. */
function allow(key: string, now: number): boolean {
  const window = Math.floor(now / RATE_WINDOW_MS);
  if (rate.size > 5_000) {
    for (const [k, v] of rate) if (v.window < window) rate.delete(k);
  }
  const cur = rate.get(key);
  if (!cur || cur.window !== window) {
    rate.set(key, { window, count: 1 });
    return true;
  }
  if (cur.count >= RATE_MAX) return false;
  cur.count += 1;
  return true;
}

// Internal hosts whose referrers are same-site navigation, not a real referrer.
const SELF_HOSTS = new Set(["hotline.phatt.vip", "pickems.phatt.vip"]);

/** Daily-rotating one-way visitor id. The date in the salt means yesterday's
 *  hash can't be reproduced today, so visitors aren't linkable across days. */
function visitorHash(ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const secret = process.env.NEXTAUTH_SECRET ?? "hotline";
  const salt = createHash("sha256").update(`${secret}:${day}`).digest("hex");
  return createHash("sha256").update(`${salt}:${ip}:${ua}`).digest("hex").slice(0, 24);
}

export async function POST(req: NextRequest) {
  if (req.headers.get("dnt") === "1") {
    return new NextResponse(null, { status: 204 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }

  // Reject oversized bodies. Content-Length is the fast path (present on most
  // clients); sendBeacon Blobs may omit it, so raw.length below is the real
  // backstop after reading.
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, reason: "too-large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-body" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, reason: "too-large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }

  const { path, referrer, event, label, scroll } = (body ?? {}) as Record<string, unknown>;
  const cleanPath = sanitizePath(path);
  if (!cleanPath) {
    return NextResponse.json({ ok: false, reason: "bad-path" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";

  // Real client IP (Cloudflare's cf-connecting-ip is the most reliable behind CF
  // and is overwritten by CF for public traffic; fall back to the right-most
  // trusted XFF / x-real-ip, using the same hop count as the rest of the app).
  // Used ONLY to derive the daily hash + rate-limit key — never stored.
  const ip =
    req.headers.get("cf-connecting-ip") ??
    clientIpFromForwarded(
      req.headers.get("x-forwarded-for"),
      req.headers.get("x-real-ip"),
      trustedProxyHops(),
    ) ??
    "0.0.0.0";

  if (!allow(ip, Date.now())) {
    return new NextResponse(null, { status: 204 }); // silently drop spam
  }

  // A named event (disclosure_open, scroll, …) or a plain pageview. If the client
  // sent an `event` field that fails validation, drop it — don't silently record
  // it as a phantom pageview.
  const evName = sanitizeEvent(event);
  if (event != null && event !== "" && !evName) {
    return new NextResponse(null, { status: 204 });
  }
  let evLabel = sanitizeLabel(label);
  if (evName === "scroll") {
    const b = scrollBucket(scroll);
    if (!b) return new NextResponse(null, { status: 204 }); // sub-25% → not worth a row
    evLabel = String(b);
  }

  // External referrer host only — null for any of our own hosts (same-site nav).
  let refHost = sanitizeReferrer(referrer, "");
  if (refHost && SELF_HOSTS.has(refHost)) refHost = null;

  const visitor = visitorHash(ip, ua);

  await prisma.pageView.create({
    data: {
      path: cleanPath,
      device: deviceClass(ua),
      browser: browserFamily(ua),
      os: osFamily(ua),
      country: sanitizeCountry(req.headers.get("cf-ipcountry")),
      referrer: refHost,
      event: evName,
      label: evName ? evLabel : null,
      visitor,
    },
  });

  return new NextResponse(null, { status: 204 });
}
