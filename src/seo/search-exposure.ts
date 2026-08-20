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

const BLOCKED_INDEXING_HOSTS = new Set([
  "la.lanadesign.vn",
  "localhost",
  "127.0.0.1",
]);

const INDEXABLE_PATH_PATTERNS = [
  /^\/$/,
  /^\/shop$/,
  /^\/shop\/[^/]+$/,
  /^\/collections$/,
  /^\/collections\/[^/]+$/,
  /^\/lookbook$/,
] as const;

function isBlockedIndexingOrigin(origin: string): boolean {
  return BLOCKED_INDEXING_HOSTS.has(new URL(origin).hostname.toLowerCase());
}

export function readSearchExposure(
  env: SearchExposureEnvironment = process.env,
): SearchExposure {
  const origin = readStorefrontOrigin(env);
  const requested = env.SEARCH_INDEXING_ENABLED === "true";

  return {
    origin,
    indexingEnabled: requested && !isBlockedIndexingOrigin(origin),
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
  if (!indexingEnabled) return true;
  if (search.length > 0) return true;

  return !INDEXABLE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}
