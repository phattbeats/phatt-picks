import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { deviceClass, sanitizePath, sanitizeReferrer } from "@/lib/analytics-core";

/**
 * Built-in pageview collector (PHA-1277). Receives the tiny inline tracker's
 * beacon and records ONE anonymous row. No PII: no IP, no session, no user id —
 * only a normalized internal path, a coarse device class, and an external
 * referrer host. Honors Do-Not-Track server-side as a backstop to the tracker.
 *
 * Self-hosted by definition: this is a route in the app itself, so the whole
 * analytics stack lives inside the single app container.
 */
export async function POST(req: NextRequest) {
  // Do-Not-Track backstop — silently accept, store nothing.
  if (req.headers.get("dnt") === "1") {
    return new NextResponse(null, { status: 204 });
  }
  // Same-origin guard so other sites can't spam fake pageviews.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }

  const { path, referrer } = (body ?? {}) as Record<string, unknown>;
  const cleanPath = sanitizePath(path);
  if (!cleanPath) {
    return NextResponse.json({ ok: false, reason: "bad-path" }, { status: 400 });
  }

  await prisma.pageView.create({
    data: {
      path: cleanPath,
      device: deviceClass(req.headers.get("user-agent")),
      referrer: sanitizeReferrer(referrer),
    },
  });

  return new NextResponse(null, { status: 204 });
}
