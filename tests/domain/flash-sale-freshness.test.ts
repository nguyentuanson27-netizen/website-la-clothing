/** U17 / P7b — Flash surface consumes the shared server-relative promotion freshness contract. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STOREFRONT_PROMOTION_REFRESH_MS,
  resolveStorefrontPromotionRefresh,
} from "../../src/commerce/storefront-promotion-freshness.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

test("U17 freshness is capped at 60 seconds even when no Flash boundary is known", () => {
  const refresh = resolveStorefrontPromotionRefresh({ now: NOW, nextBoundaryAt: null });
  assert.equal(refresh.refreshAfterMs, 60_000);
  assert.equal(MAX_STOREFRONT_PROMOTION_REFRESH_MS, 60_000);
});

test("U17 a nearer Flash boundary shortens the server-relative wait", () => {
  const refresh = resolveStorefrontPromotionRefresh({
    now: NOW,
    nextBoundaryAt: new Date(NOW.getTime() + 15_000),
  });
  assert.deepEqual(refresh, { refreshAfterMs: 15_000 });
});

test("U17 reached boundaries refresh immediately and never emit a negative wait", () => {
  for (const offset of [0, -1, -60_000]) {
    const refresh = resolveStorefrontPromotionRefresh({
      now: NOW,
      nextBoundaryAt: new Date(NOW.getTime() + offset),
    });
    assert.equal(refresh.refreshAfterMs, 0);
  }
});

test("U17 the client receives only a duration, never an absolute deadline", () => {
  const refresh = resolveStorefrontPromotionRefresh({
    now: NOW,
    nextBoundaryAt: new Date(NOW.getTime() + 20_000),
  });
  assert.deepEqual(Object.keys(refresh), ["refreshAfterMs"]);
});

test("U17 browser clock skew cannot affect a server-owned duration", () => {
  const boundary = new Date(NOW.getTime() + 30_000);
  const first = resolveStorefrontPromotionRefresh({ now: NOW, nextBoundaryAt: boundary });
  const second = resolveStorefrontPromotionRefresh({
    now: new Date(NOW),
    nextBoundaryAt: new Date(boundary),
  });
  assert.deepEqual(first, second);
});
