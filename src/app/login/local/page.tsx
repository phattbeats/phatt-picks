/* eslint-disable @next/next/no-img-element -- full-bleed background photo; next/image adds nothing here. */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { randomName } from "@/lib/local-auth-core";
import { HotlineLockup } from "@/components/heat/HeatMark";
import { TokenSignInPanel } from "@/components/TokenSignInPanel";
import { LocalNameField } from "@/components/sg/auth/LocalNameField";
import { PHOTOS } from "@/lib/photos";

const ERROR_MESSAGES: Record<string, string> = {
  ip_limit:
    "Too many accounts created from this network. Sign in with Steam instead.",
  captcha: "Bot check failed. Please try again.",
  invalid_token: "That login link or token isn't valid. Check it and try again.",
  no_token: "No login token found in that link.",
  token_login_failed: "Couldn't sign you in. Please try again.",
};

const TOKEN_ERRORS = new Set(["invalid_token", "no_token", "token_login_failed"]);

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
    <div className="full sg-auth sg-local" data-screen-label="Play locally">
      <div className="bgp">
        <img src={PHOTOS.localSignIn} alt="" />
      </div>
      <div className="top">
        <Link href="/login?intro=return" prefetch={false} className="brand" aria-label="HOTLINE sign-in">
          <HotlineLockup height={28} />
        </Link>
        <Link href="/login?intro=return" prefetch={false} className="eyebrow">
          ← Back
        </Link>
      </div>
      <div className="body">
        <span className="eyebrow rise">No Steam needed</span>
        <h1 className="display h1 rise d1">Pick a name</h1>
        <p className="lede rise d2">It&apos;s what shows on the leaderboard. You can change it later.</p>

        {errorMsg && (
          <p className="err" role="alert">
            {errorMsg}
          </p>
        )}

        <form action="/api/auth/local" method="POST" className="form rise d3">
          <LocalNameField suggested={suggested} />
          {siteKey && (
            <div className="cf-turnstile" data-sitekey={siteKey} data-theme="dark" data-size="flexible" />
          )}
          <button type="submit" className="btn-solid">
            Start playing
          </button>
        </form>

        {/* Returning player — sign back in with a saved login token/link */}
        <details className="ret rise d4" open={Boolean(error && TOKEN_ERRORS.has(error))}>
          <summary>Played on another device?</summary>
          <p>Paste your login link to pick up where you left off.</p>
          <TokenSignInPanel />
        </details>
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
