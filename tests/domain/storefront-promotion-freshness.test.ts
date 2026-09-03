import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STOREFRONT_PROMOTION_REFRESH_MS,
  resolveStorefrontPromotionRefresh,
} from "../../src/commerce/storefront-promotion-freshness.ts";

const NOW = new Date("2026-09-15T00:00:00.000Z");

test("storefront promotion freshness uses the next server boundary when it is within 60s", () => {
  assert.deepEqual(
    resolveStorefrontPromotionRefresh({
      now: NOW,
      nextBoundaryAt: new Date(NOW.getTime() + 5_000),
    }),
    { refreshAfterMs: 5_000 },
  );
});

test("storefront promotion freshness caps a distant or unknown boundary at 60s", () => {
  assert.deepEqual(
    resolveStorefrontPromotionRefresh({
      now: NOW,
      nextBoundaryAt: new Date(NOW.getTime() + 5 * 60_000),
    }),
    { refreshAfterMs: MAX_STOREFRONT_PROMOTION_REFRESH_MS },
  );
  assert.deepEqual(
    resolveStorefrontPromotionRefresh({ now: NOW, nextBoundaryAt: null }),
    { refreshAfterMs: MAX_STOREFRONT_PROMOTION_REFRESH_MS },
  );
});

test("storefront promotion freshness requests an immediate revalidation for a reached boundary", () => {
  assert.deepEqual(
    resolveStorefrontPromotionRefresh({
      now: NOW,
      nextBoundaryAt: new Date(NOW.getTime() - 1),
    }),
    { refreshAfterMs: 0 },
  );
});

test("storefront promotion freshness fails safely on a malformed boundary", () => {
  assert.deepEqual(
    resolveStorefrontPromotionRefresh({ now: NOW, nextBoundaryAt: new Date(Number.NaN) }),
    { refreshAfterMs: MAX_STOREFRONT_PROMOTION_REFRESH_MS },
  );
});
