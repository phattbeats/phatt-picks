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
    // PHA-5360: every image is already a pre-built, right-sized static file
    // (scripts/optimize-images.mjs), so next/image serves it as-is. The
    // optimizer made each hero a /_next/image request that Cloudflare can't
    // cache (DYNAMIC): the LCP image of every page was re-served by the 0.30-CPU
    // origin (0.45-0.8 s) and re-encoded after every deploy. Static files are
    // edge-cached and keep the long Cache-Control set in headers() below.
    unoptimized: true,
    remotePatterns: [
      // Steam avatars
      { protocol: "https", hostname: "avatars.steamstatic.com" },
      { protocol: "https", hostname: "avatars.akamai.steamstatic.com" },
      // ByMykel stickers (team logos)
      { protocol: "https", hostname: "community.cloudflare.steamstatic.com" },
    ],
  },
  // The service worker is the recovery vector: its activate handler
  // purges caches + broadcast-reloads stuck clients onto the fresh build, so it
  // must update INSTANTLY. By default `/sw.js` (a public/ file, which the
  // middleware skips because it has a file extension) was served cacheable, and
  // Cloudflare layered a 4h browser TTL on top (max-age=14400) — delaying the SW
  // update, and with it every recovery, by up to four hours. Force it uncacheable
  // at the origin so CF treats it as dynamic and every visit re-checks for a new
  // worker. (manifest.json is already max-age=0; hashed /_next/static stays immutable.)
  async headers() {
    // PHA-5360: static art (logos, photos, player shots, flags, brand, coin and
    // Wrapped art) used to go out with no Cache-Control, so Cloudflare stamped a
    // 4h browser TTL and every return visit re-downloaded it. These files are
    // not content-hashed, so not `immutable`: a week fresh, then up to a month
    // served from cache while it revalidates in the background. A replaced
    // file shows up within a week; renaming it shows it at once.
    const ART = "public, max-age=604800, stale-while-revalidate=2592000";
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      ...["logos", "photos", "players", "flags", "brand", "wrapped", "coins", "art", "charms", "watch"].map((dir) => ({
        source: `/${dir}/:path*`,
        headers: [{ key: "Cache-Control", value: ART }],
      })),
    ];
  },
};

export default nextConfig;
