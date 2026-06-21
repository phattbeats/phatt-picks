"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HeatMark, HeatWordmark } from "./HeatMark";
import { NotificationBell } from "./NotificationBell";

const NAV_LINKS = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/picks", label: "Picks", match: (p: string) => p.startsWith("/picks") },
  { href: "/leaderboard", label: "Leaderboard", match: (p: string) => p.startsWith("/leaderboard") },
  { href: "/news", label: "News", match: (p: string) => p.startsWith("/news") },
  // INFO (PHA-1283) — help & guides as a first-class desktop tab. Also lights up
  // on the guide sub-pages it gathers (how-to-play / faq / help / install).
  { href: "/info", label: "Info", match: (p: string) => p.startsWith("/info") || p.startsWith("/how-to-play") || p.startsWith("/faq") || p.startsWith("/help") || p.startsWith("/pwa") },
  { href: "/profile", label: "Profile", match: (p: string) => p.startsWith("/profile") || p.startsWith("/players") || p.startsWith("/settings") },
] as const;

export type TopbarYouProps =
  | { kind: "anonymous" }
  | { kind: "initials"; initials: string; label: string }
  | { kind: "avatar"; avatarUrl: string; label: string };

/** Renders both the desktop top nav and the mobile header. CSS toggles which
 *  is visible based on viewport. `profileHref` is where the top-right avatar
 *  goes — the signed-in player's own player profile (Brandon), or /profile. */
export function HeatHeader({ topbar, profileHref = "/profile" }: { topbar: TopbarYouProps; profileHref?: string }) {
  const pathname = usePathname() ?? "/";

  return (
    <>
      {/* Desktop */}
      <nav className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="brand" aria-label="HOTLINE — home">
            <HeatMark size={30} />
            <HeatWordmark size={20} />
          </Link>
          <div className="navlinks">
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={item.match(pathname) ? "active" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="topnav-you">
            {topbar.kind !== "anonymous" && <NotificationBell />}
            <YouChip topbar={topbar} variant="desktop" href={profileHref} />
          </div>
        </div>
      </nav>

      {/* Mobile */}
      <header className="apphead">
        <Link href="/" className="brand" aria-label="HOTLINE — home">
          <HeatMark size={26} />
          <HeatWordmark size={18} />
        </Link>
        <div className="apphead-you">
          {topbar.kind !== "anonymous" && <NotificationBell />}
          <YouChip topbar={topbar} variant="mobile" href={profileHref} />
        </div>
      </header>
    </>
  );
}

function YouChip({
  topbar,
  variant,
  href,
}: {
  topbar: TopbarYouProps;
  variant: "desktop" | "mobile";
  href: string;
}) {
  const size = variant === "desktop" ? 30 : 28;
  const ariaLabel =
    topbar.kind === "anonymous"
      ? "Your profile"
      : `Your profile — ${topbar.label}`;

  return (
    <Link href={href} className="nav-avatar" aria-label={ariaLabel}>
      {topbar.kind === "avatar" ? (
        <Image
          src={topbar.avatarUrl}
          alt=""
          width={size}
          height={size}
          unoptimized
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : topbar.kind === "initials" ? (
        <span style={{ color: "var(--ink-hi)" }}>{topbar.initials}</span>
      ) : (
        <span style={{ color: "var(--heat)", fontWeight: 700 }}>◎</span>
      )}
    </Link>
  );
}
