/**
 * Wave 5 convergence gate — U26/M4 Merchant feed ↔ U27 ProductGroup JSON-LD parity.
 *
 * Two public consumers describe the same standalone variant to two different vendors. This file
 * proves they never publish two different truths about the facts they share: variation identity,
 * product/family identity, ADR 0008 manufacturer MPN, the exact U12 variant URL, the exact
 * promotion-aware price, and availability.
 *
 * The method matters as much as the assertions. Every case starts from ONE catalog fixture and ONE
 * storefront projection built by the real pricing rule, then hands that single source to each
 * consumer's own existing entry point:
 *
 *   catalog facts → buildStorefrontProductProjection (real promotion pricing)
 *                 ├→ mapMerchantOffers → serializeMerchantFeed → parsed RSS items
 *                 └→ buildStorefrontProductStructuredData → ProductGroup.hasVariant
 *
 * Neither side can be tuned independently to make a case pass, and the Merchant side is read back
 * from the serialized bytes a vendor would actually fetch rather than from the mapper's in-memory
 * result. The parity tuple below is an assertion vehicle only: it is not a third mapper, it owns no
 * business rule, and neither production consumer imports it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PersistedMerchantApparelOverrides } from "../../src/commerce/merchant-apparel-facts.ts";
import { serializeMerchantFeed } from "../../src/commerce/merchant-feed-serializer.ts";
import {
  mapMerchantOffers,
  type MerchantCandidateProduct,
  type MerchantCandidateVariation,
  type MerchantExclusionReason,
  type MerchantMarketPolicy,
} from "../../src/commerce/merchant-offer-mapper.ts";
import type { ApplicablePromotionCampaign } from "../../src/commerce/promotion-pricing.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import {
  buildStorefrontProductProjection,
  type StorefrontProductProjection,
} from "../../src/commerce/storefront-projection.ts";
import { buildPromotionalStorefrontPricing } from "../../src/commerce/storefront-promotion-projection.ts";
import {
  resolveDeepLinkedVariantSelection,
  VARIANT_QUERY_PARAM,
} from "../../src/commerce/storefront-variant-deep-link.ts";
import { buildStorefrontProductStructuredData } from "../../src/seo/storefront-product-structured-data.ts";

const ORIGIN = "https://shop.example.test";
const NOW = new Date("2026-09-05T09:00:00.000Z");

/**
 * A market shape used ONLY to exercise RSS serialization in these tests.
 *
 * This is not an O2 approval and grants none. Owner gate O2 is unresolved, `APPROVED_MERCHANT_MARKET`
 * stays `null`, and the production route keeps failing closed with `MERCHANT_MARKET_UNRESOLVED`.
 * The serializer needs *some* currency token to render `<g:price>`, and passing one directly here
 * is what lets price parity be read from real serialized bytes. Nothing in `src/` imports this, so
 * it cannot make `/feeds/google-merchant` answer `200`.
 */
const TEST_ONLY_MERCHANT_MARKET: MerchantMarketPolicy = {
  targetCountry: "VN",
  contentLanguage: "vi",
  currency: "VND",
};

/** The shared vocabulary the two formats are compared in. Neither consumer speaks it natively. */
type VariantCommerceParity = Readonly<{
  variantExternalId: string;
  productExternalId: string;
  mpn: string;
  url: string;
  priceVnd: number;
  availability: "IN_STOCK" | "OUT_OF_STOCK";
}>;

type CatalogVariant = Readonly<{
  /** Internal `VariantMirror.id`. Neither consumer may publish it. */
  variantId: string;
  pancakeVariationId: string;
  /** ADR 0008 manufacturer MPN candidate. */
  pancakeDisplayId: string | null;
  /** Website-local SKU, deliberately different from the MPN and never publishable as one. */
  localSku: string;
  color: string | null;
  size: string | null;
  sellableStock: number;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
  isComposite?: boolean;
  campaigns?: readonly ApplicablePromotionCampaign[];
}>;

type CatalogProduct = Readonly<{
  pancakeProductId: string;
  slug: string;
  name: string;
  publishedDescription: string | null;
  gallery: readonly string[];
  variants: readonly CatalogVariant[];
  apparelOverrides?: PersistedMerchantApparelOverrides;
}>;

const RESOLVED_APPAREL: PersistedMerchantApparelOverrides = {
  gender: "male",
  ageGroup: "adult",
  condition: "new",
};

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    variantId: "cuid-black-m",
    pancakeVariationId: "pv-black-m",
    pancakeDisplayId: "LA-OXF-BLK-M",
    localSku: "SKU-INTERNAL-0001",
    color: "Đen",
    size: "M",
    sellableStock: 7,
    retailPrice: 890_000,
    retailPriceAfterDiscount: null,
    ...overrides,
  };
}

/** A two-variant standalone family that varies by size — the ordinary publishable shape. */
function catalogProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    pancakeProductId: "pancake-product-1",
    slug: "ao-oxford-relaxed",
    name: "Áo Oxford Relaxed",
    publishedDescription: "Áo sơ mi vải cotton, dáng suông.",
    gallery: [
      "https://cdn.example.test/oxford-den.jpg",
      "https://cdn.example.test/oxford-kem.jpg",
    ],
    variants: [
      variant(),
      variant({
        variantId: "cuid-black-l",
        pancakeVariationId: "pv-black-l",
        pancakeDisplayId: "LA-OXF-BLK-L",
        localSku: "SKU-INTERNAL-0002",
        size: "L",
      }),
    ],
    ...overrides,
  };
}

/**
 * The one projection both consumers read.
 *
 * Built by the production projection builder with the production promotion rule, so promotion-aware
 * price and stock-derived availability are decided exactly once, by the code the PDP renders with.
 */
function buildSharedProjection(product: CatalogProduct): StorefrontProductProjection {
  const parentVariants: StorefrontVariantFacts[] = product.variants.map((row) => ({
    id: row.variantId,
    pancakeVariationId: row.pancakeVariationId,
    color: row.color,
    size: row.size,
    sellableStock: row.sellableStock,
    retailPrice: row.retailPrice,
    retailPriceAfterDiscount: row.retailPriceAfterDiscount,
  }));

  const campaignsByVariantId = new Map<string, readonly ApplicablePromotionCampaign[]>(
    product.variants
      .filter((row) => row.campaigns !== undefined)
      .map((row) => [row.variantId, row.campaigns!]),
  );

  return buildStorefrontProductProjection({
    parentVariants,
    componentGroups: [],
    hasCompositeGraph: false,
    pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now: NOW }),
  });
}

function galleryIndexEntries(product: CatalogProduct): [string, number][] {
  return product.variants.map((row, index) => [
    row.variantId,
    Math.min(index, Math.max(product.gallery.length - 1, 0)),
  ]);
}

function toMerchantCandidate(
  product: CatalogProduct,
  projection: StorefrontProductProjection,
): MerchantCandidateProduct {
  const variations: MerchantCandidateVariation[] = product.variants.map((row) => ({
    variantId: row.variantId,
    pancakeVariationId: row.pancakeVariationId,
    pancakeDisplayId: row.pancakeDisplayId,
    isComposite: row.isComposite ?? false,
    stockQuantity: row.sellableStock,
  }));

  return {
    pancakeProductId: product.pancakeProductId,
    slug: product.slug,
    name: product.name,
    publishedDescription: product.publishedDescription,
    media: {
      primary: product.gallery[0] === undefined
        ? null
        : { url: product.gallery[0], alt: product.name },
      gallery: product.gallery.map((url, index) => ({
        url,
        alt: `${product.name} ${index + 1}`,
      })),
    } as MerchantCandidateProduct["media"],
    galleryIndexByVariantId: new Map(galleryIndexEntries(product)),
    projection,
    apparelOverrides: product.apparelOverrides ?? RESOLVED_APPAREL,
    variations,
  };
}

type StructuredDataProductInput = Parameters<
  typeof buildStorefrontProductStructuredData
>[0]["product"];

function toStructuredDataProduct(
  product: CatalogProduct,
  projection: StorefrontProductProjection,
): StructuredDataProductInput {
  return {
    pancakeProductId: product.pancakeProductId,
    slug: product.slug,
    name: product.name,
    editorialDescription: product.publishedDescription,
    media: {
      gallery: product.gallery.map((url, index) => ({
        url,
        alt: `${product.name} ${index + 1}`,
      })),
    },
    galleryIndexByVariantId: Object.fromEntries(galleryIndexEntries(product)),
    variantMpnById: Object.fromEntries(
      product.variants.map((row) => [row.variantId, row.pancakeDisplayId]),
    ),
    projection,
  };
}

/**
 * Reads the RSS a vendor would actually fetch.
 *
 * Scoped to `<item>` blocks and entity-decoded, so parity compares real values rather than escaped
 * source text — `&amp;` in a link must not read as a different URL from the JSON-LD one. The repo
 * carries no XML parser dependency and the serializer emits a fixed, non-nested element shape, so a
 * bounded reader here is the standards-faithful option without adding a dependency for tests.
 */
function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function readItemElement(itemXml: string, element: string): string {
  const match = itemXml.match(new RegExp(`<${element}>([\\s\\S]*?)</${element}>`));
  assert.ok(match !== null, `serialized Merchant item is missing <${element}>`);
  return decodeXmlText(match[1]!);
}

function parseMerchantFeedParity(body: string): VariantCommerceParity[] {
  return [...body.matchAll(/<item>[\s\S]*?<\/item>/g)].map((match) => {
    const item = match[0];
    const rawPrice = readItemElement(item, "g:price");
    const [amount, currency] = rawPrice.split(" ");
    assert.equal(
      currency,
      TEST_ONLY_MERCHANT_MARKET.currency,
      "serialized price must carry the market currency token",
    );

    const availability = readItemElement(item, "g:availability");
    assert.ok(
      availability === "in_stock" || availability === "out_of_stock",
      `unexpected Merchant availability ${availability}`,
    );

    return Object.freeze({
      variantExternalId: readItemElement(item, "g:id"),
      productExternalId: readItemElement(item, "g:item_group_id"),
      mpn: readItemElement(item, "g:mpn"),
      url: readItemElement(item, "g:link"),
      priceVnd: Number(amount),
      availability: availability === "in_stock" ? "IN_STOCK" : "OUT_OF_STOCK",
    });
  });
}

type JsonRecord = Record<string, unknown>;

function productGroupNode(document: unknown): JsonRecord | null {
  const graph = (document as JsonRecord)["@graph"];
  if (!Array.isArray(graph)) return null;
  return (
    (graph.find(
      (node) => (node as JsonRecord)["@type"] === "ProductGroup",
    ) as JsonRecord | undefined) ?? null
  );
}

/**
 * The JSON-LD side's variation identity is not published as a bare field: it lives in the exact U12
 * deep link. Reading it back through the reviewed query-parameter name — rather than by slicing the
 * string — keeps this comparison inside the addressing contract that wrote the URL.
 */
function readVariationIdFromUrl(url: string): string {
  const value = new URL(url).searchParams.get(VARIANT_QUERY_PARAM);
  assert.ok(value !== null, `published variant URL carries no ?${VARIANT_QUERY_PARAM}`);
  return value;
}

function parseStructuredDataParity(document: unknown): VariantCommerceParity[] {
  const group = productGroupNode(document);
  if (group === null) return [];

  const productGroupID = group.productGroupID as string;
  const variants = (group.hasVariant ?? []) as JsonRecord[];

  return variants.map((node) => {
    const offer = node.offers as JsonRecord;
    const availability = String(offer.availability);
    assert.ok(
      availability.endsWith("/InStock") || availability.endsWith("/OutOfStock"),
      `unexpected JSON-LD availability ${availability}`,
    );
    assert.equal(offer.priceCurrency, "VND");

    const url = node.url as string;
    assert.equal(offer.url, url, "JSON-LD Offer.url must be the variant's own exact URL");

    return Object.freeze({
      variantExternalId: readVariationIdFromUrl(url),
      productExternalId: productGroupID,
      mpn: String(node.mpn),
      url,
      priceVnd: offer.price as number,
      availability: availability.endsWith("/InStock")
        ? ("IN_STOCK" as const)
        : ("OUT_OF_STOCK" as const),
    });
  });
}

type ParityRun = Readonly<{
  merchant: VariantCommerceParity[];
  jsonLd: VariantCommerceParity[];
  merchantExclusions: ReadonlyMap<string, readonly MerchantExclusionReason[]>;
  projection: StorefrontProductProjection;
}>;

function runParity(product: CatalogProduct): ParityRun {
  const projection = buildSharedProjection(product);

  const mapped = mapMerchantOffers({
    products: [toMerchantCandidate(product, projection)],
    origin: ORIGIN,
  });
  const feed = serializeMerchantFeed({
    offers: mapped.offers,
    market: TEST_ONLY_MERCHANT_MARKET,
    origin: ORIGIN,
  });

  const document = buildStorefrontProductStructuredData({
    origin: ORIGIN,
    product: toStructuredDataProduct(product, projection),
  });

  const byId = (left: VariantCommerceParity, right: VariantCommerceParity) =>
    left.variantExternalId.localeCompare(right.variantExternalId, "en");

  return Object.freeze({
    merchant: parseMerchantFeedParity(feed.body).sort(byId),
    jsonLd: parseStructuredDataParity(document).sort(byId),
    merchantExclusions: new Map(
      mapped.excluded.map((row) => [row.pancakeVariationId ?? "<none>", row.reasons]),
    ),
    projection,
  });
}

function publishedIds(rows: readonly VariantCommerceParity[]): string[] {
  return rows.map((row) => row.variantExternalId);
}

describe("Merchant feed ↔ U27 variant JSON-LD parity", () => {
  it("publishes one identical commerce truth for an ordinary in-stock standalone variant", () => {
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [variant(), variant({
          variantId: "cuid-black-l",
          pancakeVariationId: "pv-black-l",
          pancakeDisplayId: "LA-OXF-BLK-L",
          localSku: "SKU-INTERNAL-0002",
          size: "L",
        })],
      }),
    );

    assert.deepEqual(merchant, jsonLd);
    assert.equal(merchant.length, 2);

    const first = merchant[0]!;
    assert.equal(first.variantExternalId, "pv-black-l");
    assert.equal(first.productExternalId, "pancake-product-1");
    assert.equal(first.mpn, "LA-OXF-BLK-L");
    assert.equal(first.url, `${ORIGIN}/shop/ao-oxford-relaxed?variant=pv-black-l`);
    assert.equal(first.priceVnd, 890_000);
    assert.equal(first.availability, "IN_STOCK");
  });

  it("keeps a zero-stock variant a valid offer with the same out-of-stock meaning on both sides", () => {
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant(),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
            sellableStock: 0,
          }),
        ],
      }),
    );

    assert.deepEqual(merchant, jsonLd);
    const soldOut = merchant.find((row) => row.variantExternalId === "pv-black-l");
    assert.ok(soldOut !== undefined, "a zero-stock variant stays publishable on both sides");
    assert.equal(soldOut.availability, "OUT_OF_STOCK");
    // Sold out is a stock fact, not a pricing one: the exact price is still published.
    assert.equal(soldOut.priceVnd, 890_000);
  });

  it("publishes the same promotion-aware price and never falls back to the base price", () => {
    const campaign: ApplicablePromotionCampaign = {
      id: "campaign-flash",
      name: "Flash Sale",
      kind: "FLASH_SALE",
      discountType: "PERCENTAGE",
      percentageValue: 20,
      fixedPriceVnd: null,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };

    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant({ campaigns: [campaign] }),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
          }),
        ],
      }),
    );

    assert.deepEqual(merchant, jsonLd);
    const discounted = merchant.find((row) => row.variantExternalId === "pv-black-m");
    assert.ok(discounted !== undefined);
    assert.equal(discounted.priceVnd, 712_000);
    assert.notEqual(discounted.priceVnd, 890_000, "the raw base price must never be published");

    const undiscounted = merchant.find((row) => row.variantExternalId === "pv-black-l");
    assert.equal(undiscounted?.priceVnd, 890_000);
  });

  it("publishes one exact U12 variant URL that reopens the same option on both sides", () => {
    const product = catalogProduct();
    const { merchant, jsonLd, projection } = runParity(product);

    assert.deepEqual(publishedIds(merchant), publishedIds(jsonLd));
    for (const [index, row] of merchant.entries()) {
      const counterpart = jsonLd[index]!;
      assert.equal(row.url, counterpart.url);
      assert.equal(row.variantExternalId, counterpart.variantExternalId);

      const parsed = new URL(row.url);
      assert.equal(parsed.origin, ORIGIN);
      assert.equal(parsed.pathname, "/shop/ao-oxford-relaxed");

      // Not a substring check, and not merely "the resolver answered something": each published
      // identity is fed back through the U12 resolver and must land on the internal option the
      // fixture says owns it. A resolver that ever matched a near neighbour would satisfy a
      // non-null check while silently publishing a link to the wrong variant.
      const expectedVariantId = product.variants.find(
        (candidate) => candidate.pancakeVariationId === row.variantExternalId,
      )?.variantId;
      assert.ok(expectedVariantId !== undefined, "published id must belong to a fixture variant");

      for (const url of [row.url, counterpart.url]) {
        const reselected = resolveDeepLinkedVariantSelection({
          projection,
          variantQuery: new URL(url).searchParams.get(VARIANT_QUERY_PARAM),
        });
        assert.ok(reselected !== null, "a published variant URL must reopen its own variant");
        assert.equal(
          reselected.variantId,
          expectedVariantId,
          "both consumers' URLs must reopen the same internal option, not merely resolve",
        );
      }
    }
  });

  it("publishes the ADR 0008 manufacturer MPN on both sides, never the website-local SKU", () => {
    const product = catalogProduct();
    const { merchant, jsonLd } = runParity(product);

    assert.deepEqual(merchant, jsonLd);
    const localSkus = new Set(product.variants.map((row) => row.localSku));
    const internalIds = new Set(product.variants.map((row) => row.variantId));

    for (const row of merchant) {
      const source = product.variants.find(
        (candidate) => candidate.pancakeVariationId === row.variantExternalId,
      );
      assert.equal(row.mpn, source?.pancakeDisplayId);
      assert.equal(localSkus.has(row.mpn), false, "a local SKU is never a manufacturer MPN");
      assert.equal(internalIds.has(row.mpn), false, "a local CUID is never a manufacturer MPN");
      assert.notEqual(row.mpn, row.variantExternalId, "the variation id is never a fake MPN");
    }
  });

  for (const [label, mpn] of [
    ["missing", null],
    ["blank", ""],
    ["untrimmed", " LA-OXF-BLK-L "],
  ] as const) {
    it(`fails closed on both sides for a ${label} manufacturer MPN`, () => {
      const { merchant, jsonLd } = runParity(
        catalogProduct({
          variants: [
            variant(),
            variant({
              variantId: "cuid-black-l",
              pancakeVariationId: "pv-black-l",
              pancakeDisplayId: mpn,
              size: "L",
            }),
            variant({
              variantId: "cuid-black-xl",
              pancakeVariationId: "pv-black-xl",
              pancakeDisplayId: "LA-OXF-BLK-XL",
              size: "XL",
            }),
          ],
        }),
      );

      assert.equal(
        publishedIds(merchant).includes("pv-black-l"),
        false,
        "Merchant must exclude a variant without a usable MPN",
      );
      assert.equal(
        publishedIds(jsonLd).includes("pv-black-l"),
        false,
        "JSON-LD must not publish a variant without a usable MPN",
      );
      assert.deepEqual(publishedIds(merchant), publishedIds(jsonLd));
    });
  }

  it("fails closed on both sides when two variants claim the same manufacturer MPN", () => {
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant({ pancakeDisplayId: "LA-OXF-DUPLICATE" }),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-DUPLICATE",
            size: "L",
          }),
          variant({
            variantId: "cuid-black-xl",
            pancakeVariationId: "pv-black-xl",
            pancakeDisplayId: "LA-OXF-BLK-XL",
            size: "XL",
          }),
          variant({
            variantId: "cuid-black-xxl",
            pancakeVariationId: "pv-black-xxl",
            pancakeDisplayId: "LA-OXF-BLK-XXL",
            size: "XXL",
          }),
        ],
      }),
    );

    assert.deepEqual(publishedIds(merchant), ["pv-black-xl", "pv-black-xxl"]);
    assert.deepEqual(publishedIds(jsonLd), publishedIds(merchant));
  });

  it("fails closed on both sides when a variant's price never resolved", () => {
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant(),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
            retailPrice: null,
            retailPriceAfterDiscount: null,
          }),
          variant({
            variantId: "cuid-black-xl",
            pancakeVariationId: "pv-black-xl",
            pancakeDisplayId: "LA-OXF-BLK-XL",
            size: "XL",
          }),
        ],
      }),
    );

    assert.equal(publishedIds(merchant).includes("pv-black-l"), false);
    assert.equal(publishedIds(jsonLd).includes("pv-black-l"), false);
    assert.deepEqual(publishedIds(merchant), publishedIds(jsonLd));
    // No `0`, no minimum, no base-price stand-in anywhere in either output.
    assert.equal(merchant.some((row) => row.priceVnd <= 0), false);
    assert.equal(jsonLd.some((row) => row.priceVnd <= 0), false);
  });

  it("publishes matching availability for every resolvable stock shape", () => {
    // Both consumers reduce the same warehouse rows to the same verdict wherever the quantity is a
    // usable number: no rows and an explicit zero both sum to 0 (out of stock), a positive sum is in
    // stock. This is the whole resolvable domain, and it matches.
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant({ sellableStock: 12 }),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
            sellableStock: 0,
          }),
        ],
      }),
    );

    assert.deepEqual(merchant, jsonLd);
    assert.deepEqual(
      merchant.map((row) => [row.variantExternalId, row.availability]),
      [
        ["pv-black-l", "OUT_OF_STOCK"],
        ["pv-black-m", "IN_STOCK"],
      ],
    );
  });

  /**
   * The one identified eligibility difference between the two consumers, pinned deliberately.
   *
   * A negative mirrored warehouse quantity is not a stock fact. M1's aggregation refuses it
   * (`AVAILABILITY_UNRESOLVED`) and the Merchant feed excludes the offer. The storefront sums it to
   * a negative number, which the PDP reads as `<= 0` and therefore renders — and publishes — as
   * sold out. U27's stated availability authority is that PDP projection, and page markup that
   * disagreed with the page it sits on would be its own defect, so neither consumer is violating
   * its own contract here; the feed is simply stricter than the page.
   *
   * Recorded rather than silently equalized. `docs/audits/merchant-jsonld-parity.md` carries the
   * mechanism and reachability, and closing it needs an owner decision about whether U27 gains an
   * availability-resolution signal — not a change smuggled into a verification PR.
   *
   * A non-finite quantity is NOT part of this difference: the PDP repository throws on it before a
   * projection exists, so no JSON-LD is published at all and both consumers fail closed.
   */
  it("records the known negative-quantity availability difference between the two consumers", () => {
    const { merchant, jsonLd, merchantExclusions } = runParity(
      catalogProduct({
        variants: [
          variant(),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
            sellableStock: -1,
          }),
          variant({
            variantId: "cuid-black-xl",
            pancakeVariationId: "pv-black-xl",
            pancakeDisplayId: "LA-OXF-BLK-XL",
            size: "XL",
          }),
        ],
      }),
    );

    assert.deepEqual(
      merchantExclusions.get("pv-black-l"),
      ["AVAILABILITY_UNRESOLVED"],
      "Merchant reports unresolved availability rather than guessing a stock state",
    );
    assert.equal(publishedIds(merchant).includes("pv-black-l"), false);
    assert.equal(
      publishedIds(jsonLd).includes("pv-black-l"),
      true,
      "current U27 behaviour: the PDP projection's sold-out verdict is published as an exact Offer",
    );

    // Every other variant still agrees exactly, so the difference is bounded to this one row.
    const shared = merchant.map((row) => row.variantExternalId);
    assert.deepEqual(shared, ["pv-black-m", "pv-black-xl"]);
    for (const id of shared) {
      assert.deepEqual(
        merchant.find((row) => row.variantExternalId === id),
        jsonLd.find((row) => row.variantExternalId === id),
      );
    }
  });

  it("fails closed on both sides for an unaddressable variation identity", () => {
    // Two rows claiming one external identity: U12 refuses to say which option the link names, so
    // neither consumer may publish either row as an exact standalone offer.
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant(),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-m",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
          }),
        ],
      }),
    );

    assert.deepEqual(publishedIds(merchant), []);
    assert.deepEqual(publishedIds(jsonLd), []);
  });

  it("publishes no standalone variant offer for a composite set on either side", () => {
    const product = catalogProduct({
      variants: [
        variant({ isComposite: true }),
        variant({
          variantId: "cuid-black-l",
          pancakeVariationId: "pv-black-l",
          pancakeDisplayId: "LA-OXF-BLK-L",
          size: "L",
          isComposite: true,
        }),
      ],
    });

    const projection = buildSharedProjection(product);
    const compositeProjection: StorefrontProductProjection = {
      mode: "composite",
      options: projection.options,
    };

    const mapped = mapMerchantOffers({
      products: [toMerchantCandidate(product, compositeProjection)],
      origin: ORIGIN,
    });
    const document = buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: toStructuredDataProduct(product, compositeProjection),
    });

    assert.deepEqual(mapped.offers, []);
    for (const excluded of mapped.excluded) {
      assert.deepEqual(excluded.reasons, ["COMPOSITE_DEFERRED"]);
    }
    // The negative invariant is shared; the diagnostic vocabulary deliberately is not.
    assert.equal(productGroupNode(document), null);
  });

  it("groups every published sibling under the same external product identity", () => {
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant(),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
          }),
          variant({
            variantId: "cuid-black-xl",
            pancakeVariationId: "pv-black-xl",
            pancakeDisplayId: "LA-OXF-BLK-XL",
            size: "XL",
          }),
        ],
      }),
    );

    assert.deepEqual(merchant, jsonLd);
    assert.equal(merchant.length, 3);

    const product = catalogProduct();
    for (const row of merchant) {
      assert.equal(row.productExternalId, "pancake-product-1");
      assert.notEqual(row.productExternalId, product.slug, "a slug is not a group identity");
      assert.notEqual(row.productExternalId, row.mpn, "an MPN is not a group identity");
      assert.notEqual(
        row.productExternalId,
        row.variantExternalId,
        "a variation id is not a group identity",
      );
    }
    assert.equal(new Set(jsonLd.map((row) => row.productExternalId)).size, 1);
  });

  it("publishes the same eligible standalone variant set from one mixed catalog fixture", () => {
    const { merchant, jsonLd } = runParity(
      catalogProduct({
        variants: [
          variant(),
          variant({
            variantId: "cuid-black-l",
            pancakeVariationId: "pv-black-l",
            pancakeDisplayId: "LA-OXF-BLK-L",
            size: "L",
            sellableStock: 0,
          }),
          variant({
            variantId: "cuid-black-xl",
            pancakeVariationId: "pv-black-xl",
            pancakeDisplayId: null,
            size: "XL",
          }),
          variant({
            variantId: "cuid-black-xxl",
            pancakeVariationId: "pv-black-xxl",
            pancakeDisplayId: "LA-OXF-BLK-XXL",
            size: "XXL",
            retailPrice: null,
            retailPriceAfterDiscount: null,
          }),
        ],
      }),
    );

    assert.deepEqual(publishedIds(merchant), ["pv-black-l", "pv-black-m"]);
    assert.deepEqual(publishedIds(jsonLd), publishedIds(merchant));
    assert.deepEqual(merchant, jsonLd);
  });
});
