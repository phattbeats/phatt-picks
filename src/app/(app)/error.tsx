"use client";

/**
 * Route-segment error boundary for the main app pages (PHA-860 review).
 *
 * The pages render scores/picks/ranks directly from Prisma in the RSC body with
 * no per-query try/catch (the data libs designed to degrade — getWireItems,
 * rankMapForSection — handle their own failures, but the bulk pick/player/outcome
 * reads do not). Without this boundary a transient DB blip during the live event
 * would surface Next's default full-page 500. This degrades it to an honest,
 * retryable card inside the shell instead. Errors in the (app) layout itself are
 * not caught here (a higher boundary would be needed) — this covers page bodies.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="panel brk" style={{ padding: "44px 24px", textAlign: "center" }}>
      <span className="br-tr" />
      <span className="br-bl" />
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--heat)",
        marginBottom: 14,
      }}>
        Signal dropped
      </div>
      <p className="font-display" style={{
        fontWeight: 800,
        fontSize: 24,
        color: "var(--ink-hi)",
        textTransform: "uppercase",
        margin: "0 0 8px",
        letterSpacing: "0.01em",
      }}>
        Temporarily unavailable
      </p>
      <p style={{
        color: "var(--ink-mid)",
        fontSize: 14,
        maxWidth: 320,
        margin: "0 auto 18px",
        lineHeight: 1.55,
      }}>
        Couldn&apos;t load this view just now — usually a brief hiccup. Your picks
        are safe. Try again in a moment.
      </p>
      <button type="button" onClick={reset} className="btn-heat">
        Retry
      </button>
    </section>
  );
}
