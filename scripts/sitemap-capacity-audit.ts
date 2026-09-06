/**
 * Sitemap capacity audit (#152 W21, master-plan unit U37).
 *
 * Read-only. Prints a bounded, sanitized summary of how much of the single-sitemap URL budget the
 * current catalog uses. It changes nothing and decides nothing.
 *
 * The counts come from `countCanonicalPaths`, the same predicates `listCanonicalPaths` emits from,
 * so the headroom reported here describes the sitemap that would actually be built rather than a
 * second opinion about eligibility. Only aggregates are read and printed: no slug, URL, product id
 * or catalog content is materialized or logged.
 *
 *   DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm sitemap:capacity:audit
 */

import { prisma } from "../src/db/prisma.ts";
import { readPancakeShopId } from "../src/integrations/pancake/config.ts";
import { createSearchSitemapRepository } from "../src/seo/search-sitemap-repository.ts";
import { summarizeSitemapCapacity } from "../src/seo/sitemap-capacity.ts";

try {
  // Shop id only. This audit reads the local mirror and never calls Pancake, so requiring the API
  // key would make evidence-gathering depend on approved external context it does not use.
  const shopId = readPancakeShopId();
  const counts = await createSearchSitemapRepository(prisma).countCanonicalPaths({ shopId });

  console.log("SITEMAP_CAPACITY_AUDIT_BEGIN");
  console.log(
    JSON.stringify(
      {
        pancakeShopId: shopId,
        measuredAt: new Date().toISOString(),
        ...summarizeSitemapCapacity(counts),
      },
      null,
      2,
    ),
  );
  console.log("SITEMAP_CAPACITY_AUDIT_END");
} catch (error) {
  console.error(`Sitemap capacity audit failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
