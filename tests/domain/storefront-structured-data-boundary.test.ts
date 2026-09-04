/**
 * U27 — #152 W4d + the variant-level portion of W5.
 *
 * The boundary between the PDP's storefront projection and the published product JSON-LD. It owns
 * one decision: which variants of a product may appear as their own `Product` + `Offer` under a
 * `ProductGroup`, and with exactly which facts. Every fact it publishes has an existing owner —
 * U12 for the addressable variant URL, the PDP projection for price and availability, the trusted
 * media resolver for images — and the tests below exist to prove this file reuses those owners
 * rather than deriving a second, quietly divergent answer.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeepLinkedVariantSelection, VARIANT_QUERY_PARAM }
  from "../../src/commerce/storefront-variant-deep-link.ts";
import type { ApplicablePromotionCampaign } from "../../src/commerce/promotion-pricing.ts";
import {
  buildStorefrontProductProjection,
  type StorefrontProductProjection,
  type StorefrontProjectionOption,
} from "../../src/commerce/storefront-projection.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import { buildPromotionalStorefrontPricing } from "../../src/commerce/storefront-promotion-projection.ts";
import { buildStorefrontProductStructuredData } from "../../src/seo/storefront-product-structured-data.ts";
import { serializeJsonLd, type ProductStructuredDataDocument } from "../../src/seo/structured-data.ts";

const ORIGIN = "https://shop.example.com";
const SLUG = "ao-oxford-relaxed";
const PRODUCT_URL = `${ORIGIN}/shop/${SLUG}`;
const BLACK_IMAGE = "https://content.pancake.vn/catalog/1/2/3/oxford-den.jpg";
const CREAM_IMAGE = "https://content.pancake.vn/catalog/1/2/3/oxford-kem.jpg";

function option(overrides: Partial<StorefrontProjectionOption> = {}): StorefrontProjectionOption {
  return {
    id: "cuid-a",
    pancakeVariationId: "pv-a",
    color: "Đen",
    size: "M",
    price: 890_000,
    basePriceVnd: 890_000,
    isDiscounted: false,
    purchasable: true,
    unavailableReason: null,
    kindKey: null,
    kindLabel: null,
    ...overrides,
  };
}

type BoundaryProduct = Parameters<typeof buildStorefrontProductStructuredData>[0]["product"];

function product(overrides: Partial<BoundaryProduct> = {}): BoundaryProduct {
  return {
    pancakeProductId: "pancake-product-1",
    slug: SLUG,
    name: "Áo Oxford Relaxed",
    editorialDescription: null,
    media: {
      gallery: [
        { url: BLACK_IMAGE, alt: "Áo Oxford Relaxed" },
        { url: CREAM_IMAGE, alt: "Áo Oxford Relaxed - Ảnh 2" },
      ],
    },
    galleryIndexByVariantId: { "cuid-a": 0, "cuid-b": 0, "cuid-c": 1 },
    projection: {
      mode: "standalone",
      options: [
        option({ id: "cuid-a", pancakeVariationId: "pv-a", color: "Đen", size: "M" }),
        option({
          id: "cuid-b",
          pancakeVariationId: "pv-b",
          color: "Đen",
          size: "L",
          price: 910_000,
          basePriceVnd: 910_000,
        }),
        option({ id: "cuid-c", pancakeVariationId: "pv-c", color: "Kem", size: "M" }),
      ],
    },
    ...overrides,
  };
}

function standaloneProjection(
  options: readonly StorefrontProjectionOption[],
): StorefrontProductProjection {
  return { mode: "standalone", options: [...options] };
}

function build(overrides: Partial<BoundaryProduct> = {}): ProductStructuredDataDocument {
  return buildStorefrontProductStructuredData({ origin: ORIGIN, product: product(overrides) });
}

function productGroupNode(document: ProductStructuredDataDocument) {
  const node = document["@graph"][0];
  assert.equal(node["@type"], "ProductGroup", "expected the variant ProductGroup shape");
  return node;
}

function singleProductNode(document: ProductStructuredDataDocument) {
  const node = document["@graph"][0];
  assert.equal(node["@type"], "Product", "expected the product-level Product shape");
  return node;
}

/* ------------------------------------------------------------------ normal family */

test("U27 a standalone family publishes one ProductGroup with a Product and an exact Offer per variant", () => {
  const group = productGroupNode(build());

  assert.equal(group["@id"], `${PRODUCT_URL}#product`);
  assert.equal(group.name, "Áo Oxford Relaxed");
  assert.equal(group.url, PRODUCT_URL);
  assert.deepEqual(group.brand, { "@id": `${ORIGIN}/#organization` });
  assert.equal(group.productGroupID, "pancake-product-1");
  assert.deepEqual(group.variesBy, ["https://schema.org/color", "https://schema.org/size"]);
  assert.equal(group.hasVariant.length, 3);

  assert.deepEqual(group.hasVariant[0], {
    "@type": "Product",
    "@id": `${PRODUCT_URL}?variant=pv-a#product`,
    name: "Áo Oxford Relaxed",
    url: `${PRODUCT_URL}?variant=pv-a`,
    color: "Đen",
    size: "M",
    image: [BLACK_IMAGE],
    offers: {
      "@type": "Offer",
      url: `${PRODUCT_URL}?variant=pv-a`,
      priceCurrency: "VND",
      price: 890_000,
      availability: "https://schema.org/InStock",
    },
  });
});

test("U27 the ProductGroup keeps the product-level Breadcrumb graph unchanged", () => {
  const document = build();

  assert.equal(document["@context"], "https://schema.org");
  assert.equal(document["@graph"].length, 2);
  assert.equal(document["@graph"][1]["@type"], "BreadcrumbList");
});

/* -------------------------------------------------------------------- exact price */

test("U27 variants priced differently each publish their own exact price, never a range", () => {
  const group = productGroupNode(build());
  const prices = group.hasVariant.map((variant) => variant.offers.price);

  assert.deepEqual(prices, [890_000, 910_000, 890_000]);
});

test("U27 never publishes AggregateOffer, lowPrice, highPrice or offerCount for a variant family", () => {
  const serialized = serializeJsonLd(build());

  for (const forbidden of ["AggregateOffer", "lowPrice", "highPrice", "offerCount"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("U27 the ProductGroup itself carries no offer, so no aggregate contradicts the variant Offers", () => {
  const group = productGroupNode(build());

  assert.equal("offers" in group, false);
  // The case that actually bites: siblings that share one price, where the old product-level offer
  // would have resolved cleanly and could sit beside the variant offers without looking wrong.
  assert.equal(
    "offers" in
      productGroupNode(
        build({
          projection: standaloneProjection([
            option({ id: "cuid-a", pancakeVariationId: "pv-a", color: null, size: "M" }),
            option({ id: "cuid-b", pancakeVariationId: "pv-b", color: null, size: "L" }),
          ]),
        }),
      ),
    false,
    "a same-priced family must still publish no product-level offer",
  );
  assert.equal(
    build()["@graph"].filter((node) =>
      node["@type"] === "Product" || node["@type"] === "ProductGroup",
    ).length,
    1,
    "the page must publish exactly one product-schema authority",
  );
});

/* ------------------------------------------------------------------- availability */

test("U27 a sold-out variant with a resolved price publishes an exact OutOfStock Offer", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({
          id: "cuid-b",
          pancakeVariationId: "pv-b",
          size: "L",
          price: 910_000,
          purchasable: false,
          unavailableReason: "OUT_OF_STOCK",
        }),
      ]),
    }),
  );

  assert.deepEqual(
    group.hasVariant.map((variant) => variant.offers.availability),
    ["https://schema.org/InStock", "https://schema.org/OutOfStock"],
  );
  assert.equal(group.hasVariant[1]!.offers.price, 910_000);
});

test("U27 an unresolved price fails closed: that variant gets no Product and no Offer", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
        option({
          id: "cuid-c",
          pancakeVariationId: "pv-unresolved",
          size: "XL",
          price: null,
          purchasable: false,
          unavailableReason: "PRICE_UNRESOLVED",
        }),
      ]),
    }),
  );

  assert.deepEqual(
    group.hasVariant.map((variant) => variant.url),
    [`${PRODUCT_URL}?variant=pv-a`, `${PRODUCT_URL}?variant=pv-b`],
  );
  assert.equal(serializeJsonLd(group).includes("pv-unresolved"), false);
});

test("U27 an option that is not purchasable for no stated reason is not published as sold out", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
        // Priced, addressable, and refused by the selection model without saying why. "Cannot be
        // bought" is not the same claim as "out of stock", so this publishes neither.
        option({
          id: "cuid-c",
          pancakeVariationId: "pv-unexplained",
          size: "XL",
          purchasable: false,
          unavailableReason: null,
        }),
      ]),
    }),
  );

  assert.equal(group.hasVariant.length, 2);
  assert.equal(serializeJsonLd(group).includes("pv-unexplained"), false);
});

test("U27 a sold-out variant whose price never resolved is not published either", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
        option({
          id: "cuid-c",
          pancakeVariationId: "pv-sold-out-unpriced",
          size: "XL",
          price: null,
          purchasable: false,
          unavailableReason: "OUT_OF_STOCK",
        }),
      ]),
    }),
  );

  assert.equal(group.hasVariant.length, 2);
  assert.equal(serializeJsonLd(group).includes("pv-sold-out-unpriced"), false);
});

/* --------------------------------------------------------------- variant identity */

test("U27 every published variant URL is the exact U12 deep link that reselects that variant", () => {
  const fixture = product();
  const group = productGroupNode(
    buildStorefrontProductStructuredData({ origin: ORIGIN, product: fixture }),
  );

  for (const variant of group.hasVariant) {
    const query = new URL(variant.url).searchParams.get(VARIANT_QUERY_PARAM);
    const reselected = resolveDeepLinkedVariantSelection({
      projection: fixture.projection,
      variantQuery: query,
    });

    assert.ok(reselected, `${variant.url} must reselect a variant`);
    const matched = fixture.projection.options.find((item) => item.id === reselected.variantId)!;
    assert.equal(variant.color, matched.color);
    assert.equal(variant.size, matched.size);
    assert.equal(variant.offers.price, matched.price);
    assert.equal(variant.offers.url, variant.url);
  }
});

test("U27 publishes no internal CUID, kind key, barcode or option-concatenation identity", () => {
  const serialized = serializeJsonLd(build());

  for (const forbidden of ["cuid-a", "cuid-b", "cuid-c", "kindKey", "kindLabel", "sku", "gtin", "mpn"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("U27 a duplicated external variation id makes both variants unpublishable", () => {
  const document = build({
    projection: standaloneProjection([
      option({ id: "cuid-a", pancakeVariationId: "pv-dup", size: "M" }),
      option({ id: "cuid-b", pancakeVariationId: "pv-dup", size: "L", price: 910_000 }),
    ]),
  });

  assert.equal(document["@graph"][0]["@type"], "Product");
  assert.equal(serializeJsonLd(document).includes("pv-dup"), false);
});

test("U27 a blank or oversized external variation id is not addressable, so it is not published", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
        option({ id: "cuid-blank", pancakeVariationId: "", size: "XL" }),
        option({ id: "cuid-long", pancakeVariationId: "p".repeat(129), size: "XXL" }),
      ]),
    }),
  );

  assert.equal(group.hasVariant.length, 2);
});

test("U27 an unmappable or ambiguous option is never published as a sibling variant", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
        option({
          id: "cuid-c",
          pancakeVariationId: "pv-mapping",
          size: null,
          purchasable: false,
          unavailableReason: "MAPPING_REQUIRED",
        }),
        option({
          id: "cuid-d",
          pancakeVariationId: "pv-ambiguous",
          size: "XL",
          purchasable: false,
          unavailableReason: "AMBIGUOUS_OPTION",
        }),
      ]),
    }),
  );

  assert.equal(group.hasVariant.length, 2);
  const serialized = serializeJsonLd(group);
  assert.equal(serialized.includes("pv-mapping"), false);
  assert.equal(serialized.includes("pv-ambiguous"), false);
});

/* ------------------------------------------------------------------------- varies */

test("U27 variesBy names only the dimensions the published variants actually differ on", () => {
  const sizeOnly = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", color: null, size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", color: null, size: "L" }),
      ]),
    }),
  );
  assert.deepEqual(sizeOnly.variesBy, ["https://schema.org/size"]);

  const colorOnly = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", color: "Đen", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", color: "Kem", size: "M" }),
      ]),
    }),
  );
  assert.deepEqual(colorOnly.variesBy, ["https://schema.org/color"]);
});

test("U27 a variant omits a dimension the catalog has no value for", () => {
  const group = productGroupNode(
    build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", color: null, size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", color: null, size: "L" }),
      ]),
    }),
  );

  assert.equal("color" in group.hasVariant[0]!, false);
  assert.equal(group.hasVariant[0]!.size, "M");
});

/* -------------------------------------------------------------------------- media */

test("U27 a variant image comes from the trusted resolved gallery, or is omitted", () => {
  const group = productGroupNode(
    build({
      galleryIndexByVariantId: { "cuid-c": 1 },
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", color: "Đen", size: "M" }),
        option({ id: "cuid-c", pancakeVariationId: "pv-c", color: "Kem", size: "M" }),
      ]),
    }),
  );

  assert.equal("image" in group.hasVariant[0]!, false);
  assert.deepEqual(group.hasVariant[1]!.image, [CREAM_IMAGE]);
});

test("U27 a gallery index that does not address a resolved image publishes no variant image", () => {
  const group = productGroupNode(
    build({
      galleryIndexByVariantId: { "cuid-a": 99, "cuid-b": -1 },
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
      ]),
    }),
  );

  assert.equal("image" in group.hasVariant[0]!, false);
  assert.equal("image" in group.hasVariant[1]!, false);
});

/* ---------------------------------------------------------- product-level fallback */

test("U27 a single eligible variant stays a product-level Product with its exact Offer", () => {
  const document = build({
    projection: standaloneProjection([
      option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
    ]),
  });
  const node = singleProductNode(document);

  assert.equal(serializeJsonLd(document).includes("ProductGroup"), false);
  assert.deepEqual(node.offers, {
    "@type": "Offer",
    url: PRODUCT_URL,
    priceCurrency: "VND",
    price: 890_000,
    availability: "https://schema.org/InStock",
  });
});

test("U27 a product with no publishable variant falls back without inventing an offer", () => {
  const document = build({
    projection: standaloneProjection([
      option({
        id: "cuid-a",
        pancakeVariationId: "pv-a",
        size: "M",
        price: null,
        purchasable: false,
        unavailableReason: "PRICE_UNRESOLVED",
      }),
    ]),
  });

  assert.equal("offers" in singleProductNode(document), false);
});

/* ---------------------------------------------------------------------- composite */

test("U27 a composite product is never remodelled as a normal variant family", () => {
  const document = buildStorefrontProductStructuredData({
    origin: ORIGIN,
    product: product({
      projection: {
        mode: "composite",
        options: [
          option({
            id: "parent-m",
            pancakeVariationId: "pv-parent-m",
            color: null,
            size: "M",
            price: 790_000,
            kindKey: "parent",
            kindLabel: "Set",
          }),
          option({
            id: "parent-l",
            pancakeVariationId: "pv-parent-l",
            color: null,
            size: "L",
            price: 790_000,
            kindKey: "parent",
            kindLabel: "Set",
          }),
          option({
            id: "component-m",
            pancakeVariationId: "pv-component-m",
            color: null,
            size: "M",
            price: 400_000,
            kindKey: "component-1",
            kindLabel: "Áo A",
          }),
        ],
      },
    }),
  });
  const serialized = serializeJsonLd(document);

  assert.equal(singleProductNode(document)["@type"], "Product");
  assert.equal(serialized.includes("ProductGroup"), false);
  assert.equal(serialized.includes("hasVariant"), false);
  assert.equal(serialized.includes("pv-component-m"), false);
  assert.equal(serialized.includes("pv-parent-m"), false);
});

test("U27 composite child availability still cannot make a sold-out parent Product InStock", () => {
  const document = buildStorefrontProductStructuredData({
    origin: ORIGIN,
    product: product({
      projection: {
        mode: "composite",
        options: [
          option({
            id: "parent-m",
            pancakeVariationId: "pv-parent-m",
            color: null,
            size: "M",
            price: 790_000,
            purchasable: false,
            unavailableReason: "OUT_OF_STOCK",
            kindKey: "parent",
            kindLabel: "Set",
          }),
          option({
            id: "component-m",
            pancakeVariationId: "pv-component-m",
            color: null,
            size: "M",
            price: 790_000,
            kindKey: "component-1",
            kindLabel: "Áo A",
          }),
        ],
      },
    }),
  });

  assert.deepEqual(singleProductNode(document).offers, {
    "@type": "Offer",
    url: PRODUCT_URL,
    priceCurrency: "VND",
    price: 790_000,
    availability: "https://schema.org/OutOfStock",
  });
});

/* ----------------------------------------------------------------------- identity */

test("U27 a product without a usable external product identity publishes no ProductGroup", () => {
  for (const pancakeProductId of ["", "   ", "p".repeat(129)]) {
    const document = build({ pancakeProductId });
    assert.equal(
      document["@graph"][0]["@type"],
      "Product",
      `${JSON.stringify(pancakeProductId)} must not become a productGroupID`,
    );
  }
});

/* ----------------------------------------------------------------------- security */

test("U27 hostile mirrored catalog text cannot break out of the JSON-LD script element", () => {
  const serialized = serializeJsonLd(
    build({
      name: "</script><script>alert('u27')</script>",
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a</script>", color: "<img src=x>", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", color: "Kem", size: "M" }),
      ]),
    }),
  );

  assert.equal(serialized.includes("<"), false);
  assert.match(serialized, /\\u003c\/script>/);
});

test("U27 publishes no merchant, rating or policy claim the catalog cannot support", () => {
  const group = productGroupNode(build());

  for (const forbidden of [
    "aggregateRating",
    "review",
    "gtin",
    "gtin13",
    "material",
    "shippingDetails",
    "hasMerchantReturnPolicy",
    "itemCondition",
  ]) {
    assert.equal(forbidden in group, false, forbidden);
    for (const variant of group.hasVariant) {
      assert.equal(forbidden in variant, false, `${forbidden} on variant`);
    }
  }
});

/* ----------------------------------------------- driven through the real projection builder */

/**
 * The tests above hand-build projection options, which is the right shape to pin publishing rules
 * but proves nothing about which states the projection actually produces. These drive the real
 * `buildStorefrontProductProjection` with the real promotion-aware pricing rule — the same pair the
 * product page uses — so the pricing authority and the option model are part of the contract.
 */
function facts(
  overrides: Partial<StorefrontVariantFacts> & Pick<StorefrontVariantFacts, "id">,
): StorefrontVariantFacts {
  return {
    pancakeVariationId: `pv-${overrides.id}`,
    color: "Đen",
    size: "M",
    sellableStock: 4,
    retailPrice: 890_000,
    retailPriceAfterDiscount: 890_000,
    ...overrides,
  };
}

function projectedProduct(
  variants: readonly StorefrontVariantFacts[],
  campaignsByVariantId: ReadonlyMap<string, readonly ApplicablePromotionCampaign[]> = new Map(),
): BoundaryProduct {
  return product({
    galleryIndexByVariantId: {},
    projection: buildStorefrontProductProjection({
      parentVariants: variants,
      componentGroups: [],
      hasCompositeGraph: false,
      pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now: NOW }),
    }),
  });
}

const NOW = new Date("2026-09-04T12:00:00.000Z");

test("U27 variesBy is not fooled by mirrored catalog text that differs only in case", () => {
  const group = productGroupNode(
    buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: projectedProduct([
        facts({ id: "cuid-a", color: "Đen", size: "M" }),
        facts({ id: "cuid-b", color: "đen", size: "L" }),
      ]),
    }),
  );

  // One colour spelled two ways is still one colour, so this family varies by size alone.
  assert.deepEqual(group.variesBy, ["https://schema.org/size"]);
  assert.equal(group.hasVariant.length, 2);
});

test("U27 an active promotion publishes the discounted price the page actually charges", () => {
  const campaign: ApplicablePromotionCampaign = {
    id: "campaign-1",
    name: "Thu 2026",
    kind: "PROMOTION",
    discountType: "PERCENTAGE",
    percentageValue: 20,
    fixedPriceVnd: null,
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-09-30T00:00:00.000Z"),
  };
  const group = productGroupNode(
    buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: projectedProduct(
        [
          facts({ id: "cuid-a", size: "M", retailPrice: 1_000_000, retailPriceAfterDiscount: 1_000_000 }),
          facts({ id: "cuid-b", size: "L", retailPrice: 1_000_000, retailPriceAfterDiscount: 1_000_000 }),
        ],
        new Map([["cuid-a", [campaign]]]),
      ),
    }),
  );

  // The promoted variant publishes 800.000, not the 1.000.000 the undiscounted rule would quote.
  assert.deepEqual(
    group.hasVariant.map((variant) => variant.offers.price),
    [800_000, 1_000_000],
  );
});

test("U27 a variant whose mirrored discount field differs still publishes its exact retail price", () => {
  const group = productGroupNode(
    buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: projectedProduct([
        facts({ id: "cuid-a", size: "M", retailPrice: 890_000, retailPriceAfterDiscount: 690_000 }),
        facts({ id: "cuid-b", size: "L", retailPrice: 910_000, retailPriceAfterDiscount: 910_000 }),
      ]),
    }),
  );

  // The equality-gated rule would call the first variant unpriceable and publish no offer for it.
  assert.deepEqual(
    group.hasVariant.map((variant) => variant.offers.price),
    [890_000, 910_000],
  );
});

test("U27 the real projection agrees with this file about which options are publishable", () => {
  const group = productGroupNode(
    buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: projectedProduct([
        facts({ id: "cuid-a", size: "M" }),
        facts({ id: "cuid-b", size: "L", sellableStock: 0 }),
        // Unpriceable, unmappable, and one half of a duplicate option pair: none is addressable.
        facts({ id: "cuid-c", size: "XL", retailPrice: null, retailPriceAfterDiscount: null }),
        facts({ id: "cuid-d", size: null }),
        facts({ id: "cuid-e", size: "XXL" }),
        facts({ id: "cuid-f", size: "XXL" }),
      ]),
    }),
  );

  assert.deepEqual(
    group.hasVariant.map((variant) => [variant.size, variant.offers.availability]),
    [
      ["M", "https://schema.org/InStock"],
      ["L", "https://schema.org/OutOfStock"],
    ],
  );
});

/* --------------------------------------------------------- unpublishable external identity */

test("U27 an untrimmed external product identity is refused rather than rewritten", () => {
  const document = build({ pancakeProductId: " pancake-product-1 " });

  assert.equal(document["@graph"][0]["@type"], "Product");
  assert.equal(serializeJsonLd(document).includes("pancake-product-1"), false);
});

test("U27 a price that is not usable money is never published", () => {
  for (const price of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const document = build({
      projection: standaloneProjection([
        option({ id: "cuid-a", pancakeVariationId: "pv-a", size: "M" }),
        option({ id: "cuid-b", pancakeVariationId: "pv-b", size: "L" }),
        option({ id: "cuid-c", pancakeVariationId: "pv-unusable", size: "XL", price }),
      ]),
    });

    assert.equal(serializeJsonLd(document).includes("pv-unusable"), false, String(price));
  }
});
