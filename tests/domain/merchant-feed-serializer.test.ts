import { describe, expect, it } from "vitest";

import type { MerchantMarketPolicy, MerchantOffer } from "../../src/commerce/merchant-offer-mapper.ts";
import {
  MerchantFeedByteOverflowError,
  MerchantFeedSerializationError,
  assertMerchantOfferCount,
  serializeMerchantFeed,
} from "../../src/commerce/merchant-feed-serializer.ts";
import {
  MAX_MERCHANT_FEED_BYTES,
  MAX_MERCHANT_OFFERS,
} from "../../src/commerce/merchant-feed-limits.ts";

const MARKET: MerchantMarketPolicy = {
  targetCountry: "VN",
  contentLanguage: "vi",
  currency: "VND",
};

function offer(overrides: Partial<MerchantOffer> = {}): MerchantOffer {
  return {
    id: "variation-1",
    itemGroupId: "product-1",
    brand: "LA Clothing",
    mpn: "MPN-1",
    title: "Áo & quần <đẹp> 👕",
    description: "Mô tả & chi tiết > cơ bản",
    link: "https://shop.example.test/products/ao?variant=variation-1&view=full",
    imageLink: "https://cdn.example.test/a&b.jpg",
    additionalImageLinks: ["https://cdn.example.test/2.jpg"],
    availability: "in_stock",
    priceVnd: 249000,
    gender: "male",
    ageGroup: "adult",
    condition: "new",
    color: "Đen & Trắng",
    size: "M",
    ...overrides,
  };
}

describe("Merchant RSS serializer", () => {
  it("emits deterministic complete RSS 2.0 bytes from U25 facts", () => {
    const input = [
      offer({ id: "variation-2", itemGroupId: "product-2", mpn: "MPN-2" }),
      offer(),
    ];

    const first = serializeMerchantFeed({ offers: input, market: MARKET, origin: "https://shop.example.test" });
    const second = serializeMerchantFeed({ offers: [...input].reverse(), market: MARKET, origin: "https://shop.example.test" });

    expect(first.body).toBe(second.body);
    expect(first.byteLength).toBe(new TextEncoder().encode(first.body).byteLength);
    expect(first.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(first.body).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(first.body.endsWith("</channel></rss>\n")).toBe(true);
    expect(first.body.indexOf("variation-1")).toBeLessThan(first.body.indexOf("variation-2"));
    expect(first.body).toContain("<g:price>249000 VND</g:price>");
    expect(first.body).toContain("<g:availability>in_stock</g:availability>");
    expect(first.body).toContain("<g:item_group_id>product-1</g:item_group_id>");
  });

  it("escapes XML text and counts UTF-8 bytes after escaping expansion", () => {
    const result = serializeMerchantFeed({
      offers: [offer()],
      market: MARKET,
      origin: "https://shop.example.test",
    });

    expect(result.body).toContain("Áo &amp; quần &lt;đẹp&gt; 👕");
    expect(result.body).toContain("Đen &amp; Trắng");
    expect(result.body).toContain("variant=variation-1&amp;view=full");
    expect(result.body).not.toContain("<đẹp>");
    expect(result.byteLength).toBeGreaterThan(result.body.length);
  });

  it("rejects forbidden XML 1.0 control characters instead of producing malformed output", () => {
    expect(() =>
      serializeMerchantFeed({
        offers: [offer({ title: "bad\u0001title" })],
        market: MARKET,
        origin: "https://shop.example.test",
      }),
    ).toThrow(MerchantFeedSerializationError);
  });

  it.each([
    [MAX_MERCHANT_OFFERS - 1, true],
    [MAX_MERCHANT_OFFERS, true],
    [MAX_MERCHANT_OFFERS + 1, false],
  ])("enforces the offer-count boundary at %i", (count, allowed) => {
    if (allowed) expect(() => assertMerchantOfferCount(count)).not.toThrow();
    else expect(() => assertMerchantOfferCount(count)).toThrow(/5,000|5000/);
  });

  it("accepts the exact UTF-8 byte boundary and rejects the next byte without a partial body", () => {
    const baseline = serializeMerchantFeed({
      offers: [offer()],
      market: MARKET,
      origin: "https://shop.example.test",
    });

    expect(() =>
      serializeMerchantFeed({
        offers: [offer()],
        market: MARKET,
        origin: "https://shop.example.test",
        maxBytes: baseline.byteLength,
      }),
    ).not.toThrow();

    expect(() =>
      serializeMerchantFeed({
        offers: [offer()],
        market: MARKET,
        origin: "https://shop.example.test",
        maxBytes: baseline.byteLength - 1,
      }),
    ).toThrow(MerchantFeedByteOverflowError);
  });

  it("keeps the reviewed production byte ceiling at 16 MiB", () => {
    expect(MAX_MERCHANT_FEED_BYTES).toBe(16 * 1024 * 1024);
  });
});
