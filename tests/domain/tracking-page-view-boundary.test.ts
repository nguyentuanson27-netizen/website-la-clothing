import assert from "node:assert/strict";
import test from "node:test";

import { buildPageViewEvent } from "../../src/tracking/commerce-events.ts";
import { canonicalizeTrackingEvent } from "../../src/tracking/event-boundary.ts";
import { publishTrackingEvent } from "../../src/tracking/data-layer.ts";

test("T3 page_view rejects query or fragment data embedded in pathname", () => {
  for (const pathname of [
    "/checkout?email=a@example.com",
    "/shop/ao-oxford#reviews",
  ]) {
    assert.throws(
      () => buildPageViewEvent({ pathname }),
      /path-only/,
      `${pathname} must not become canonical page_path`,
    );
  }
});

test("T3 final canonicalization and publisher fail closed on non-path-only page_view", () => {
  for (const pagePath of [
    "/checkout?email=a@example.com",
    "/shop/ao-oxford#reviews",
  ]) {
    const event = { event: "page_view", page_path: pagePath } as const;

    assert.throws(
      () => canonicalizeTrackingEvent(event),
      /path-only/,
      `${pagePath} must be rejected at the final canonical boundary`,
    );

    const host: { dataLayer?: unknown } = {};
    assert.equal(publishTrackingEvent(host, event), false);
    assert.equal(
      host.dataLayer,
      undefined,
      "malformed page_view must fail before dataLayer initialization",
    );
  }
});
