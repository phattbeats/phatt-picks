"use client";

import { useEffect, useState } from "react";

/**
 * Opt-in toggle for pre-lock push reminders (handoff §8.5). Best-effort and
 * self-contained: if push is unsupported, blocked, or unconfigured, it explains
 * why instead of breaking. iOS only exposes push once the PWA is installed and
 * launched from the home screen, so we surface that hint when it applies.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Get an active service-worker registration without hanging. `serviceWorker.ready`
 * never resolves if registration failed or hasn't happened yet (PwaRegister swallows
 * its errors; some browsers/private modes block SWs entirely), which would leave the
 * UI stuck on "Checking…"/"Enabling…". We (re)register defensively — register() is
 * idempotent and returns any existing registration — then race readiness against a
 * timeout so a stuck SW surfaces as a clear, retryable error instead of a spinner.
 */
async function getReadyRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // Non-fatal here: if a registration already exists, `ready` still resolves below.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("the notification service worker didn't start")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Notification.requestPermission has two forms: a Promise (modern) and a legacy
 * callback (older macOS Safari) that returns undefined. Support both so Safari
 * users aren't silently treated as "not granted".
 */
function requestPermissionCompat(): Promise<NotificationPermission> {
  try {
    const maybe = Notification.requestPermission();
    if (maybe && typeof (maybe as Promise<NotificationPermission>).then === "function") {
      return maybe as Promise<NotificationPermission>;
    }
  } catch {
    // fall through to the callback form
  }
  return new Promise((resolve) => {
    try {
      Notification.requestPermission((p) => resolve(p));
    } catch {
      resolve(Notification.permission);
    }
  });
}

type State =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "blocked"
  | "idle" // supported, not subscribed
  | "subscribed";

const btn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  borderRadius: "var(--radius-md)",
  padding: "12px var(--space-4)",
  fontFamily: "'Rajdhani', sans-serif",
  fontWeight: 700,
  fontSize: "0.9375rem",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  minHeight: 44,
  cursor: "pointer",
  border: "none",
  width: "100%",
};

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const isIos =
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // iPadOS 13+ reports a desktop "Macintosh" UA; detect it via touch support.
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari legacy flag
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setState("unsupported");
        return;
      }
      // Step 1: fetch the VAPID key. A failure here (network/server) is transient,
      // not "unsupported" — show a retryable message instead of a dead end.
      let key: string | null;
      try {
        const res = await fetch("/api/push/public-key");
        ({ key } = (await res.json()) as { key: string | null });
      } catch {
        if (!cancelled) {
          setNote("Couldn't reach the reminders service. Reload to try again.");
          setState("idle");
        }
        return;
      }
      if (cancelled) return;
      if (!key) {
        setState("unconfigured");
        return;
      }
      setVapidKey(key);
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }

      // Step 2: read any existing subscription. If the service worker can't be
      // brought up, push is still supported — let the user tap Enable (which
      // reports the concrete reason) rather than spinning on "Checking…".
      try {
        const reg = await getReadyRegistration();
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (existing) {
          // Re-assert the subscription with the server: if the DB was reset or the
          // record was pruned, the browser still "has" a subscription but no reminder
          // would ever send. The upsert is idempotent, so this is a safe self-heal.
          fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(existing),
          }).catch(() => {});
        }
        setState(existing ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setState("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    if (!vapidKey) return;
    setBusy(true);
    setNote(null);
    try {
      const permission = await requestPermissionCompat();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "idle");
        if (permission === "default") setNote("Allow notifications when prompted to turn reminders on.");
        return;
      }

      // Decode the server's VAPID key up front. A quote-wrapped/truncated key
      // (a known Unraid env gotcha) fails here — call it out clearly rather than
      // letting it surface as a generic "subscribe failed" later.
      let appServerKey: Uint8Array;
      try {
        appServerKey = urlBase64ToUint8Array(vapidKey);
      } catch {
        setNote("Reminders are misconfigured on the server (bad notification key). We're on it.");
        return;
      }

      const reg = await getReadyRegistration();

      // Subscribe. If a stale subscription with a different key already exists
      // (e.g. the server's VAPID key was rotated), the browser throws
      // InvalidStateError — drop the old one and try once more.
      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Uint8Array is a valid BufferSource at runtime; the cast sidesteps the
          // SharedArrayBuffer-vs-ArrayBuffer strictness in lib.dom.
          applicationServerKey: appServerKey as BufferSource,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "InvalidStateError") {
          const stale = await reg.pushManager.getSubscription();
          await stale?.unsubscribe().catch(() => {});
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey as BufferSource,
          });
        } else {
          throw err;
        }
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) {
        // Saving the subscription failed — surface why so it's diagnosable. 401
        // means the session lapsed (sign in again); anything else is a server error.
        throw new Error(res.status === 401 ? "your session expired — sign in again" : `server error ${res.status}`);
      }
      setState("subscribed");
      setNote("Reminders on. You'll get a 24-hour and 1-hour warning before each stage locks.");
    } catch (err) {
      // Include the concrete reason: the generic message hid real failures
      // (blocked push service, bad key, lapsed session) and made this unfixable.
      const reason =
        err instanceof DOMException ? err.name : err instanceof Error ? err.message : "unknown error";
      setNote(`Couldn't enable reminders (${reason}). Try again, or check notification settings.`);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await getReadyRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("idle");
      setNote("Reminders off.");
    } catch {
      setNote("Couldn't turn reminders off just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; sent?: number; reason?: string };
      if (data.ok && (data.sent ?? 0) > 0) setNote("Test reminder sent — check your notifications.");
      else if (data.reason === "push-not-configured") setNote("Push isn't configured on the server.");
      else if (data.reason === "rate-limited") setNote("Easy — wait a moment before sending another test.");
      else setNote("No active device to send to. Re-enable reminders and try again.");
    } catch {
      setNote("Couldn't send the test reminder.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <p style={{ color: "var(--text-low)", fontSize: "0.8125rem" }}>Checking notifications…</p>;
  }
  if (state === "unsupported") {
    return (
      <p style={{ color: "var(--text-low)", fontSize: "0.8125rem" }}>
        This browser can&apos;t do push reminders.
        {isIos && !isStandalone && " On iPhone/iPad, add HOTLINE to your Home Screen first, then open it from that icon."}
      </p>
    );
  }
  if (state === "unconfigured") {
    return (
      <p style={{ color: "var(--text-low)", fontSize: "0.8125rem" }}>
        Push reminders aren&apos;t set up on the server yet.
      </p>
    );
  }
  if (state === "blocked") {
    return (
      <p style={{ color: "var(--closing-soon)", fontSize: "0.8125rem" }}>
        Notifications are blocked. Enable them for this site in your browser settings, then reload.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {isIos && !isStandalone && (
        <p style={{ color: "var(--closing-soon)", fontSize: "0.8125rem", margin: 0 }}>
          iPhone/iPad: add to Home Screen and open from that icon first, or reminders won&apos;t arrive.
        </p>
      )}
      {state === "idle" ? (
        <button
          onClick={subscribe}
          disabled={busy}
          style={{ ...btn, background: "var(--accent)", color: "#fff", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Enabling…" : "Enable pre-lock reminders"}
        </button>
      ) : (
        <>
          <button
            onClick={sendTest}
            disabled={busy}
            style={{ ...btn, background: "var(--bg2)", border: "1px solid var(--info)", color: "var(--info)", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Working…" : "Send a test reminder"}
          </button>
          <button
            onClick={unsubscribe}
            disabled={busy}
            style={{ ...btn, background: "transparent", border: "1px solid var(--bg3)", color: "var(--text-mid)", opacity: busy ? 0.6 : 1 }}
          >
            Turn off reminders
          </button>
        </>
      )}
      {note && <p style={{ color: "var(--text-mid)", fontSize: "0.8125rem", margin: 0 }}>{note}</p>}
    </div>
  );
}
