import type { NextConfig } from "next";

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const internalApiUrl = process.env.API_INTERNAL_URL || publicApiUrl;

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    useTypeScriptCli: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ddragon.leagueoflegends.com",
        pathname: "/cdn/**",
      },
    ],
  },
  // Retired routes kept working for old links; Next passes `?puuid=` through.
  async redirects() {
    return [
      {
        source: "/my-profile",
        destination: "/player-overview",
        permanent: false,
      },
      {
        source: "/playstyle-analysis",
        destination: "/player-overview",
        permanent: false,
      },
      {
        source: "/tracked-players",
        destination: "/player-overview",
        permanent: false,
      },
      {
        source: "/smurf-boost-detection",
        destination: "/rank-manipulation",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
