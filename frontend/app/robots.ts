import type { MetadataRoute } from "next";

import { SHOULD_ALLOW_INDEXING, SITE_URL } from "@/lib/core/site-url";

export default function robots(): MetadataRoute.Robots {
  if (!SHOULD_ALLOW_INDEXING) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
      host: SITE_URL,
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
