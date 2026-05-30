"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HeatMark, HeatWordmark } from "./HeatMark";

const NAV_LINKS = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/picks", label: "Picks", match: (p: string) => p.startsWith("/picks") },
  { href: "/leaderboard", label: "Leaderboard", match: (p: string) => p.startsWith("/leaderboard") || p.startsWith("/players") },
  { href: "/news", label: "News", match: (p: string) => p.startsWith("/news") },
  { href: "/profile", label: "Profile", match: (p: string) => p.startsWith("/profile") },
] as const;

export type TopbarYouProps =
  | { kind: "anonymous" }
  | { kind: "initials"; initials: string; label: string }
  | { kind: "avatar"; avatarUrl: string; label: string };

/** Renders both the desktop top nav and the mobile header. CSS toggles which
 *  is visible based on viewport. */
export function HeatHeader({ topbar }: { topbar: TopbarYouProps }) {
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
          <YouChip topbar={topbar} variant="desktop" />
        </div>
      </nav>

      {/* Mobile */}
      <header className="apphead">
        <Link href="/" className="brand" aria-label="HOTLINE — home">
          <HeatMark size={26} />
          <HeatWordmark size={18} />
        </Link>
        <YouChip topbar={topbar} variant="mobile" />
      </header>
    </>
  );
}

function YouChip({
  topbar,
  variant,
}: {
  topbar: TopbarYouProps;
  variant: "desktop" | "mobile";
}) {
  const size = variant === "desktop" ? 30 : 28;
  const ariaLabel =
    topbar.kind === "anonymous"
      ? "Your profile"
      : `Your profile — ${topbar.label}`;

  return (
    <Link href="/profile" className="nav-avatar" aria-label={ariaLabel}>
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
