export const ADMIN_PRODUCT_DIRECTORY_LIMITS = {
  query: 80,
  collection: 48,
  page: 10_000,
  pageSize: 40,
} as const;

export const ADMIN_PRODUCT_DIRECTORY_SORTS = [
  "name-asc",
  "name-desc",
  "updated-desc",
  "synced-desc",
] as const;

export const ADMIN_PRODUCT_CONTENT_STATES = ["DRAFT", "REVIEWED", "PUBLISHED"] as const;

export const ADMIN_PRODUCT_ACTIVITIES = ["active", "inactive"] as const;

/** Sentinel accepted by the `collection` parameter to list products with no membership. */
export const ADMIN_PRODUCT_UNCATEGORIZED = "none";

export type AdminProductDirectorySort = (typeof ADMIN_PRODUCT_DIRECTORY_SORTS)[number];
export type AdminProductContentState = (typeof ADMIN_PRODUCT_CONTENT_STATES)[number];
export type AdminProductActivity = (typeof ADMIN_PRODUCT_ACTIVITIES)[number];

export type AdminProductDirectoryQuery = {
  query: string | null;
  status: AdminProductContentState | null;
  collection: string | null;
  uncategorized: boolean;
  activity: AdminProductActivity | null;
  sort: AdminProductDirectorySort;
  page: number;
};

type SearchParamValue = string | string[] | undefined;
export type AdminProductDirectorySearchParams = Record<string, SearchParamValue>;

const COLLECTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SORTS = new Set<string>(ADMIN_PRODUCT_DIRECTORY_SORTS);
const STATES = new Set<string>(ADMIN_PRODUCT_CONTENT_STATES);
const ACTIVITIES = new Set<string>(ADMIN_PRODUCT_ACTIVITIES);

function invalid(): never {
  throw new RangeError("Invalid admin product directory parameters");
}

function one(value: SearchParamValue): string | undefined {
  if (Array.isArray(value)) invalid();
  return value;
}

function optionalText(value: SearchParamValue, maxLength: number): string | null {
  const raw = one(value);
  if (raw === undefined || raw === "") return null;
  if (raw.length > maxLength) invalid();
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function parsePage(value: SearchParamValue): number {
  const raw = one(value);
  if (raw === undefined || raw === "") return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) invalid();
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > ADMIN_PRODUCT_DIRECTORY_LIMITS.page) invalid();
  return parsed;
}

function parseSort(value: SearchParamValue): AdminProductDirectorySort {
  const raw = one(value);
  if (raw === undefined || raw === "") return "name-asc";
  if (!SORTS.has(raw)) invalid();
  return raw as AdminProductDirectorySort;
}

function parseStatus(value: SearchParamValue): AdminProductContentState | null {
  const raw = one(value);
  if (raw === undefined || raw === "") return null;
  if (!STATES.has(raw)) invalid();
  return raw as AdminProductContentState;
}

function parseActivity(value: SearchParamValue): AdminProductActivity | null {
  const raw = one(value);
  if (raw === undefined || raw === "") return null;
  if (!ACTIVITIES.has(raw)) invalid();
  return raw as AdminProductActivity;
}

export function parseAdminProductDirectorySearchParams(
  searchParams: AdminProductDirectorySearchParams,
): AdminProductDirectoryQuery {
  const collectionRaw = optionalText(
    searchParams.collection,
    ADMIN_PRODUCT_DIRECTORY_LIMITS.collection,
  );
  const uncategorized = collectionRaw === ADMIN_PRODUCT_UNCATEGORIZED;
  if (collectionRaw !== null && !uncategorized && !COLLECTION_SLUG.test(collectionRaw)) invalid();

  return {
    query: optionalText(searchParams.q, ADMIN_PRODUCT_DIRECTORY_LIMITS.query),
    status: parseStatus(searchParams.status),
    collection: uncategorized ? null : collectionRaw,
    uncategorized,
    activity: parseActivity(searchParams.activity),
    sort: parseSort(searchParams.sort),
    page: parsePage(searchParams.page),
  };
}

/**
 * Serializes the directory state back to a URL. Default-valued state is stripped so the
 * unfiltered list stays exactly `/admin`, and callers pass the target page explicitly —
 * a filter change must not carry a stale page number into a shorter result set.
 */
export function buildAdminProductDirectoryHref(
  query: AdminProductDirectoryQuery,
  page: number = query.page,
): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > ADMIN_PRODUCT_DIRECTORY_LIMITS.page) {
    invalid();
  }

  const params = new URLSearchParams();
  if (query.query) params.set("q", query.query);
  if (query.status) params.set("status", query.status);
  if (query.uncategorized) params.set("collection", ADMIN_PRODUCT_UNCATEGORIZED);
  else if (query.collection) params.set("collection", query.collection);
  if (query.activity) params.set("activity", query.activity);
  if (query.sort !== "name-asc") params.set("sort", query.sort);
  if (page !== 1) params.set("page", String(page));

  const serialized = params.toString();
  return serialized.length > 0 ? `/admin?${serialized}` : "/admin";
}

/** Href for one facet toggle, keeping the search term but always returning to page 1. */
export function buildAdminProductFacetHref(
  query: AdminProductDirectoryQuery,
  facet: Readonly<
    Partial<Pick<AdminProductDirectoryQuery, "status" | "collection" | "uncategorized" | "activity">>
  >,
): string {
  return buildAdminProductDirectoryHref({ ...query, ...facet, page: 1 }, 1);
}

export function hasActiveAdminProductFilters(query: AdminProductDirectoryQuery): boolean {
  return (
    query.query !== null ||
    query.status !== null ||
    query.collection !== null ||
    query.uncategorized ||
    query.activity !== null
  );
}
