import Link from "next/link";
import { HotlineLockup } from "@/components/heat/HeatMark";
import { SplashIntro } from "@/components/sg/auth/SplashIntro";

/**
 * Signed-out landing AND sign-in (HANDOFF §5e) — the old splash gate and the
 * `/login/auth` options page merged into one route. The ticket-H intro zooms
 * out into the nav slot over the full-bleed stadium; the sign-in content below
 * is server-rendered and staggers in once the intro hands off.
 *
 * `/login/auth` now redirects here (query preserved), so auth-callback errors
 * (`?error=…`) land on this page and are surfaced above the actions.
 */

const ERROR_MESSAGES: Record<string, string> = {
  steam_auth_failed: "Steam sign-in didn't complete. Please try again.",
  invalid_steam_id: "Steam returned an account we couldn't read. Please try again.",
  db_error: "Couldn't finish signing you in. Please try again.",
  local_create_failed: "Couldn't start a local profile. Please try again.",
};

const NOSCRIPT_CSS =
  ".sg-intro{display:none!important}.sg-splash .bgp img{opacity:1!important;transform:none!important}.sg-splash .top .brand{opacity:1!important}.sg-splash .rise{animation-play-state:running!important}";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ intro?: string; error?: string }>;
}) {
  const { intro, error } = await searchParams;
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? "Something went wrong signing you in. Please try again.") : null;
  // Bounced back with an error → don't replay the long intro.
  const override = intro === "first" || intro === "return" ? intro : errorMsg ? "return" : null;

  return (
    <>
      <noscript>
        <style>{NOSCRIPT_CSS}</style>
      </noscript>
      <SplashIntro override={override} photo="/wrapped/major-cover.jpg">
        <div className="top">
          <span className="brand">
            <HotlineLockup height={28} />
          </span>
          <span className="eyebrow rise">
            PGL Major <b>Singapore 2026</b>
          </span>
        </div>
        <div className="body">
          <h1 className="display h1 rise d1">Call your shots.</h1>
          <p className="lede rise d2">
            <b>HOTLINE</b> is the Pick&apos;Em arena for the Singapore Major. Call who runs the table at 3{"‑"}0,
            who crashes out 0{"‑"}3, and who lifts the trophy.
          </p>
          {errorMsg && (
            <p className="err rise d2" role="alert">
              {errorMsg}
            </p>
          )}
          <div className="notice rise d3">Early test build — things may break. Pick&apos;Ems will be made.</div>
          <div className="acts rise d3">
            <a href="/api/auth/steam" className="btn-solid">
              Sign in with Steam
            </a>
            <Link href="/login/local" prefetch={false} className="btn-ghost">
              Play locally
            </Link>
          </div>
          <span className="fine rise d4">
            Steam syncs your official Valve picks and needs a CS2 Viewer Pass. Local mode is fully featured.
          </span>
        </div>
      </SplashIntro>
    </>
  );
}
