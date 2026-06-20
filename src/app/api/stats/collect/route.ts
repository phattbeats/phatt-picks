import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSameOrigin } from "@/lib/csrf";
import { clientIpFromForwarded } from "@/lib/security-core";
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
 */

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }

  const { path, referrer, event, label, scroll } = (body ?? {}) as Record<string, unknown>;
  const cleanPath = sanitizePath(path);
  if (!cleanPath) {
    return NextResponse.json({ ok: false, reason: "bad-path" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  const selfHost = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();

  // Real client IP (Cloudflare's cf-connecting-ip is the most reliable behind
  // CF; fall back to the right-most trusted XFF / x-real-ip). Used ONLY to derive
  // the daily hash — never stored.
  const ip =
    req.headers.get("cf-connecting-ip") ??
    clientIpFromForwarded(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip"), 1) ??
    "0.0.0.0";

  // A named event (disclosure_open, scroll, …) or a plain pageview.
  const evName = sanitizeEvent(event);
  let evLabel = sanitizeLabel(label);
  if (evName === "scroll") {
    const b = scrollBucket(scroll);
    if (!b) return new NextResponse(null, { status: 204 }); // sub-25% → not worth a row
    evLabel = String(b);
  }

  await prisma.pageView.create({
    data: {
      path: cleanPath,
      device: deviceClass(ua),
      browser: browserFamily(ua),
      os: osFamily(ua),
      country: sanitizeCountry(req.headers.get("cf-ipcountry")),
      referrer: sanitizeReferrer(referrer, selfHost || undefined),
      event: evName,
      label: evName ? evLabel : null,
      visitor: visitorHash(ip, ua),
    },
  });

  return new NextResponse(null, { status: 204 });
}
