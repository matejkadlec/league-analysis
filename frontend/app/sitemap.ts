import type { MetadataRoute } from "next";

import { LEGAL_PAGES } from "@/lib/core/legal-pages";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://leagueanalysis.gg"
).replace(/\/+$/, "");

const PUBLIC_ROUTES = ["/", ...LEGAL_PAGES.map((page) => page.href)];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: now,
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.3,
  }));
}
