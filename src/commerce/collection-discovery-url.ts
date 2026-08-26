import {
  parseStorefrontDiscoverySearchParams,
  type StorefrontDiscoveryQuery,
  type StorefrontDiscoverySearchParams,
} from "./storefront-discovery.ts";

export type CollectionDiscoveryUrlState = Pick<
  StorefrontDiscoveryQuery,
  "size" | "sort" | "page"
>;

export function parseCollectionDiscoverySearchParams(
  routeSlug: string,
  searchParams: StorefrontDiscoverySearchParams,
): StorefrontDiscoveryQuery {
  return parseStorefrontDiscoverySearchParams({
    collection: routeSlug,
    size: searchParams.size,
    sort: searchParams.sort,
    page: searchParams.page,
  });
}

export function buildCollectionDiscoveryHref(
  routeSlug: string,
  state: CollectionDiscoveryUrlState,
): string {
  const parsed = parseStorefrontDiscoverySearchParams({
    collection: routeSlug,
    size: state.size ?? undefined,
    sort: state.sort,
    page: String(state.page),
  });

  if (!parsed.collection) {
    throw new RangeError("Collection route slug is required");
  }

  const params = new URLSearchParams();
  if (parsed.size) params.set("size", parsed.size);
  if (parsed.sort !== "name-asc") params.set("sort", parsed.sort);
  if (parsed.page !== 1) params.set("page", String(parsed.page));

  const pathname = `/collections/${parsed.collection}`;
  const serialized = params.toString();
  return serialized.length > 0 ? `${pathname}?${serialized}` : pathname;
}
