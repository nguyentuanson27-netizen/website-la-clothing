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

/**
 * Health dimensions that own their own URL value.
 *
 * `Không có collection` and `Catalog đang tắt` are deliberately absent: they are exact aliases of
 * the existing `collection=none` and `activity=inactive` parameters, so they keep serializing to
 * those instead of gaining a second, competing representation of the same result set.
 */
export const ADMIN_PRODUCT_HEALTH_FILTERS = [
  "stocked-inactive",
  "zero-active",
  "missing-image",
] as const;

/** Health dimensions with no Prisma-expressible predicate, resolved by database-side SQL. */
export const ADMIN_PRODUCT_HEALTH_SQL_FILTERS = ["stocked-inactive", "missing-image"] as const;

/** Sentinel accepted by the `collection` parameter to list products with no membership. */
export const ADMIN_PRODUCT_UNCATEGORIZED = "none";

export type AdminProductDirectorySort = (typeof ADMIN_PRODUCT_DIRECTORY_SORTS)[number];
export type AdminProductContentState = (typeof ADMIN_PRODUCT_CONTENT_STATES)[number];
export type AdminProductActivity = (typeof ADMIN_PRODUCT_ACTIVITIES)[number];
export type AdminProductHealth = (typeof ADMIN_PRODUCT_HEALTH_FILTERS)[number];
export type AdminProductHealthSqlFilter = (typeof ADMIN_PRODUCT_HEALTH_SQL_FILTERS)[number];

export type AdminProductDirectoryQuery = {
  query: string | null;
  status: AdminProductContentState | null;
  collection: string | null;
  uncategorized: boolean;
  activity: AdminProductActivity | null;
  health: AdminProductHealth | null;
  sort: AdminProductDirectorySort;
  page: number;
};

type SearchParamValue = string | string[] | undefined;
export type AdminProductDirectorySearchParams = Record<string, SearchParamValue>;

const COLLECTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SORTS = new Set<string>(ADMIN_PRODUCT_DIRECTORY_SORTS);
const STATES = new Set<string>(ADMIN_PRODUCT_CONTENT_STATES);
const ACTIVITIES = new Set<string>(ADMIN_PRODUCT_ACTIVITIES);
const HEALTH_FILTERS = new Set<string>(ADMIN_PRODUCT_HEALTH_FILTERS);

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

function parseHealth(value: SearchParamValue): AdminProductHealth | null {
  const raw = one(value);
  if (raw === undefined || raw === "") return null;
  if (!HEALTH_FILTERS.has(raw)) invalid();
  return raw as AdminProductHealth;
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
    health: parseHealth(searchParams.health),
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
  if (query.health) params.set("health", query.health);
  if (query.sort !== "name-asc") params.set("sort", query.sort);
  if (page !== 1) params.set("page", String(page));

  const serialized = params.toString();
  return serialized.length > 0 ? `/admin?${serialized}` : "/admin";
}

/** Href for one facet toggle, keeping the search term but always returning to page 1. */
export const ADMIN_PRODUCT_FACET_KEYS = [
  "all",
  "draft",
  "reviewed",
  "published",
  "uncategorized",
] as const;

export type AdminProductFacetKey = (typeof ADMIN_PRODUCT_FACET_KEYS)[number];

/**
 * The switch-to target for every facet chip, and the single source both its link and its count
 * are derived from — computing them separately is what lets a chip advertise a total that its
 * own link does not open.
 *
 * Contract: a facet switches only its own dimension and retains every other active one. The
 * facet row owns status and collection membership, so `all` clears exactly those two while
 * retaining the search form's dimensions (`q`, `activity`). Every target returns to page 1.
 *
 * A facet always *selects* its own value rather than toggling it off when already active —
 * `all` is the single way back. Toggling would make an active chip's count describe the
 * deselected view, which reads as a wrong number even though it matches its link.
 */
export function buildAdminProductFacetTargets(
  query: AdminProductDirectoryQuery,
): Readonly<Record<AdminProductFacetKey, AdminProductDirectoryQuery>> {
  const selectStatus = (status: AdminProductContentState): AdminProductDirectoryQuery => ({
    ...query,
    status,
    page: 1,
  });

  return {
    all: { ...query, status: null, collection: null, uncategorized: false, page: 1 },
    draft: selectStatus("DRAFT"),
    reviewed: selectStatus("REVIEWED"),
    published: selectStatus("PUBLISHED"),
    uncategorized: { ...query, collection: null, uncategorized: true, page: 1 },
  };
}

export function buildAdminProductFacetHref(
  query: AdminProductDirectoryQuery,
  facet: Readonly<
    Partial<
      Pick<
        AdminProductDirectoryQuery,
        "status" | "collection" | "uncategorized" | "activity" | "health"
      >
    >
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
    query.activity !== null ||
    query.health !== null
  );
}

/**
 * The switch-to target for every health chip, and — exactly like the status/collection facets —
 * the single source both its link and its count come from.
 *
 * Two of the five approved blockers are aliases of dimensions the directory already owns, so they
 * select `collection=none` and `activity=inactive` rather than inventing a second URL spelling of
 * the same query. Every chip selects only its own dimension, retains the rest, and returns to
 * page 1; `buildAdminProductHealthClearTarget` is the single way back out.
 */
export const ADMIN_PRODUCT_HEALTH_KEYS = [
  "stocked-inactive",
  "zero-active",
  "no-collection",
  "catalog-inactive",
  "missing-image",
] as const;

export type AdminProductHealthKey = (typeof ADMIN_PRODUCT_HEALTH_KEYS)[number];

export function buildAdminProductHealthTargets(
  query: AdminProductDirectoryQuery,
): Readonly<Record<AdminProductHealthKey, AdminProductDirectoryQuery>> {
  const selectHealth = (health: AdminProductHealth): AdminProductDirectoryQuery => ({
    ...query,
    health,
    page: 1,
  });

  return {
    "stocked-inactive": selectHealth("stocked-inactive"),
    "zero-active": selectHealth("zero-active"),
    "no-collection": { ...query, collection: null, uncategorized: true, page: 1 },
    "catalog-inactive": { ...query, activity: "inactive", page: 1 },
    "missing-image": selectHealth("missing-image"),
  };
}

/** Clears every health-carrying dimension, including the two aliased ones. */
export function buildAdminProductHealthClearTarget(
  query: AdminProductDirectoryQuery,
): AdminProductDirectoryQuery {
  return { ...query, health: null, uncategorized: false, activity: null, page: 1 };
}

export function isAdminProductHealthKeyActive(
  query: AdminProductDirectoryQuery,
  key: AdminProductHealthKey,
): boolean {
  switch (key) {
    case "no-collection":
      return query.uncategorized;
    case "catalog-inactive":
      return query.activity === "inactive";
    default:
      return query.health === key;
  }
}

export function hasActiveAdminProductHealthFilter(query: AdminProductDirectoryQuery): boolean {
  return ADMIN_PRODUCT_HEALTH_KEYS.some((key) => isAdminProductHealthKeyActive(query, key));
}
