/**
 * SSE stream for real-time notification delivery (PHA-1241).
 *
 * GET /api/notifications/stream — persistent text/event-stream connection per
 * signed-in player. Replaces the 45s client-side poll in NotificationBell with
 * instant badge + feed updates; the bell shows in-app toasts on new arrivals.
 *
 * Protocol:
 *   event: init   data: <FeedView JSON>   — sent immediately on connect
 *   event: update data: <FeedView JSON>   — sent when the feed fingerprint changes
 *   ": ping\n\n"                          — keepalive comment every 25s
 *
 * The stream polls the DB every 8 seconds. A "change" is any difference in the
 * unread count or the set of item ids + their isNew flags — generatedAtMs is
 * excluded from the fingerprint so a no-op tick doesn't spam the wire.
 *
 * Client disconnects are detected via req.signal. On abort the while-loop exits
 * on the next iteration (max 8s latency before cleanup).
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { buildPlayerFeed } from "../route";
import type { FeedView } from "@/lib/notifications-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 8_000;
const KEEPALIVE_MS = 25_000;

const enc = new TextEncoder();

function sseEvent(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function ssePing(): Uint8Array {
  return enc.encode(`: ping\n\n`);
}

function feedFingerprint(feed: FeedView): string {
  return `${feed.unread}:${feed.items.map((i) => `${i.id}:${i.isNew}`).join(",")}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const playerId = session.playerId;

  const abortPromise = new Promise<void>((resolve) => {
    req.signal.addEventListener("abort", () => resolve(), { once: true });
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send initial feed immediately so the bell loads fast.
      let lastFingerprint = "";
      let lastKeepaliveAt = Date.now();

      try {
        const feed = await buildPlayerFeed(playerId, 30);
        lastFingerprint = feedFingerprint(feed);
        controller.enqueue(sseEvent("init", feed));
      } catch {
        controller.close();
        return;
      }

      // Poll loop: check for changes, send update or keepalive.
      while (!req.signal.aborted) {
        // Wait POLL_MS or until the client disconnects — whichever comes first.
        await Promise.race([
          new Promise<void>((r) => setTimeout(r, POLL_MS)),
          abortPromise,
        ]);

        if (req.signal.aborted) break;

        const now = Date.now();
        try {
          const feed = await buildPlayerFeed(playerId, 30);
          const fp = feedFingerprint(feed);
          if (fp !== lastFingerprint) {
            lastFingerprint = fp;
            lastKeepaliveAt = now;
            controller.enqueue(sseEvent("update", feed));
          } else if (now - lastKeepaliveAt >= KEEPALIVE_MS) {
            lastKeepaliveAt = now;
            controller.enqueue(ssePing());
          }
        } catch {
          // Transient DB error: send a ping to stay alive and retry next tick.
          if (now - lastKeepaliveAt >= KEEPALIVE_MS) {
            lastKeepaliveAt = now;
            try { controller.enqueue(ssePing()); } catch { break; }
          }
        }
      }

      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
