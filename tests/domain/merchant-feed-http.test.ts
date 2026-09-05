import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMerchantFeedGetHandler } from "../../src/commerce/merchant-feed-http.ts";

describe("Merchant feed HTTP handler", () => {
  it("returns a complete XML success with bounded cache diagnostics", async () => {
    let calls = 0;
    const GET = createMerchantFeedGetHandler(async () => {
      calls += 1;
      return {
        ok: true as const,
        body: "<?xml version=\"1.0\"?><rss></rss>\n",
        byteLength: 34,
        offerCount: 1,
        cache: calls === 1 ? ("generated" as const) : ("hit" as const),
      };
    });

    const response = await GET(new Request("https://shop.example.test/feeds/google-merchant?foo=1"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/rss+xml; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-la-merchant-feed-state"), "generated");
    assert.equal(await response.text(), "<?xml version=\"1.0\"?><rss></rss>\n");
  });

  it("never forwards query strings or irrelevant headers into the feed service cache domain", async () => {
    let calls = 0;
    const getFeed = async () => {
      calls += 1;
      return {
        ok: true as const,
        body: "<rss></rss>\n",
        byteLength: 12,
        offerCount: 0,
        cache: "hit" as const,
      };
    };
    const GET = createMerchantFeedGetHandler(getFeed);

    await GET(
      new Request("https://shop.example.test/feeds/google-merchant?foo=1", {
        headers: { "x-noise": "a" },
      }),
    );
    await GET(
      new Request("https://evil.example/feeds/google-merchant?foo=2&country=VN&currency=VND", {
        headers: { "x-noise": "b", host: "evil.example" },
      }),
    );

    assert.equal(calls, 2);
    // `getFeed` accepts no Request argument: request-controlled dimensions cannot reach the key.
    assert.equal(getFeed.length, 0);
  });

  it("returns a generic bounded 503 with Retry-After during failure/backoff", async () => {
    const GET = createMerchantFeedGetHandler(async () => ({
      ok: false as const,
      failureClass: "MARKET_UNRESOLVED" as const,
      retryAfterSeconds: 60,
      backoff: true,
    }));

    const response = await GET(
      new Request("https://shop.example.test/feeds/google-merchant?currency=VND"),
    );

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("x-la-merchant-feed-failure"), "MARKET_UNRESOLVED");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Merchant feed temporarily unavailable.\n");
  });
});
