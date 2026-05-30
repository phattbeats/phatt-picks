import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { randomName, DISPLAY_NAME_MAX } from "@/lib/local-auth-core";
import { HeatMark, HeatWordmark } from "@/components/heat/HeatMark";

export default async function LocalSignInPage() {
  const session = await getSession();
  if (session?.steamId) redirect("/");
  if (session?.isLocal) redirect("/");

  const suggested = randomName();

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
        gap: 28,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <HeatMark size={52} />
        <HeatWordmark size={28} />
      </div>

      <div className="panel brk" style={{ maxWidth: 360, width: "100%", padding: "22px 24px" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <p className="eyebrow-mono" style={{ marginBottom: 10 }}>[ CALLSIGN ]</p>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: 26,
          textTransform: "uppercase",
          color: "var(--ink-hi)",
          margin: "0 0 8px",
        }}>
          Pick a display name
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.55 }}>
          This is what shows on the leaderboard. You can change it later.
        </p>

        <form
          action="/api/auth/local"
          method="POST"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <label
            htmlFor="displayName"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--ink-low)",
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
              background: "var(--surf-2)",
              border: "1px solid var(--hair-2)",
              padding: "12px 14px",
              color: "var(--ink-hi)",
              fontSize: 15,
              fontFamily: "var(--font-body)",
              minHeight: 44,
              outline: "none",
              borderRadius: "var(--r-sm)",
            }}
          />
          <button type="submit" className="btn-heat" style={{ width: "100%" }}>
            Start playing
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <Link
            href="/login"
            style={{
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-low)",
              textDecoration: "none",
              marginTop: 4,
            }}
          >
            ← Back
          </Link>
        </form>
      </div>
    </main>
  );
}
