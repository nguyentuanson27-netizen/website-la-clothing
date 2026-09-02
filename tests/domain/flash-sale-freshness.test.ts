/**
 * U17 / P7b — server-relative Flash freshness.
 *
 * The rule this protects is that the browser's clock is never authority. A device whose clock is
 * hours off, or deliberately set forward, must not be able to make a Flash Sale look started or
 * finished. So the server never sends an absolute deadline for the client to compare against
 * `Date.now()`; it sends a *duration* to wait, computed from its own instant, and the client's only
 * job is to come back after that long and ask again.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FLASH_SALE_REFRESH_MS,
  resolveFlashSaleRefresh,
} from "../../src/commerce/flash-sale-freshness.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

test("U17 freshness is capped at 60 seconds even when nothing is scheduled", () => {
  const refresh = resolveFlashSaleRefresh({ now: NOW, nextBoundaryAt: null });

  assert.equal(refresh.refreshAfterMs, MAX_FLASH_SALE_REFRESH_MS);
  assert.equal(MAX_FLASH_SALE_REFRESH_MS, 60_000, "the reviewed staleness bound is 60 seconds");
});

test("U17 a boundary sooner than the cap shortens the wait to that boundary", () => {
  const refresh = resolveFlashSaleRefresh({
    now: NOW,
    nextBoundaryAt: new Date(NOW.getTime() + 15_000),
  });

  assert.equal(refresh.refreshAfterMs, 15_000, "the page must come back exactly when it changes");
});

test("U17 a boundary beyond the cap still refreshes within 60 seconds", () => {
  const refresh = resolveFlashSaleRefresh({
    now: NOW,
    nextBoundaryAt: new Date(NOW.getTime() + 3_600_000),
  });

  assert.equal(refresh.refreshAfterMs, MAX_FLASH_SALE_REFRESH_MS);
});

test("U17 a boundary already reached or passed refreshes immediately rather than going negative", () => {
  for (const offset of [0, -1, -60_000, -86_400_000]) {
    const refresh = resolveFlashSaleRefresh({
      now: NOW,
      nextBoundaryAt: new Date(NOW.getTime() + offset),
    });

    assert.equal(refresh.refreshAfterMs, 0, `an offset of ${offset}ms must not produce a wait`);
  }
});

test("U17 the emitted fact is a duration, never an absolute deadline", () => {
  // An absolute timestamp would invite the client to compare it with its own clock, which is the
  // failure this contract exists to prevent. The shape itself forecloses that.
  const refresh = resolveFlashSaleRefresh({
    now: NOW,
    nextBoundaryAt: new Date(NOW.getTime() + 20_000),
  });

  assert.deepEqual(Object.keys(refresh), ["refreshAfterMs"]);
  assert.equal(typeof refresh.refreshAfterMs, "number");
});

test("U17 client clock skew cannot change the emitted wait", () => {
  // The same server instant and the same boundary produce the same duration no matter what any
  // browser believes the time to be, because no browser value is an input here.
  const boundary = new Date(NOW.getTime() + 30_000);
  const first = resolveFlashSaleRefresh({ now: NOW, nextBoundaryAt: boundary });
  const second = resolveFlashSaleRefresh({ now: new Date(NOW), nextBoundaryAt: new Date(boundary) });

  assert.deepEqual(first, second);
  assert.equal(first.refreshAfterMs, 30_000);
});

test("U17 a malformed boundary falls back to the capped refresh rather than throwing", () => {
  const refresh = resolveFlashSaleRefresh({ now: NOW, nextBoundaryAt: new Date(Number.NaN) });

  assert.equal(refresh.refreshAfterMs, MAX_FLASH_SALE_REFRESH_MS);
});
