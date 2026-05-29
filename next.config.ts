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
};

export default nextConfig;
