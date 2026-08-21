import assert from "node:assert/strict";
import test from "node:test";

import { shouldNoIndexRequest } from "../../src/seo/search-exposure.ts";

function noindex(pathname: string, search: string): boolean {
  return shouldNoIndexRequest({
    indexingEnabled: true,
    pathname,
    search,
  });
}

test("P15 allows only canonical pure pagination query states for catalog listing pages", () => {
  assert.equal(noindex("/shop", "?page=2"), false);
  assert.equal(noindex("/shop", "?page=27"), false);
  assert.equal(noindex("/collections/summer-shirts", "?page=2"), false);

  for (const [pathname, search] of [
    ["/shop", "?page=1"],
    ["/shop", "?page=01"],
    ["/shop", "?page=0"],
    ["/shop", "?page=-2"],
    ["/shop", "?page=10001"],
    ["/shop", "?page=2&page=3"],
    ["/shop", "?page=2&sort=name-asc"],
    ["/shop", "?q=shirt&page=2"],
    ["/shop/current-product", "?page=2"],
    ["/collections/summer-shirts", "?page=2&color=black"],
    ["/collections", "?page=2"],
    ["/lookbook", "?page=2"],
  ] as const) {
    assert.equal(noindex(pathname, search), true, `${pathname}${search} must remain noindex`);
  }
});

test("P15 keeps pure pagination noindex while search exposure is disabled", () => {
  for (const [pathname, search] of [
    ["/shop", "?page=2"],
    ["/collections/summer-shirts", "?page=2"],
  ] as const) {
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: false, pathname, search }),
      true,
      `${pathname}${search} must remain noindex on staging/rollback`,
    );
  }
});
