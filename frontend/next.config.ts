import type { NextConfig } from "next";

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const internalApiUrl = process.env.API_INTERNAL_URL || publicApiUrl;

/**
 * Documents and RSC must not be stored at the edge or in the browser: HTML
 * names the hashed chunk filenames, so a document cached across a deploy asks
 * for chunks the new origin no longer has.
 */
export const DOCUMENT_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";

/** Content-addressed webpack/turbopack output. The query `?dpl=` from
 * `deploymentId` still cache-busts when a filename happens to stay the same
 * across two images (the turbopack runtime did). */
export const HASHED_STATIC_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

/**
 * Sent with every response the interface itself produces; forwarded `/api/v1`
 * responses pass through without them. No Content-Security-Policy yet:
 * Next.js inlines scripts, so that needs per-request nonces first.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

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
          ...SECURITY_HEADERS,
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: DOCUMENT_CACHE_CONTROL },
          ...SECURITY_HEADERS,
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
  // Only the versioned API: the backend serves its interactive documentation
  // at `/api` itself, which `/api/:path*` also matched and so published.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${internalApiUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
