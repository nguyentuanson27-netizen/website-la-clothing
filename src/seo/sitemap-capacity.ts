/**
 * W21 sitemap capacity arithmetic (#152 W21, master-plan unit U37).
 *
 * The sitemap is a single document with a hard cliff: `listCanonicalPaths` throws once the dynamic
 * path count passes `MAX_DYNAMIC_SITEMAP_PATHS`, and `/sitemap.xml` has no partial or index
 * fallback, so crossing it turns the endpoint into an HTTP 500 rather than a degraded sitemap.
 * This module turns a pair of counts into the headroom figures an operator needs to see that
 * coming, and nothing else.
 *
 * It deliberately reports **facts only** — counts, headroom, utilization, and whether the budget is
 * already exceeded. It does not classify a catalog as healthy, warning or critical: any such
 * threshold is an operations decision about monitoring cadence and engineering lead time, not an
 * arithmetic property, and baking a plausible-looking number in here would disguise a guess as a
 * contract. See `docs/audits/sitemap-capacity-w21.md` for the trigger the numbers feed.
 */

import { MAX_DYNAMIC_SITEMAP_PATHS, STATIC_CANONICAL_PATHS } from "./search-sitemap-repository.ts";

export type SitemapCapacityCounts = Readonly<{
  productPaths: number;
  collectionPaths: number;
}>;

export type SitemapCapacityReport = Readonly<{
  productPaths: number;
  collectionPaths: number;
  dynamicPaths: number;
  staticPaths: number;
  totalPaths: number;
  dynamicBudget: number;
  remainingDynamicHeadroom: number;
  utilizationPercent: number;
  exceedsDynamicBudget: boolean;
}>;

function parseCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Sitemap capacity ${label} must be a safe non-negative integer`);
  }
  return value;
}

export function summarizeSitemapCapacity(counts: SitemapCapacityCounts): SitemapCapacityReport {
  const productPaths = parseCount(counts.productPaths, "productPaths");
  const collectionPaths = parseCount(counts.collectionPaths, "collectionPaths");

  const dynamicPaths = productPaths + collectionPaths;
  const staticPaths = STATIC_CANONICAL_PATHS.length;

  return {
    productPaths,
    collectionPaths,
    dynamicPaths,
    staticPaths,
    totalPaths: dynamicPaths + staticPaths,
    dynamicBudget: MAX_DYNAMIC_SITEMAP_PATHS,
    // Headroom floors at zero: past the bound there is none, and the overflow is reported by
    // `exceedsDynamicBudget` rather than as a negative amount of remaining room.
    remainingDynamicHeadroom: Math.max(MAX_DYNAMIC_SITEMAP_PATHS - dynamicPaths, 0),
    utilizationPercent:
      Math.round((dynamicPaths / MAX_DYNAMIC_SITEMAP_PATHS) * 100 * 1000) / 1000,
    exceedsDynamicBudget: dynamicPaths > MAX_DYNAMIC_SITEMAP_PATHS,
  };
}
