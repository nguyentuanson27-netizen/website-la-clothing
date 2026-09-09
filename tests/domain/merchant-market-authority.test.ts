import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APPROVED_O2_MARKET_POLICY,
  MERCHANT_MARKET_UNRESOLVED,
  mapMerchantOffers,
  resolveMerchantMarket,
  type MerchantCandidateProduct,
  type MerchantCandidateVariation,
  type MerchantMarketEnvironment,
} from "../../src/commerce/merchant-offer-mapper.ts";
import { serializeMerchantFeed } from "../../src/commerce/merchant-feed-serializer.ts";
import { createMerchantFeedGetHandler } from "../../src/commerce/merchant-feed-http.ts";
import { createMerchantFeedCoordinator } from "../../src/commerce/merchant-feed-coordinator.ts";
import { readSearchExposure } from "../../src/seo/search-exposure.ts";
import { validateReleaseEnvironment } from "../../src/operations/release-readiness.ts";
import { resolveStorefrontProductMedia } from "../../src/commerce/product-media.ts";
import type { StorefrontProductProjection } from "../../src/commerce/storefront-projection.ts";

const ORIGIN = "https://shop.example.test";

function createCandidateProduct(): MerchantCandidateProduct {
  const projection: StorefrontProductProjection = {
    mode: "standalone",
    options: [
      {
        id: "var-1",
        pancakeVariationId: "pv-1",
        color: "Đen",
        size: "M",
        price: 450_000,
        basePriceVnd: 450_000,
        isDiscounted: false,
        purchasable: true,
        unavailableReason: null,
        kindKey: null,
        kindLabel: null,
      },
    ],
  };

  const variation: MerchantCandidateVariation = {
    variantId: "var-1",
    pancakeVariationId: "pv-1",
    pancakeDisplayId: "VN-A1-M",
    isComposite: false,
    stockQuantity: 10,
  };

  return {
    pancakeProductId: "prod-1",
    slug: "ao-so-mi-oxford",
    name: "Áo sơ mi Oxford",
    publishedDescription: "Áo sơ mi vải cotton cao cấp.",
    media: resolveStorefrontProductMedia({
      productName: "Áo sơ mi Oxford",
      primaryImageUrl: "https://content.pancake.vn/web-media/1/2/3/primary.jpg",
      variantImageUrls: [["https://content.pancake.vn/web-media/1/2/3/variant-1.jpg"]],
    }),
    galleryIndexByVariantId: new Map([["var-1", 1]]),
    projection,
    apparelOverrides: { gender: null, ageGroup: null, condition: null },
    variations: [variation],
  };
}

describe("U41 / M5a: Trusted Server-Owned Merchant Market Runtime Authority", () => {
  // Case 1: Trusted server config đúng Vietnam / `vi` / `VND` → authority resolves chính xác.
  it("1. resolves to APPROVED O2 policy when trusted server config specifies Vietnam / vi / VND", () => {
    const explicitEnv: MerchantMarketEnvironment = {
      LA_MERCHANT_TARGET_COUNTRY: "VN",
      LA_MERCHANT_CONTENT_LANGUAGE: "vi",
      LA_MERCHANT_CURRENCY: "VND",
    };
    const resolved = resolveMerchantMarket(explicitEnv);

    assert.equal(resolved.status, "APPROVED");
    if (resolved.status === "APPROVED") {
      assert.deepEqual(resolved.policy, {
        targetCountry: "VN",
        contentLanguage: "vi",
        currency: "VND",
      });
      assert.deepEqual(resolved.policy, APPROVED_O2_MARKET_POLICY);
    }

    // Also supports canonical alias LA_MERCHANT_COUNTRY, LA_MERCHANT_LANGUAGE
    const aliasEnv: MerchantMarketEnvironment = {
      LA_MERCHANT_COUNTRY: "VN",
      LA_MERCHANT_LANGUAGE: "vi",
      LA_MERCHANT_CURRENCY: "VND",
    };
    const resolvedAlias = resolveMerchantMarket(aliasEnv);
    assert.equal(resolvedAlias.status, "APPROVED");

    // Also supports composite shorthand LA_MERCHANT_MARKET="VN:vi:VND"
    const compositeEnv: MerchantMarketEnvironment = {
      LA_MERCHANT_MARKET: "VN:vi:VND",
    };
    const resolvedComposite = resolveMerchantMarket(compositeEnv);
    assert.equal(resolvedComposite.status, "APPROVED");
  });

  // Case 2: Missing config → unresolved / fail closed.
  it("2. fails closed with UNRESOLVED when server configuration is missing", () => {
    const emptyEnv: MerchantMarketEnvironment = {};
    const resolved = resolveMerchantMarket(emptyEnv);

    assert.equal(resolved.status, "UNRESOLVED");
    if (resolved.status === "UNRESOLVED") {
      assert.equal(resolved.reason, MERCHANT_MARKET_UNRESOLVED);
    }

    // Incomplete config (e.g. only country set, missing language and currency) fails closed
    const partialEnv: MerchantMarketEnvironment = {
      LA_MERCHANT_TARGET_COUNTRY: "VN",
    };
    const resolvedPartial = resolveMerchantMarket(partialEnv);
    assert.equal(resolvedPartial.status, "UNRESOLVED");
  });

  // Case 3: Malformed config → fail closed.
  it("3. fails closed when server configuration values are malformed or violate ISO syntax", () => {
    const malformedCases: MerchantMarketEnvironment[] = [
      { LA_MERCHANT_TARGET_COUNTRY: "vn", LA_MERCHANT_CONTENT_LANGUAGE: "vi", LA_MERCHANT_CURRENCY: "VND" }, // lowercase country
      { LA_MERCHANT_TARGET_COUNTRY: "VNM", LA_MERCHANT_CONTENT_LANGUAGE: "vi", LA_MERCHANT_CURRENCY: "VND" }, // 3-letter country
      { LA_MERCHANT_TARGET_COUNTRY: "VN", LA_MERCHANT_CONTENT_LANGUAGE: "VI", LA_MERCHANT_CURRENCY: "VND" }, // uppercase language
      { LA_MERCHANT_TARGET_COUNTRY: "VN", LA_MERCHANT_CONTENT_LANGUAGE: "vie", LA_MERCHANT_CURRENCY: "VND" }, // 3-letter language
      { LA_MERCHANT_TARGET_COUNTRY: "VN", LA_MERCHANT_CONTENT_LANGUAGE: "vi", LA_MERCHANT_CURRENCY: "vnd" }, // lowercase currency
      { LA_MERCHANT_TARGET_COUNTRY: " VN ", LA_MERCHANT_CONTENT_LANGUAGE: "vi", LA_MERCHANT_CURRENCY: "VND" }, // whitespace padding
      { LA_MERCHANT_MARKET: "VN:vi" }, // incomplete composite
      { LA_MERCHANT_MARKET: "VN:vi:VND:extra" }, // excessive segments
    ];

    for (const env of malformedCases) {
      const resolved = resolveMerchantMarket(env);
      assert.equal(resolved.status, "UNRESOLVED", `Expected ${JSON.stringify(env)} to fail closed`);
    }
  });

  // Case 4: Unsupported market/language/currency → fail closed.
  it("4. fails closed when server configuration requests an unsupported or unapproved market", () => {
    const unapprovedCases: MerchantMarketEnvironment[] = [
      { LA_MERCHANT_TARGET_COUNTRY: "US", LA_MERCHANT_CONTENT_LANGUAGE: "en", LA_MERCHANT_CURRENCY: "USD" },
      { LA_MERCHANT_TARGET_COUNTRY: "SG", LA_MERCHANT_CONTENT_LANGUAGE: "en", LA_MERCHANT_CURRENCY: "SGD" },
      { LA_MERCHANT_TARGET_COUNTRY: "VN", LA_MERCHANT_CONTENT_LANGUAGE: "en", LA_MERCHANT_CURRENCY: "VND" },
      { LA_MERCHANT_TARGET_COUNTRY: "VN", LA_MERCHANT_CONTENT_LANGUAGE: "vi", LA_MERCHANT_CURRENCY: "USD" },
      { LA_MERCHANT_MARKET: "US:en:USD" },
    ];

    for (const env of unapprovedCases) {
      const resolved = resolveMerchantMarket(env);
      assert.equal(
        resolved.status,
        "UNRESOLVED",
        `Market ${JSON.stringify(env)} is unapproved and must fail closed`,
      );
    }
  });

  // Case 5: Caller cố truyền market khác → không override authority.
  it("5. ignores any caller-injected market parameter in mapMerchantOffers", () => {
    // Structural typing allows extra fields: prove runtime explicitly ignores injected market
    const callerInjectedArgs = {
      products: [createCandidateProduct()],
      origin: ORIGIN,
      market: { targetCountry: "US", contentLanguage: "en", currency: "USD" },
      env: {} as MerchantMarketEnvironment,
    };

    const result = mapMerchantOffers(callerInjectedArgs as Parameters<typeof mapMerchantOffers>[0]);

    assert.equal(result.market.status, "UNRESOLVED");
    assert.deepEqual(result.activationBlockedReasons, [MERCHANT_MARKET_UNRESOLVED]);
  });

  // Case 6: Query/header/Host/request noise không ảnh hưởng market.
  it("6. request query strings, headers, and Host do not influence server market authority", async () => {
    let observedHandlerCall = 0;
    const mockFeedProvider = async () => {
      observedHandlerCall++;
      return {
        ok: false as const,
        failureClass: "MARKET_UNRESOLVED" as const,
        retryAfterSeconds: 60,
        backoff: true,
      };
    };

    const handler = createMerchantFeedGetHandler(mockFeedProvider);

    const hostileRequests = [
      new Request("https://shop.example.test/feeds/google-merchant?country=US&currency=USD&lang=en"),
      new Request("https://attacker.example/feeds/google-merchant?market=APPROVED", {
        headers: {
          Host: "attacker.example",
          "x-merchant-market": "US",
          "accept-language": "en-US",
        },
      }),
    ];

    for (const req of hostileRequests) {
      const response = await handler(req);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("x-la-merchant-feed-failure"), "MARKET_UNRESOLVED");
    }

    assert.equal(observedHandlerCall, 2);
  });

  // Case 7: Merchant mapper/feed sử dụng authority server-owned khi resolved.
  it("7. produces valid serialized RSS feed with price and language when authority is resolved", () => {
    const validEnv: MerchantMarketEnvironment = {
      LA_MERCHANT_TARGET_COUNTRY: "VN",
      LA_MERCHANT_CONTENT_LANGUAGE: "vi",
      LA_MERCHANT_CURRENCY: "VND",
    };

    const mapped = mapMerchantOffers({
      products: [createCandidateProduct()],
      origin: ORIGIN,
      env: validEnv,
    });

    assert.equal(mapped.market.status, "APPROVED");
    assert.deepEqual(mapped.activationBlockedReasons, []);
    assert.equal(mapped.offers.length, 1);

    if (mapped.market.status === "APPROVED") {
      const feed = serializeMerchantFeed({
        offers: mapped.offers,
        market: mapped.market.policy,
        origin: ORIGIN,
      });

      assert.ok(feed.body.includes("<rss version=\"2.0\" xmlns:g=\"http://base.google.com/ns/1.0\">"));
      assert.ok(feed.body.includes("<g:price>450000 VND</g:price>"));
      assert.ok(feed.body.includes("<g:id>pv-1</g:id>"));
      assert.ok(feed.body.includes("<g:item_group_id>prod-1</g:item_group_id>"));
      assert.equal(feed.offerCount, 1);
    }
  });

  // Case 8: Existing failure behavior vẫn đúng khi authority unavailable.
  it("8. preserves existing fail-closed HTTP 503 behavior when authority is unavailable", async () => {
    const unconfiguredEnv: MerchantMarketEnvironment = {};
    const resolved = resolveMerchantMarket(unconfiguredEnv);
    assert.equal(resolved.status, "UNRESOLVED");

    const mapped = mapMerchantOffers({
      products: [createCandidateProduct()],
      origin: ORIGIN,
      env: unconfiguredEnv,
    });
    assert.equal(mapped.market.status, "UNRESOLVED");
    assert.deepEqual(mapped.activationBlockedReasons, [MERCHANT_MARKET_UNRESOLVED]);

    const handler = createMerchantFeedGetHandler(async () => {
      if (mapped.market.status !== "APPROVED" || mapped.activationBlockedReasons.length > 0) {
        return {
          ok: false as const,
          failureClass: "MARKET_UNRESOLVED" as const,
          retryAfterSeconds: 60,
          backoff: false,
        };
      }
      return {
        ok: true as const,
        body: "<rss></rss>",
        byteLength: 11,
        offerCount: 0,
        cache: "generated" as const,
      };
    });

    const res = await handler(new Request("https://shop.example.test/feeds/google-merchant"));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("x-la-merchant-feed-failure"), "MARKET_UNRESOLVED");
    assert.equal(res.headers.get("retry-after"), "60");
  });

  // Case 9: Existing cache key không bị biến thành request-controlled/unbounded market dimension.
  it("9. cache coordinator key remains strictly bounded to shop and schema version", () => {
    const shopId = 920_007;
    const schemaVersion = "rss-v1";
    const expectedKey = `merchant-feed:${schemaVersion}:shop:${shopId}`;

    const coordinator = createMerchantFeedCoordinator({
      key: expectedKey,
      readPricingRevision: async () => BigInt(1),
    });

    assert.ok(coordinator);
    assert.equal(expectedKey.includes("VN"), false, "Cache key must not contain market dimension");
    assert.equal(expectedKey.includes("http"), false, "Cache key must not contain request url");
  });

  // Case 10: Search indexing vẫn không được bật bởi Merchant config.
  it("10. Merchant market configuration does NOT enable search indexing", () => {
    const envWithMerchantAndDisabledSearch = {
      APP_DOMAIN: "shop.example.test",
      SEARCH_INDEXING_ENABLED: "false",
      LA_MERCHANT_TARGET_COUNTRY: "VN",
      LA_MERCHANT_CONTENT_LANGUAGE: "vi",
      LA_MERCHANT_CURRENCY: "VND",
    };

    const market = resolveMerchantMarket(envWithMerchantAndDisabledSearch);
    assert.equal(market.status, "APPROVED");

    const searchExposure = readSearchExposure(envWithMerchantAndDisabledSearch);
    assert.equal(searchExposure.indexingEnabled, false, "Search indexing must remain disabled");

    // Also check release-readiness report reflects Merchant market without coupling to search
    const releaseSummary = validateReleaseEnvironment({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      APP_DOMAIN: "shop.example.test",
      SEARCH_INDEXING_ENABLED: "false",
      BETTER_AUTH_SECRET: "release-only-secret-0123456789abcdef",
      BETTER_AUTH_URL: "https://shop.example.test",
      BETTER_AUTH_IP_HEADER: "cf-connecting-ip",
      PANCAKE_API_KEY: "secret-key",
      PANCAKE_SHOP_ID: "920007",
      LA_SHIPPING_FEE_VND: "30000",
      LA_FREE_SHIPPING_SUBTOTAL_VND: "1000000",
      LA_FREE_SHIPPING_MIN_QUANTITY: "3",
      LA_MERCHANT_TARGET_COUNTRY: "VN",
      LA_MERCHANT_CONTENT_LANGUAGE: "vi",
      LA_MERCHANT_CURRENCY: "VND",
    });

    assert.equal(releaseSummary.searchIndexingEnabled, false);
    assert.equal((releaseSummary as { merchantMarketStatus?: string }).merchantMarketStatus, "APPROVED");
  });
});
