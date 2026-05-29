import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { randomName, DISPLAY_NAME_MAX } from "@/lib/local-auth-core";

/**
 * Name-prompt step for local sign-in. Server-rendered so the suggested name
 * never reveals via client JS (and the page degrades gracefully without JS).
 * The form POSTs to /api/auth/local, which performs the create + cookie set;
 * GET there now redirects back here when no session exists, which is the
 * dedup guard from PHA-839.
 */
export default async function LocalSignInPage() {
  const session = await getSession();
  if (session?.steamId) redirect("/");
  if (session?.isLocal) redirect("/");

  const suggested = randomName();

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        gap: "var(--space-6)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
        <span
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--text-hi)",
          }}
        >
          Pick a display name
        </span>
        <p style={{ color: "var(--text-mid)", fontSize: "0.875rem", textAlign: "center", maxWidth: 280, margin: 0 }}>
          This is what shows on the leaderboard. You can change it later.
        </p>
      </div>

      <form
        action="/api/auth/local"
        method="POST"
        style={{
          width: "100%",
          maxWidth: 320,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <label
          htmlFor="displayName"
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-low)",
          }}
        >
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          defaultValue={suggested}
          maxLength={DISPLAY_NAME_MAX}
          required
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            background: "var(--bg2)",
            border: "1px solid var(--bg3)",
            borderRadius: "var(--radius-md)",
            padding: "12px var(--space-4)",
            color: "var(--text-hi)",
            fontSize: "1rem",
            fontFamily: "inherit",
            minHeight: 44,
          }}
        />
        <button
          type="submit"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
            padding: "14px var(--space-6)",
            cursor: "pointer",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 700,
            fontSize: "1rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            minHeight: 44,
          }}
        >
          Start playing
        </button>
        <a
          href="/login"
          style={{
            textAlign: "center",
            fontSize: "0.8125rem",
            color: "var(--text-low)",
            textDecoration: "none",
            marginTop: "var(--space-1)",
          }}
        >
          ← Back
        </a>
      </form>
    </div>
  );
}
