import type { MetadataRoute } from "next";

import {
  CRAWL_BLOCKED_PATHS,
  type SearchExposure,
} from "./search-exposure.ts";

export function buildRobotsDocument(exposure: SearchExposure): MetadataRoute.Robots {
  const rules: MetadataRoute.Robots["rules"] = [
    {
      userAgent: "*",
      allow: "/",
      disallow: [...CRAWL_BLOCKED_PATHS],
    },
    {
      userAgent: "OAI-SearchBot",
      allow: "/",
      disallow: [...CRAWL_BLOCKED_PATHS],
    },
  ];

  if (!exposure.indexingEnabled) {
    return { rules };
  }

  return {
    rules,
    sitemap: new URL("/sitemap.xml", exposure.origin).href,
  };
}
