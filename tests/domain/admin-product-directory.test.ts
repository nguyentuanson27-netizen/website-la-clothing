import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_PRODUCT_DIRECTORY_LIMITS,
  ADMIN_PRODUCT_UNCATEGORIZED,
  buildAdminProductDirectoryHref,
  buildAdminProductFacetHref,
  hasActiveAdminProductFilters,
  parseAdminProductDirectorySearchParams,
} from "../../src/commerce/admin-product-directory.ts";

test("empty admin search params yield the unfiltered default directory", () => {
  const query = parseAdminProductDirectorySearchParams({});

  assert.deepEqual(query, {
    query: null,
    status: null,
    collection: null,
    uncategorized: false,
    activity: null,
    sort: "name-asc",
    page: 1,
  });
  assert.equal(hasActiveAdminProductFilters(query), false);
  assert.equal(buildAdminProductDirectoryHref(query), "/admin");
});

test("supported admin filters round-trip through parse and build", () => {
  const query = parseAdminProductDirectorySearchParams({
    q: "linen shirt",
    status: "REVIEWED",
    collection: "city-uniform",
    activity: "inactive",
    sort: "synced-desc",
    page: "3",
  });

  assert.equal(query.query, "linen shirt");
  assert.equal(query.status, "REVIEWED");
  assert.equal(query.collection, "city-uniform");
  assert.equal(query.uncategorized, false);
  assert.equal(query.activity, "inactive");
  assert.equal(query.sort, "synced-desc");
  assert.equal(query.page, 3);
  assert.equal(hasActiveAdminProductFilters(query), true);

  assert.deepEqual(
    parseAdminProductDirectorySearchParams(
      Object.fromEntries(
        new URL(
          buildAdminProductDirectoryHref(query),
          "https://admin.example.com",
        ).searchParams.entries(),
      ),
    ),
    query,
  );
});

test("the uncategorized sentinel is a collection state, not a slug", () => {
  const query = parseAdminProductDirectorySearchParams({
    collection: ADMIN_PRODUCT_UNCATEGORIZED,
  });

  assert.equal(query.uncategorized, true);
  assert.equal(query.collection, null);
  assert.equal(buildAdminProductDirectoryHref(query), "/admin?collection=none");
});

test("default-valued state is stripped from generated admin hrefs", () => {
  const query = parseAdminProductDirectorySearchParams({ sort: "name-asc", page: "1" });

  assert.equal(buildAdminProductDirectoryHref(query), "/admin");
  assert.equal(buildAdminProductDirectoryHref(query, 2), "/admin?page=2");
});

test("changing a facet returns to page 1 so a stale page cannot outrun the result set", () => {
  const query = parseAdminProductDirectorySearchParams({ q: "shirt", page: "7" });

  assert.equal(
    buildAdminProductFacetHref(query, { status: "PUBLISHED" }),
    "/admin?q=shirt&status=PUBLISHED",
  );
  assert.equal(
    buildAdminProductFacetHref(query, { collection: "city-uniform" }),
    "/admin?q=shirt&collection=city-uniform",
  );
});

test("unsupported admin parameter values are rejected", () => {
  const rejected: Record<string, string | string[]>[] = [
    { status: "ARCHIVED" },
    { activity: "hidden" },
    { sort: "price-asc" },
    { page: "0" },
    { page: "-2" },
    { page: String(ADMIN_PRODUCT_DIRECTORY_LIMITS.page + 1) },
    { collection: "City Uniform" },
    { collection: "city--uniform" },
    { q: "x".repeat(ADMIN_PRODUCT_DIRECTORY_LIMITS.query + 1) },
    { q: ["a", "b"] },
  ];

  for (const searchParams of rejected) {
    assert.throws(
      () => parseAdminProductDirectorySearchParams(searchParams),
      RangeError,
      `expected ${JSON.stringify(searchParams)} to be rejected`,
    );
  }
});

test("out-of-range pages are refused by the href builder", () => {
  const query = parseAdminProductDirectorySearchParams({});

  assert.throws(() => buildAdminProductDirectoryHref(query, 0), RangeError);
  assert.throws(
    () => buildAdminProductDirectoryHref(query, ADMIN_PRODUCT_DIRECTORY_LIMITS.page + 1),
    RangeError,
  );
});
