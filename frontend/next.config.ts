import type { NextConfig } from "next";

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const internalApiUrl = process.env.API_INTERNAL_URL || publicApiUrl;

/**
 * HTML names the hashed chunk filenames, so a document cached across a deploy
 * asks for chunks the new origin no longer has.
 */
export const DOCUMENT_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";

/** Content-addressed build output; the `?dpl=` query from `deploymentId` still
 * cache-busts when a filename happens to repeat across two images. */
export const HASHED_STATIC_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

const deploymentId = process.env.NEXT_DEPLOYMENT_ID;

const nextConfig: NextConfig = {
  output: "standalone",
  ...(deploymentId ? { deploymentId } : {}),
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
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: DOCUMENT_CACHE_CONTROL },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: DOCUMENT_CACHE_CONTROL },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: HASHED_STATIC_CACHE_CONTROL },
        ],
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
