import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildCatalogAcceptanceReport } from "../../src/commerce/catalog-acceptance.ts";

const trustedImage = "https://content.pancake.vn/catalog/1/2/3/item.jpg";
const standaloneSourceModel = {
  compositeParentVariations: 0,
  compositeProjectionReady: true,
} as const;

function publishedContent(collectionSlugs: readonly string[]) {
  return {
    status: "PUBLISHED" as const,
    editorialDescription: "Published website-owned editorial copy.",
    seoTitle: "Product SEO title",
    seoDescription: "Product SEO description",
    collectionSlugs,
  };
}

test("P17 acceptance report passes a fully reviewed public product without exposing private source copy", () => {
  const privateSourceDescription = "PRIVATE PANCAKE SOURCE COPY MUST NOT LEAK";
  const report = buildCatalogAcceptanceReport({
    sourceModel: standaloneSourceModel,
    publishedCollectionSlugs: new Set(["essentials"]),
    products: [
      {
        slug: "ao-oxford-relaxed",
        name: "Áo Oxford Relaxed",
        sourceDescription: privateSourceDescription,
        primaryImageUrl: trustedImage,
        content: publishedContent(["essentials"]),
        variants: [
          {
            id: "variation-1",
            pancakeVariationId: "pancake-variation-1",
            color: null,
            size: "M",
            sellableStock: 3,
            retailPrice: 590_000,
            retailPriceAfterDiscount: 590_000,
            imageUrls: [],
          },
        ],
      },
    ],
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.summary, {
    products: 1,
    withSourceDescription: 1,
    trustedMediaReady: 1,
    approvedMediaFallbackReady: 0,
    readableSlugReady: 1,
    publishedCollectionReady: 1,
    publishedEditorialReady: 1,
    publishedSeoReady: 1,
    variantMappingReady: 1,
    purchasableNow: 1,
  });
  assert.deepEqual(report.sourceModel, standaloneSourceModel);
  assert.deepEqual(report.blockers, { compositeProjectionRequired: false });
  assert.equal(JSON.stringify(report).includes(privateSourceDescription), false);
});

test("P17 acceptance report blocks flat-mirror readiness when Pancake has composite parents", () => {
  const report = buildCatalogAcceptanceReport({
    sourceModel: {
      compositeParentVariations: 4,
      compositeProjectionReady: false,
    },
    publishedCollectionSlugs: new Set(["essentials"]),
    products: [
      {
        slug: "set-ready-under-flat-model",
        name: "Set ready under flat model",
        sourceDescription: "Private source copy",
        primaryImageUrl: trustedImage,
        content: publishedContent(["essentials"]),
        variants: [
          {
            id: "variation-flat",
            pancakeVariationId: "pancake-variation-flat",
            color: null,
            size: "M",
            sellableStock: 2,
            retailPrice: 590_000,
            retailPriceAfterDiscount: 590_000,
            imageUrls: [],
          },
        ],
      },
    ],
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.sourceModel, {
    compositeParentVariations: 4,
    compositeProjectionReady: false,
  });
  assert.deepEqual(report.blockers, { compositeProjectionRequired: true });
});

test("P17 media fallback approvals are bounded and keyed by canonical public slugs", () => {
  assert.throws(
    () =>
      buildCatalogAcceptanceReport({
        sourceModel: standaloneSourceModel,
        products: [],
        publishedCollectionSlugs: new Set(),
        approvedMediaFallbackSlugs: new Set(["Not A Canonical Slug"]),
      }),
    /media fallback approval slug is invalid/i,
  );

  assert.throws(
    () =>
      buildCatalogAcceptanceReport({
        sourceModel: standaloneSourceModel,
        products: [],
        publishedCollectionSlugs: new Set(),
        approvedMediaFallbackSlugs: new Set(
          Array.from({ length: 101 }, (_, index) => `approved-fallback-${index}`),
        ),
      }),
    /media fallback approval limit/i,
  );
});

test("P17 acceptance report treats an explicitly approved media fallback as ready", () => {
  const report = buildCatalogAcceptanceReport({
    sourceModel: standaloneSourceModel,
    publishedCollectionSlugs: new Set(["essentials"]),
    approvedMediaFallbackSlugs: new Set(["ao-fallback-reviewed"]),
    products: [
      {
        slug: "ao-fallback-reviewed",
        name: "Áo fallback reviewed",
        sourceDescription: "Private source copy",
        primaryImageUrl: null,
        content: publishedContent(["essentials"]),
        variants: [
          {
            id: "variation-fallback",
            pancakeVariationId: "pancake-variation-fallback",
            color: null,
            size: "M",
            sellableStock: 2,
            retailPrice: 490_000,
            retailPriceAfterDiscount: 490_000,
            imageUrls: [],
          },
        ],
      },
    ],
  });

  assert.equal(report.ready, true);
  assert.equal(report.summary.trustedMediaReady, 0);
  assert.equal(report.summary.approvedMediaFallbackReady, 1);
  assert.deepEqual(report.issues.trustedMediaOrFallbackApprovalRequired, []);
});

test("P17 acceptance report surfaces mapping, media, slug, collection, editorial, SEO, and sellability gaps by public slug", () => {
  const report = buildCatalogAcceptanceReport({
    sourceModel: standaloneSourceModel,
    publishedCollectionSlugs: new Set(["essentials"]),
    approvedMediaFallbackSlugs: new Set(),
    products: [
      {
        slug: "p-1234567890abcdef1234",
        name: "Legacy product",
        sourceDescription: null,
        primaryImageUrl: "http://untrusted.example/product.jpg",
        content: null,
        variants: [
          {
            id: "variation-mapping",
            pancakeVariationId: "pancake-variation-mapping",
            color: null,
            size: null,
            sellableStock: 2,
            retailPrice: 490_000,
            retailPriceAfterDiscount: 490_000,
            imageUrls: [],
          },
        ],
      },
      {
        slug: "duplicate-option",
        name: "Duplicate option",
        sourceDescription: "Private source copy",
        primaryImageUrl: trustedImage,
        content: publishedContent(["essentials"]),
        variants: [
          {
            id: "variation-duplicate-a",
            pancakeVariationId: "pancake-variation-duplicate-a",
            color: null,
            size: "M",
            sellableStock: 1,
            retailPrice: 390_000,
            retailPriceAfterDiscount: 390_000,
            imageUrls: [],
          },
          {
            id: "variation-duplicate-b",
            pancakeVariationId: "pancake-variation-duplicate-b",
            color: null,
            size: "M",
            sellableStock: 1,
            retailPrice: 390_000,
            retailPriceAfterDiscount: 390_000,
            imageUrls: [],
          },
        ],
      },
      {
        slug: "price-unresolved",
        name: "Price unresolved",
        sourceDescription: "Private source copy",
        primaryImageUrl: trustedImage,
        content: {
          status: "REVIEWED" as const,
          editorialDescription: "Reviewed but not published.",
          seoTitle: null,
          seoDescription: null,
          collectionSlugs: ["draft-only"],
        },
        variants: [
          {
            id: "variation-price",
            pancakeVariationId: "pancake-variation-price",
            color: "Black",
            size: "L",
            sellableStock: 2,
            retailPrice: 690_000,
            retailPriceAfterDiscount: 590_000,
            imageUrls: [],
          },
        ],
      },
    ],
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.issues.mappingRequired, ["p-1234567890abcdef1234"]);
  assert.deepEqual(report.issues.ambiguousOption, ["duplicate-option"]);
  assert.deepEqual(report.issues.priceUnresolved, ["price-unresolved"]);
  assert.deepEqual(report.issues.trustedMediaOrFallbackApprovalRequired, [
    "p-1234567890abcdef1234",
  ]);
  assert.deepEqual(report.issues.unreadableSlug, ["p-1234567890abcdef1234"]);
  assert.deepEqual(report.issues.missingPublishedCollection, [
    "p-1234567890abcdef1234",
    "price-unresolved",
  ]);
  assert.deepEqual(report.issues.missingPublishedEditorial, [
    "p-1234567890abcdef1234",
    "price-unresolved",
  ]);
  assert.deepEqual(report.issues.missingPublishedSeo, [
    "p-1234567890abcdef1234",
    "price-unresolved",
  ]);
  assert.deepEqual(report.observations.missingSourceDescription, [
    "p-1234567890abcdef1234",
  ]);
  assert.ok(report.observations.noPurchasableVariant.includes("p-1234567890abcdef1234"));
  assert.ok(report.observations.noPurchasableVariant.includes("duplicate-option"));
  assert.ok(report.observations.noPurchasableVariant.includes("price-unresolved"));
});

test("P17 composite parent preflight uses the documented parent filter and fails closed on malformed counts", async () => {
  const acceptanceScript = await import("../../scripts/p17-live-catalog-acceptance.ts");
  const readCompositeParentVariationCount = Reflect.get(
    acceptanceScript,
    "readCompositeParentVariationCount",
  ) as
    | ((
        client: {
          getJson(
            endpoint: string,
            query?: Readonly<Record<string, string | number | boolean>>,
          ): Promise<unknown>;
        },
        shopId: number,
      ) => Promise<number>)
    | undefined;

  assert.equal(typeof readCompositeParentVariationCount, "function");
  if (!readCompositeParentVariationCount) return;

  const calls: Array<{
    endpoint: string;
    query: Readonly<Record<string, string | number | boolean>> | undefined;
  }> = [];
  const count = await readCompositeParentVariationCount(
    {
      async getJson(endpoint, query) {
        calls.push({ endpoint, query });
        return {
          success: true,
          page_number: 1,
          page_size: 1,
          total_entries: 4,
          total_pages: 4,
          data: [{ private_value: "MUST NOT ENTER REPORT" }],
        };
      },
    },
    47,
  );

  assert.equal(count, 4);
  assert.deepEqual(calls, [
    {
      endpoint: "/shops/47/products/variations",
      query: { page_number: 1, page_size: 1, included_composite: "parent" },
    },
  ]);

  await assert.rejects(
    readCompositeParentVariationCount(
      {
        async getJson() {
          return {
            success: true,
            page_number: 1,
            page_size: 1,
            total_entries: "4",
            total_pages: 4,
            data: [],
          };
        },
      },
      47,
    ),
    /composite parent count payload is malformed/i,
  );
});

test("P17 trusted live acceptance refuses CI before touching secrets or live dependencies", () => {
  const apiKey = "P17_API_KEY_SECRET";
  const databaseUrl = "postgresql://p17:P17_DATABASE_SECRET@invalid.example/p17";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/p17-live-catalog-acceptance.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        PANCAKE_API_KEY: apiKey,
        PANCAKE_SHOP_ID: "4741464",
        DATABASE_URL: databaseUrl,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /catalog audit refuses CI execution/i);
  assert.equal(result.stderr.includes(apiKey), false);
  assert.equal(result.stderr.includes("P17_DATABASE_SECRET"), false);
});
