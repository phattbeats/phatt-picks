/* eslint-disable @next/next/no-img-element -- full-bleed background photo; next/image adds nothing here. */
import Link from "next/link";
import { resolveInvite } from "@/lib/invite";
import { DISPLAY_NAME_MAX } from "@/lib/local-auth-core";
import { HotlineLockup } from "@/components/heat/HeatMark";

/**
 * Public invite landing — the link a friend opens to onboard unaided.
 * No auth required to view.
 *
 * The local path posts the name straight to the existing /api/auth/local
 * form endpoint (same contract as /login/local: `displayName` +
 * Turnstile). The referral cookie is stamped by middleware on this route,
 * so attribution is unchanged. A blank name falls back to a random one
 * server-side; errors (IP limit, bot check) land on /login/local?error=….
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const inviter = await resolveInvite(code);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  return (
    <div className="full sg-auth sg-join" data-screen-label="Invite / Join">
      <div className="bgp">
        <img src="/wrapped/major-nations.jpg" alt="" />
      </div>
      <div className="top rise">
        <Link href="/login?intro=return" prefetch={false} className="brand" aria-label="HOTLINE sign-in">
          <HotlineLockup height={28} />
        </Link>
        <span className="eyebrow">Incoming</span>
      </div>
      <div className="body">
        <h1 className="display h1 rise d1">
          {inviter ? (
            <>
              <span className="foil">{inviter.displayName}</span>
              <br />
              wants you in
            </>
          ) : (
            <>You&apos;re invited</>
          )}
        </h1>
        <p className="lede rise d2">
          Call the CS2 Major. Pick who goes 3{"‑"}0, who busts, who lifts the trophy at <b>PGL Major Singapore 2026</b> —
          and settle it on a shared leaderboard.
        </p>

        <form action="/api/auth/local" method="POST" className="form rise d3">
          <div className="field">
            <label htmlFor="displayName">Your name on the board</label>
            <input
              className="input name"
              id="displayName"
              name="displayName"
              type="text"
              placeholder="Leave blank for a random name"
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="nickname"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          {siteKey && (
            <div className="cf-turnstile" data-sitekey={siteKey} data-theme="dark" data-size="flexible" />
          )}
          <button type="submit" className="btn-solid">
            Start playing — no Steam
          </button>
          <a href="/api/auth/steam" className="btn-ghost">
            Sign in with Steam
          </a>
        </form>

        <div className="fine-stack rise d4">
          <span className="fine">
            Local play is fully featured. Steam sync mirrors your official Valve Pick&apos;Em —{" "}
            <Link href="/help/auth-code" prefetch={false}>
              see how
            </Link>
            .
          </span>
          <span className="fine">
            iPhone: Share → Add to Home Screen, then open HOTLINE from that icon for pick-lock reminders.
          </span>
        </div>
      </div>

      {siteKey && (
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async={true}
          defer={true}
        />
      )}
    </div>
  );
}
