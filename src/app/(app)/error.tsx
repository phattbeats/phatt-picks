"use client";

/* eslint-disable @next/next/no-img-element -- static decorative photo from /public/wrapped. */

/**
 * Route-segment error boundary for the main app pages (#860 review).
 *
 * The pages render scores/picks/ranks directly from Prisma in the RSC body with
 * no per-query try/catch (the data libs designed to degrade — getWireItems,
 * rankMapForSection — handle their own failures, but the bulk pick/player/outcome
 * reads do not). Without this boundary a transient DB blip during the live event
 * would surface Next's default full-page 500. This degrades it to an honest,
 * retryable card inside the shell instead. Errors in the (app) layout itself are
 * not caught here (a higher boundary would be needed) — this covers page bodies.
 * Singapore skin: the 22-states photo card.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="sgc-state" role="alert">
      <img src="/wrapped/cologne-player.jpg" alt="" />
      <div>
        <span className="tag crit">Signal dropped</span>
        <h1 className="display h2">Temporarily unavailable</h1>
        <p>
          Couldn&apos;t load this view just now — usually a brief hiccup. <b>Your picks are safe.</b>{" "}
          Try again in a moment.
        </p>
        <div className="acts">
          <button type="button" onClick={reset} className="btn-solid">
            Retry
          </button>
        </div>
      </div>
    </section>
  );
}
