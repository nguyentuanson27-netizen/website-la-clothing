import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorefrontDiscoveryHref,
  parseStorefrontDiscoverySearchParams,
} from "../../src/commerce/storefront-discovery.ts";

test("parses bounded URL-backed storefront discovery filters", () => {
  assert.deepEqual(
    parseStorefrontDiscoverySearchParams({
      q: "  linen shirt  ",
      color: "Black",
      size: "M",
      availability: "in-stock",
      minPrice: "300000",
      maxPrice: "900000",
      collection: "city-uniform",
      sort: "price-asc",
      page: "2",
    }),
    {
      query: "linen shirt",
      color: "Black",
      size: "M",
      availability: "in-stock",
      minPriceVnd: 300000,
      maxPriceVnd: 900000,
      collection: "city-uniform",
      sort: "price-asc",
      page: 2,
    },
  );
});

test("rejects duplicate, malformed and contradictory discovery params", () => {
  assert.throws(
    () => parseStorefrontDiscoverySearchParams({ color: ["Black", "Stone"] }),
    /invalid/i,
  );
  assert.throws(
    () => parseStorefrontDiscoverySearchParams({ collection: "../sale" }),
    /invalid/i,
  );
  assert.throws(
    () => parseStorefrontDiscoverySearchParams({ minPrice: "900000", maxPrice: "300000" }),
    /invalid/i,
  );
  assert.throws(
    () => parseStorefrontDiscoverySearchParams({ q: "x".repeat(81) }),
    /invalid/i,
  );
});

test("builds stable pagination URLs without dropping active filters", () => {
  const query = parseStorefrontDiscoverySearchParams({
    q: "overshirt",
    color: "Olive",
    collection: "city-uniform",
    sort: "name-desc",
  });

  assert.equal(
    buildStorefrontDiscoveryHref(query, 3),
    "/shop?q=overshirt&color=Olive&collection=city-uniform&sort=name-desc&page=3",
  );
});
