import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { readSearchExposure } from "@/seo/search-exposure";

const PRIVATE_CRAWL_PATHS = [
  "/admin",
  "/api",
  "/account",
  "/cart",
  "/checkout",
  "/search",
  "/track-order",
] as const;

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const exposure = readSearchExposure();

  if (!exposure.indexingEnabled) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_CRAWL_PATHS],
    },
    sitemap: new URL("/sitemap.xml", exposure.origin).href,
  };
}
