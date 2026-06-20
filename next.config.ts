import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev-only: permits HMR resources for hosts listed via ALLOWED_DEV_ORIGINS
  // (comma-separated). Ignored by production builds.
  allowedDevOrigins:
    process.env.ALLOWED_DEV_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [],
  experimental: {
    // Silence BigInt serialization warnings — we handle this manually
  },
  images: {
    remotePatterns: [
      // Steam avatars
      { protocol: "https", hostname: "avatars.steamstatic.com" },
      { protocol: "https", hostname: "avatars.akamai.steamstatic.com" },
      // ByMykel stickers (team logos)
      { protocol: "https", hostname: "community.cloudflare.steamstatic.com" },
    ],
  },
  // The service worker is the recovery vector (PHA-1269): its activate handler
  // purges caches + broadcast-reloads stuck clients onto the fresh build, so it
  // must update INSTANTLY. By default `/sw.js` (a public/ file, which the
  // middleware skips because it has a file extension) was served cacheable, and
  // Cloudflare layered a 4h browser TTL on top (max-age=14400) — delaying the SW
  // update, and with it every recovery, by up to four hours. Force it uncacheable
  // at the origin so CF treats it as dynamic and every visit re-checks for a new
  // worker. (manifest.json is already max-age=0; hashed /_next/static stays immutable.)
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
