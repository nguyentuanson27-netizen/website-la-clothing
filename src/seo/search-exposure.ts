import { readStorefrontOrigin } from "../commerce/storefront-origin.ts";

type SearchExposureEnvironment = Readonly<Record<string, string | undefined>>;

export type SearchExposure = Readonly<{
  origin: string;
  indexingEnabled: boolean;
}>;

type SearchRequestPolicyInput = Readonly<{
  indexingEnabled: boolean;
  pathname: string;
  search: string;
}>;

// Origins that may never serve as a public indexable storefront at all.
const BLOCKED_INDEXING_HOSTS = new Set([
  "staging.lanadesign.vn",
  "localhost",
  "127.0.0.1",
]);

// ADR 0004 approved `la.lanadesign.vn` as the TEMPORARY production origin, so it deliberately is
// not a blocked origin: it serves real buyer traffic. Organic indexing on it is a different
// decision that ADR 0004 explicitly withheld, and until this file only carried the blocked-origin
// list a mistaken `SEARCH_INDEXING_ENABLED=true` on that host would have passed release preflight.
//
// This is the enforcement half of that gate, not a second policy: the temporary host fails closed
// on its own, while every other public hostname — including the future permanent brand domain —
// stays governed by the existing `SEARCH_INDEXING_ENABLED` gate. Migrating off the temporary host
// is then an explicit, reviewable removal from this set rather than a silent config flip.
const TEMPORARY_PRODUCTION_HOSTS = new Set(["la.lanadesign.vn"]);

export const CRAWL_BLOCKED_PATHS = ["/api"] as const;

const INDEXABLE_PATH_PATTERNS = [
  /^\/$/,
  /^\/shop$/,
  /^\/shop\/[^/]+$/,
  /^\/collections$/,
  /^\/collections\/[^/]+$/,
  /^\/lookbook$/,
] as const;

const INDEXABLE_PAGINATION_PATH_PATTERNS = [
  /^\/shop$/,
  /^\/collections\/[^/]+$/,
] as const;

const MAX_INDEXABLE_CATALOG_PAGE = 10_000;
const CANONICAL_CATALOG_PAGINATION_SEARCH = /^\?page=((?:[2-9])|(?:[1-9]\d+))$/;

function storefrontHostname(origin: string): string {
  return new URL(origin).hostname.toLowerCase();
}

function isBlockedIndexingOrigin(origin: string): boolean {
  return BLOCKED_INDEXING_HOSTS.has(storefrontHostname(origin));
}

export function isTemporaryProductionOrigin(origin: string): boolean {
  return TEMPORARY_PRODUCTION_HOSTS.has(storefrontHostname(origin));
}

function isCrawlBlockedPath(pathname: string): boolean {
  return CRAWL_BLOCKED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isCanonicalCatalogPaginationRequest(
  pathname: string,
  search: string,
): boolean {
  if (!INDEXABLE_PAGINATION_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return false;
  }

  const match = CANONICAL_CATALOG_PAGINATION_SEARCH.exec(search);
  if (!match) return false;

  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page <= MAX_INDEXABLE_CATALOG_PAGE;
}

export function readSearchExposure(
  env: SearchExposureEnvironment = process.env,
): SearchExposure {
  const origin = readStorefrontOrigin(env);
  const requested = env.SEARCH_INDEXING_ENABLED === "true";

  return {
    origin,
    indexingEnabled:
      requested && !isBlockedIndexingOrigin(origin) && !isTemporaryProductionOrigin(origin),
  };
}

export function validateSearchExposureForRelease(
  env: SearchExposureEnvironment,
): SearchExposure {
  const raw = env.SEARCH_INDEXING_ENABLED;
  if (raw !== "true" && raw !== "false") {
    throw new Error("SEARCH_INDEXING_ENABLED must be explicitly configured as true or false");
  }

  const exposure = readSearchExposure(env);
  if (raw === "true" && isTemporaryProductionOrigin(exposure.origin)) {
    throw new Error(
      "Search indexing cannot be enabled on the temporary production storefront origin; it requires a permanent domain and a separate explicit approval",
    );
  }
  if (raw === "true" && !exposure.indexingEnabled) {
    throw new Error("Search indexing cannot be enabled on staging or local storefront origins");
  }

  return exposure;
}

export function shouldNoIndexRequest({
  indexingEnabled,
  pathname,
  search,
}: SearchRequestPolicyInput): boolean {
  if (isCrawlBlockedPath(pathname)) return false;
  if (!indexingEnabled) return true;
  if (search.length > 0) {
    return !isCanonicalCatalogPaginationRequest(pathname, search);
  }

  return !INDEXABLE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}
