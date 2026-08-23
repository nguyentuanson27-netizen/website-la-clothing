import assert from "node:assert/strict";
import test from "node:test";

import {
  readSearchExposure,
  shouldNoIndexRequest,
  validateSearchExposureForRelease,
} from "../../src/seo/search-exposure.ts";

const publicEnvironment = {
  APP_DOMAIN: "shop.example.com",
  SEARCH_INDEXING_ENABLED: "true",
} as const;

test("runtime search exposure defaults missing or malformed indexing requests to disabled", () => {
  assert.deepEqual(
    readSearchExposure({ APP_DOMAIN: "shop.example.com" }),
    {
      origin: "https://shop.example.com",
      indexingEnabled: false,
    },
  );
  assert.deepEqual(
    readSearchExposure({
      APP_DOMAIN: "shop.example.com",
      SEARCH_INDEXING_ENABLED: "TRUE",
    }),
    {
      origin: "https://shop.example.com",
      indexingEnabled: false,
    },
  );
});

test("runtime search exposure never enables staging or local origins", () => {
  for (const appDomain of ["staging.lanadesign.vn", "localhost:3000", "127.0.0.1:3000"]) {
    const exposure = readSearchExposure({
      APP_DOMAIN: appDomain,
      SEARCH_INDEXING_ENABLED: "true",
    });
    assert.equal(exposure.indexingEnabled, false, `${appDomain} must remain non-indexable`);
  }
});

test("runtime search exposure can enable only an explicitly requested public origin", () => {
  assert.deepEqual(readSearchExposure(publicEnvironment), {
    origin: "https://shop.example.com",
    indexingEnabled: true,
  });
});

test("release search exposure requires an explicit canonical boolean flag without echoing hostile input", () => {
  assert.throws(
    () => validateSearchExposureForRelease({ APP_DOMAIN: "shop.example.com" }),
    /SEARCH_INDEXING_ENABLED must be explicitly configured as true or false/,
  );

  const hostile = "TRUE?token=should-not-leak";
  try {
    validateSearchExposureForRelease({
      APP_DOMAIN: "shop.example.com",
      SEARCH_INDEXING_ENABLED: hostile,
    });
    assert.fail("expected malformed indexing flag to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /SEARCH_INDEXING_ENABLED/);
    assert.equal(message.includes(hostile), false);
    assert.equal(message.includes("should-not-leak"), false);
  }
});

test("release search exposure blocks indexing on staging/local but accepts explicit false", () => {
  for (const appDomain of ["staging.lanadesign.vn", "localhost:3000", "127.0.0.1:3000"]) {
    assert.throws(
      () =>
        validateSearchExposureForRelease({
          APP_DOMAIN: appDomain,
          SEARCH_INDEXING_ENABLED: "true",
        }),
      /Search indexing cannot be enabled on staging or local storefront origins/,
    );

    assert.deepEqual(
      validateSearchExposureForRelease({
        APP_DOMAIN: appDomain,
        SEARCH_INDEXING_ENABLED: "false",
      }),
      {
        origin: appDomain === "staging.lanadesign.vn" ? "https://staging.lanadesign.vn" : `http://${appDomain}`,
        indexingEnabled: false,
      },
    );
  }
});

test("release search exposure accepts explicit true on a non-staging public origin", () => {
  assert.deepEqual(validateSearchExposureForRelease(publicEnvironment), {
    origin: "https://shop.example.com",
    indexingEnabled: true,
  });
});

test("noindex policy is global for HTML surfaces while indexing is disabled", () => {
  for (const pathname of ["/", "/shop", "/shop/current-product", "/collections", "/lookbook", "/cart"]) {
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: false, pathname, search: "" }),
      true,
      `${pathname} must be noindex while search exposure is disabled`,
    );
  }
});

test("crawl-blocked API surfaces are outside the page-level noindex policy", () => {
  for (const indexingEnabled of [false, true]) {
    for (const pathname of ["/api", "/api/auth/session"]) {
      assert.equal(
        shouldNoIndexRequest({ indexingEnabled, pathname, search: "" }),
        false,
        `${pathname} must use robots crawl blocking instead of an unreachable noindex directive`,
      );
    }
  }
});

test("enabled noindex policy allows only explicit public routes without query state", () => {
  for (const pathname of [
    "/",
    "/shop",
    "/shop/current-product",
    "/collections",
    "/collections/summer-shirts",
    "/lookbook",
  ]) {
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: true, pathname, search: "" }),
      false,
      `${pathname} should be eligible when indexing is enabled`,
    );
  }

  for (const pathname of [
    "/admin",
    "/admin/products",
    "/account",
    "/cart",
    "/checkout",
    "/track-order",
    "/search",
    "/new-arrivals",
    "/unexpected",
    "/shop/a/nested-path",
    "/collections/a/nested-path",
  ]) {
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: true, pathname, search: "" }),
      true,
      `${pathname} must remain noindex`,
    );
  }

  for (const request of [
    { pathname: "/shop", search: "?sort=price-asc" },
    { pathname: "/shop/current-product", search: "?utm_source=test" },
    { pathname: "/collections/summer-shirts", search: "?color=black" },
  ]) {
    assert.equal(
      shouldNoIndexRequest({ indexingEnabled: true, ...request }),
      true,
      `${request.pathname}${request.search} must remain noindex`,
    );
  }
});
