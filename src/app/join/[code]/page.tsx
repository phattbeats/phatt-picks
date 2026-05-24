import { resolveInvite } from "@/lib/invite";

/**
 * Public invite landing — the link a friend opens to onboard unaided (DoD).
 * Resolves the inviter, pitches the app in one line, and offers both onboarding
 * paths: free local play (the default) and Steam sync. No auth required to view.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const inviter = await resolveInvite(code);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        gap: "var(--space-8)",
      }}
    >
      {/* Hero */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)" }}>
        <svg width="64" height="64" viewBox="0 0 40 40" fill="none">
          <line x1="6" y1="10" x2="12" y2="10" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="16" x2="12" y2="16" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="24" x2="12" y2="24" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="30" x2="12" y2="30" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="13" x2="18" y2="13" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="27" x2="18" y2="27" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <line x1="18" y1="20" x2="24" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="26" cy="20" r="3" fill="#ef4444" />
          <line x1="28" y1="20" x2="34" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <p
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--accent)",
            margin: 0,
          }}
        >
          You&apos;re invited
        </p>
        <h1
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: "1.75rem",
            fontWeight: 700,
            letterSpacing: "0.02em",
            textAlign: "center",
            color: "var(--text-hi)",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {inviter ? (
            <>
              <span style={{ color: "var(--accent)" }}>{inviter.displayName}</span> wants you on phaTT Picks
            </>
          ) : (
            <>Join phaTT Picks</>
          )}
        </h1>
        <p style={{ color: "var(--text-mid)", fontSize: "0.9375rem", textAlign: "center", maxWidth: 320, margin: 0 }}>
          Call the CS2 Major. Pick who goes 3-0, who busts, who lifts the trophy at IEM Cologne 2026 —
          and settle it on a shared leaderboard.
        </p>
      </div>

      {/* Onboarding paths */}
      <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <a
          href="/api/auth/local"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent)",
            color: "#fff",
            borderRadius: "var(--radius-md)",
            padding: "14px var(--space-6)",
            textDecoration: "none",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 700,
            fontSize: "1rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            minHeight: 44,
          }}
        >
          Start playing — no Steam needed
        </a>
        <a
          href="/api/auth/steam"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            background: "var(--bg2)",
            border: "1px solid var(--bg3)",
            color: "var(--text-mid)",
            borderRadius: "var(--radius-md)",
            padding: "14px var(--space-6)",
            textDecoration: "none",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 600,
            fontSize: "1rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            minHeight: 44,
          }}
        >
          Sign in with Steam
        </a>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", maxWidth: 320 }}>
        <p style={{ color: "var(--text-low)", fontSize: "0.75rem", textAlign: "center", margin: 0 }}>
          Local play is fully featured. Steam sync mirrors your official Valve Pick&apos;Em —{" "}
          <a href="/help/auth-code" style={{ color: "var(--text-mid)" }}>
            see how
          </a>
          .
        </p>
        <p style={{ color: "var(--text-low)", fontSize: "0.75rem", textAlign: "center", margin: 0 }}>
          iPhone: tap Share → Add to Home Screen, then open phaTT Picks from that icon to get
          pick-lock reminders.
        </p>
      </div>
    </div>
  );
}
