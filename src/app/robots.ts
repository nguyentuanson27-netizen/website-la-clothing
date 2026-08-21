import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { CRAWL_BLOCKED_PATHS, readSearchExposure } from "@/seo/search-exposure";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const exposure = readSearchExposure();
  const rules = {
    userAgent: "*",
    allow: "/",
    disallow: [...CRAWL_BLOCKED_PATHS],
  };

  if (!exposure.indexingEnabled) {
    return { rules };
  }

  return {
    rules,
    sitemap: new URL("/sitemap.xml", exposure.origin).href,
  };
}
