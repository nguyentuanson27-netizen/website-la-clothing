import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { prisma } from "@/db/prisma";
import { readPancakeShopId } from "@/integrations/pancake/config";
import { readSearchExposure } from "@/seo/search-exposure";
import { createSearchSitemapRepository } from "@/seo/search-sitemap-repository";

const STATIC_CANONICAL_PATHS = ["/", "/shop", "/collections", "/lookbook"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const exposure = readSearchExposure();

  if (!exposure.indexingEnabled) {
    return [];
  }

  const dynamicPaths = await createSearchSitemapRepository(prisma).listCanonicalPaths({
    shopId: readPancakeShopId(),
  });

  return [...STATIC_CANONICAL_PATHS, ...dynamicPaths].map((pathname) => ({
    url: new URL(pathname, exposure.origin).href,
  }));
}
