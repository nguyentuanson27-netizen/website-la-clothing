import type { MetadataRoute } from "next";
import { connection } from "next/server";

import {
  CRAWL_BLOCKED_PATHS,
  readSearchExposure,
  type SearchExposure,
} from "@/seo/search-exposure";

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

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return buildRobotsDocument(readSearchExposure());
}
