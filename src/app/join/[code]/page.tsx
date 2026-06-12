import Link from "next/link";
import { resolveInvite } from "@/lib/invite";
import { HeatMark, HeatWordmark } from "@/components/heat/HeatMark";

/**
 * Public invite landing — the link a friend opens to onboard unaided.
 * No auth required to view.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const inviter = await resolveInvite(code);

  return (
    <main
      style={{
        position: "relative",
        zIndex: 3,
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        gap: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <HeatMark size={64} />
        <HeatWordmark size={36} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, maxWidth: 360, textAlign: "center" }}>
        <span className="eyebrow-mono">[ INCOMING ]</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(26px, 6vw, 36px)",
          textTransform: "uppercase",
          lineHeight: 1,
          color: "var(--ink-hi)",
          margin: 0,
        }}>
          {inviter ? (
            <>
              <span className="foil">{inviter.displayName}</span> wants you in
            </>
          ) : (
            <>You&apos;re invited</>
          )}
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          Call the CS2 Major. Pick who goes 3‑0, who busts, who lifts the trophy at IEM Cologne 2026 — and settle it on a shared leaderboard.
        </p>
      </div>

      <div className="brk panel" style={{ maxWidth: 360, width: "100%", padding: "22px 24px" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p className="eyebrow-mono" style={{ marginBottom: 12 }}>[ TWO WAYS IN ]</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Link href="/login/local" className="btn-heat" style={{ width: "100%" }}>
            Start playing — no Steam
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          <a href="/api/auth/steam" className="btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
            Sign in with Steam
          </a>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360, textAlign: "center" }}>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-low)",
          margin: 0,
        }}>
          Local play is fully featured. Steam sync mirrors your official Valve Pick&apos;Em —{" "}
          <Link href="/help/auth-code" style={{ color: "var(--ink-mid)" }}>see how</Link>.
        </p>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-low)",
          margin: 0,
        }}>
          iPhone: Share → Add to Home Screen, then open HOTLINE from that icon for pick-lock reminders.
        </p>
      </div>
    </main>
  );
}
