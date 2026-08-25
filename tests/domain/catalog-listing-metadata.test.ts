import assert from "node:assert/strict";
import test from "node:test";

import { buildCatalogListingMetadata } from "../../src/seo/catalog-listing-metadata.ts";

function canonical(metadata: ReturnType<typeof buildCatalogListingMetadata>): string | null {
  const value = metadata.alternates?.canonical;
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.toString();
  return null;
}

test("P15 emits self-canonical metadata for base and pure paginated catalog listings", () => {
  assert.equal(
    canonical(
      buildCatalogListingMetadata({
        origin: "https://shop.example.com",
        indexingEnabled: true,
        pathname: "/shop",
        searchParams: {},
        title: "Cửa hàng",
        description: "Browse LA Clothing menswear.",
      }),
    ),
    "https://shop.example.com/shop",
  );

  assert.equal(
    canonical(
      buildCatalogListingMetadata({
        origin: "https://shop.example.com",
        indexingEnabled: true,
        pathname: "/shop",
        searchParams: { page: "2" },
        title: "Cửa hàng",
      }),
    ),
    "https://shop.example.com/shop?page=2",
  );

  assert.equal(
    canonical(
      buildCatalogListingMetadata({
        origin: "https://shop.example.com",
        indexingEnabled: true,
        pathname: "/collections/summer-shirts",
        searchParams: { page: "27" },
        title: "Summer Shirts",
      }),
    ),
    "https://shop.example.com/collections/summer-shirts?page=27",
  );
});

test("P15 withholds catalog canonical metadata for noindex query states and staging", () => {
  const cases = [
    { indexingEnabled: false, pathname: "/shop", searchParams: {} },
    { indexingEnabled: false, pathname: "/shop", searchParams: { page: "2" } },
    { indexingEnabled: true, pathname: "/shop", searchParams: { page: "1" } },
    { indexingEnabled: true, pathname: "/shop", searchParams: { page: "01" } },
    { indexingEnabled: true, pathname: "/shop", searchParams: { page: ["2", "3"] } },
    { indexingEnabled: true, pathname: "/shop", searchParams: { page: "2", sort: "name-asc" } },
    { indexingEnabled: true, pathname: "/shop", searchParams: { q: "shirt", page: "2" } },
    { indexingEnabled: true, pathname: "/collections/summer-shirts", searchParams: { page: "2", color: "black" } },
  ] as const;

  for (const input of cases) {
    const metadata = buildCatalogListingMetadata({
      origin: "https://shop.example.com",
      indexingEnabled: input.indexingEnabled,
      pathname: input.pathname,
      searchParams: input.searchParams,
      title: "Catalog",
    });
    assert.equal(canonical(metadata), null, `${input.pathname} must withhold canonical for this state`);
  }
});

test("P15 preserves factual listing title and description independently of canonical exposure", () => {
  const metadata = buildCatalogListingMetadata({
    origin: "https://shop.example.com",
    indexingEnabled: false,
    pathname: "/collections/summer-shirts",
    searchParams: {},
    title: "Summer Shirts",
    description: "Lightweight shirts for warm days.",
  });

  assert.equal(metadata.title, "Summer Shirts");
  assert.equal(metadata.description, "Lightweight shirts for warm days.");
  assert.equal(canonical(metadata), null);
});
