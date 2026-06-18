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
 * CPU SAFETY (PHA-1244). A previous version's poll loop exited ONLY on
 * req.signal.aborted, and its sole controller.enqueue() lived inside the same
 * try/catch that swallowed "transient DB errors" — so a write to an already-
 * disconnected client was silently ignored and the loop polled the DB forever.
 * Every EventSource reconnect (full reload, tab close, mobile backgrounding,
 * network blip) leaked another immortal loop, and on a single-threaded Node
 * process the accumulated zombies pinned the CPU. Hardening, in layers:
 *   1. cancel() flips `closed` — the most reliable disconnect signal in the
 *      Next.js standalone runtime (fires when the response body is torn down).
 *   2. Every enqueue goes through safeEnqueue(); a throw means the peer is gone,
 *      so we mark `closed` and break instead of treating it as a DB hiccup.
 *   3. MAX_LIFETIME_MS caps any single connection; the browser's EventSource
 *      auto-reconnects, so even if (1) and (2) ever failed, loops self-terminate.
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { buildPlayerFeed } from "../route";
import type { FeedView } from "@/lib/notifications-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 8_000;
const KEEPALIVE_MS = 25_000;
// Recycle every connection after this long so a missed disconnect signal can
// never produce an immortal poll loop. EventSource reconnects automatically.
const MAX_LIFETIME_MS = 10 * 60_000;

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

  // `closed` is the single source of truth for "stop polling". It is flipped by
  // cancel() (client disconnect), by req.signal abort, by a failed enqueue, and
  // by the lifetime cap. The loop and the sleep both observe it.
  let closed = false;
  let wakeFromSleep: (() => void) | null = null;
  const markClosed = () => {
    closed = true;
    wakeFromSleep?.();
  };

  req.signal.addEventListener("abort", markClosed, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let lastFingerprint = "";
      let lastKeepaliveAt = Date.now();

      // Enqueue that reports failure instead of throwing. A throw here means the
      // consumer is gone (controller errored/closed) — the definitive "client
      // disconnected" signal — so we shut the loop down.
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          markClosed();
          return false;
        }
      };

      // Sleep that resolves early the instant the connection closes, so a
      // disconnect is acted on immediately rather than after up to POLL_MS.
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          if (closed) return resolve();
          const t = setTimeout(() => {
            wakeFromSleep = null;
            resolve();
          }, ms);
          wakeFromSleep = () => {
            clearTimeout(t);
            wakeFromSleep = null;
            resolve();
          };
        });

      // Initial feed — fast first paint for the bell.
      try {
        const feed = await buildPlayerFeed(playerId, 30);
        lastFingerprint = feedFingerprint(feed);
        if (!safeEnqueue(sseEvent("init", feed))) {
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
      } catch {
        try { controller.close(); } catch { /* already closed */ }
        return;
      }

      while (!closed) {
        await sleep(POLL_MS);
        if (closed) break;

        // Bound total connection lifetime regardless of disconnect detection.
        if (Date.now() - startedAt >= MAX_LIFETIME_MS) break;

        const now = Date.now();
        let feed: FeedView;
        try {
          feed = await buildPlayerFeed(playerId, 30);
        } catch {
          // Genuine DB hiccup: stay alive, retry next tick. A failed keepalive
          // enqueue (peer gone) trips safeEnqueue → closed → loop exits.
          if (now - lastKeepaliveAt >= KEEPALIVE_MS) {
            lastKeepaliveAt = now;
            if (!safeEnqueue(ssePing())) break;
          }
          continue;
        }

        const fp = feedFingerprint(feed);
        if (fp !== lastFingerprint) {
          lastFingerprint = fp;
          lastKeepaliveAt = now;
          if (!safeEnqueue(sseEvent("update", feed))) break;
        } else if (now - lastKeepaliveAt >= KEEPALIVE_MS) {
          lastKeepaliveAt = now;
          if (!safeEnqueue(ssePing())) break;
        }
      }

      try { controller.close(); } catch { /* already closed */ }
    },

    // Fires when the client disconnects and the response body is torn down —
    // the most reliable disconnect signal in the standalone runtime.
    cancel() {
      markClosed();
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
