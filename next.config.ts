import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
