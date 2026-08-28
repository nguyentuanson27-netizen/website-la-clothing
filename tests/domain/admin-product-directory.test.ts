import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_PRODUCT_DIRECTORY_LIMITS,
  ADMIN_PRODUCT_HEALTH_KEYS,
  ADMIN_PRODUCT_UNCATEGORIZED,
  buildAdminProductDirectoryHref,
  buildAdminProductFacetHref,
  buildAdminProductHealthClearTarget,
  buildAdminProductHealthTargets,
  hasActiveAdminProductFilters,
  hasActiveAdminProductHealthFilter,
  isAdminProductHealthKeyActive,
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
    health: null,
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
    { health: "no-collection" },
    { health: "catalog-inactive" },
    { health: "missing image" },
    { health: ["zero-active", "missing-image"] },
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

test("health filters round-trip and keep one canonical URL per result set", () => {
  const query = parseAdminProductDirectorySearchParams({
    q: "linen",
    health: "missing-image",
    page: "4",
  });

  assert.equal(query.health, "missing-image");
  assert.equal(hasActiveAdminProductFilters(query), true);
  assert.equal(hasActiveAdminProductHealthFilter(query), true);
  assert.equal(
    buildAdminProductDirectoryHref(query),
    "/admin?q=linen&health=missing-image&page=4",
  );

  const targets = buildAdminProductHealthTargets(parseAdminProductDirectorySearchParams({}));
  assert.equal(
    buildAdminProductDirectoryHref(targets["no-collection"]),
    "/admin?collection=none",
    "the no-collection blocker keeps the existing uncategorized spelling",
  );
  assert.equal(
    buildAdminProductDirectoryHref(targets["catalog-inactive"]),
    "/admin?activity=inactive",
    "the catalog-inactive blocker keeps the existing activity spelling",
  );
  assert.equal(
    buildAdminProductDirectoryHref(targets["stocked-inactive"]),
    "/admin?health=stocked-inactive",
  );
});

test("a health chip switches only its own dimension and always returns to page 1", () => {
  const query = parseAdminProductDirectorySearchParams({
    q: "linen",
    status: "REVIEWED",
    sort: "synced-desc",
    page: "6",
  });
  const targets = buildAdminProductHealthTargets(query);

  for (const key of ADMIN_PRODUCT_HEALTH_KEYS) {
    const target = targets[key];
    assert.equal(target.page, 1, `${key} must reset pagination`);
    assert.equal(target.query, "linen", `${key} must retain the search term`);
    assert.equal(target.status, "REVIEWED", `${key} must retain the status facet`);
    assert.equal(target.sort, "synced-desc", `${key} must retain the sort order`);
    assert.equal(
      isAdminProductHealthKeyActive(target, key),
      true,
      `${key} must describe the view its own link opens`,
    );
  }
});

test("clearing health removes every health-carrying dimension, aliases included", () => {
  const query = parseAdminProductDirectorySearchParams({
    q: "linen",
    status: "DRAFT",
    collection: ADMIN_PRODUCT_UNCATEGORIZED,
    activity: "inactive",
    health: "zero-active",
  });
  assert.equal(hasActiveAdminProductHealthFilter(query), true);

  const cleared = buildAdminProductHealthClearTarget(query);
  assert.equal(hasActiveAdminProductHealthFilter(cleared), false);
  assert.equal(cleared.query, "linen");
  assert.equal(cleared.status, "DRAFT");
  assert.equal(buildAdminProductDirectoryHref(cleared), "/admin?q=linen&status=DRAFT");
});

test("clearing health keeps an activity filter that is not a health blocker", () => {
  const query = parseAdminProductDirectorySearchParams({
    activity: "active",
    health: "missing-image",
  });

  const cleared = buildAdminProductHealthClearTarget(query);
  assert.equal(
    cleared.activity,
    "active",
    "only the aliased inactive value belongs to the health row",
  );
  assert.equal(cleared.health, null);
  assert.equal(hasActiveAdminProductHealthFilter(cleared), false);
  assert.equal(buildAdminProductDirectoryHref(cleared), "/admin?activity=active");
});
