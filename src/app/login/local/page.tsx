import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { randomName, DISPLAY_NAME_MAX } from "@/lib/local-auth-core";
import { HeatMark, HeatWordmark } from "@/components/heat/HeatMark";

const ERROR_MESSAGES: Record<string, string> = {
  ip_limit:
    "Too many accounts created from this network. Sign in with Steam instead.",
  captcha: "Bot check failed. Please try again.",
};

export default async function LocalSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session?.steamId) redirect("/");
  if (session?.isLocal) redirect("/");

  const { error } = await searchParams;
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? null) : null;
  const suggested = randomName();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

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
        <p className="eyebrow-mono" style={{ marginBottom: 10 }}>CALLSIGN</p>
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

        {errorMsg && (
          <p
            role="alert"
            style={{
              background: "rgba(255,60,60,0.08)",
              border: "1px solid rgba(255,60,60,0.3)",
              borderRadius: "var(--r-sm)",
              color: "var(--heat)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              padding: "9px 12px",
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            {errorMsg}
          </p>
        )}

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
          {siteKey && (
            <div
              className="cf-turnstile"
              data-sitekey={siteKey}
              data-theme="dark"
              data-size="flexible"
            />
          )}
          <button type="submit" className="btn-heat" style={{ width: "100%" }}>
            Start playing
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <Link
            href="/login/auth"
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

      {siteKey && (
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async={true}
          defer={true}
        />
      )}
    </main>
  );
}
