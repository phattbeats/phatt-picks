"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  match: (p: string) => boolean;
  icon: React.ReactNode;
};

const HomeIcon = (
  <svg viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10" />
  </svg>
);
const PicksIcon = (
  <svg viewBox="0 0 24 24">
    <rect x="6" y="4" width="12" height="16" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
const RanksIcon = (
  <svg viewBox="0 0 24 24">
    <rect x="4" y="10" width="4" height="10" />
    <rect x="10" y="6" width="4" height="14" />
    <rect x="16" y="13" width="4" height="7" />
  </svg>
);
const NewsIcon = (
  <svg viewBox="0 0 24 24">
    <rect x="4" y="5" width="16" height="14" />
    <line x1="8" y1="10" x2="14" y2="10" />
    <line x1="8" y1="14" x2="14" y2="14" />
  </svg>
);
const YouIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="8" r="4" />
    <path d="M5 21a7 7 0 0114 0" />
  </svg>
);

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home", match: (p) => p === "/", icon: HomeIcon },
  { href: "/picks", label: "Picks", match: (p) => p.startsWith("/picks"), icon: PicksIcon },
  {
    href: "/leaderboard",
    label: "Ranks",
    match: (p) => p.startsWith("/leaderboard"),
    icon: RanksIcon,
  },
  { href: "/news", label: "News", match: (p) => p.startsWith("/news"), icon: NewsIcon },
  // "You" now lands on your profile card; /players/* and /settings light it up
  // (PHA-1275). Drilling into another player's card from Ranks lights You too —
  // acceptable: they're both profiles.
  { href: "/profile", label: "You", match: (p) => p.startsWith("/profile") || p.startsWith("/players") || p.startsWith("/settings"), icon: YouIcon },
];

export function HeatBottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="botnav" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.match(pathname) ? "active" : undefined}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
