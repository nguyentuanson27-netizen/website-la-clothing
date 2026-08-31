-- P1 promotions & flash sale v1: campaign/target persistence, additive final-order promotion audit,
-- and one durable bounded promotion-pricing revision.
--
-- The migration is additive throughout. No existing column is dropped, retyped or made stricter, so
-- historical order rows stay valid and an application rollback is never blocked by a column that
-- older code does not write. The mirrored Pancake price columns keep their external `DOUBLE
-- PRECISION` contract; website-owned money is integer VND.
--
-- Shape, uniqueness, money and window invariants are enforced here rather than in the admin UI: the
-- database is the last line that a mistaken service, script or manual fix still has to pass.

CREATE TYPE "PromotionCampaignKind" AS ENUM ('PROMOTION', 'FLASH_SALE');
CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_PRICE');

CREATE TABLE "PromotionCampaign" (
  "id" TEXT NOT NULL,
  "kind" "PromotionCampaignKind" NOT NULL,
  "name" TEXT NOT NULL,
  "discountType" "PromotionDiscountType" NOT NULL,
  "percentageValue" INTEGER,
  "fixedPriceVnd" BIGINT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PromotionCampaign_pkey" PRIMARY KEY ("id")
);

-- Server-authoritative bound: 120 code units after trim, and never empty, including for a Draft.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_name_check"
CHECK (length("name") BETWEEN 1 AND 120);

-- Exactly one money field per discount type. A campaign carrying both would leave two candidate
-- prices for the same line with nothing to arbitrate between them.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_discount_money_check"
CHECK (
  (
    "discountType" = 'PERCENTAGE'
    AND "percentageValue" IS NOT NULL
    AND "fixedPriceVnd" IS NULL
  )
  OR (
    "discountType" = 'FIXED_PRICE'
    AND "fixedPriceVnd" IS NOT NULL
    AND "percentageValue" IS NULL
  )
);

-- 100% would make the price zero and 0% is not a discount at all.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_percentage_range_check"
CHECK ("percentageValue" IS NULL OR "percentageValue" BETWEEN 1 AND 99);

-- FIXED_PRICE is a final customer unit price, not an amount off, so it must be positive. Whether it
-- is below the base price is a per-variant runtime question the pricing resolver owns.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_fixed_price_check"
CHECK ("fixedPriceVnd" IS NULL OR "fixedPriceVnd" > 0);

-- Intervals are half-open [startsAt, endsAt): an empty or inverted window is never valid, and a
-- Flash Sale is defined by having both bounds.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_window_check"
CHECK (
  "startsAt" IS NULL
  OR "endsAt" IS NULL
  OR "endsAt" > "startsAt"
);

ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_flash_sale_window_check"
CHECK (
  "kind" <> 'FLASH_SALE'
  OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL)
);

CREATE INDEX "PromotionCampaign_isEnabled_startsAt_endsAt_idx"
ON "PromotionCampaign"("isEnabled", "startsAt", "endsAt");

CREATE TABLE "PromotionTarget" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "productId" TEXT,
  "variantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PromotionTarget_pkey" PRIMARY KEY ("id")
);

-- A target names exactly one scope: a product (a semantic scope over its current variants) or one
-- concrete variant.
ALTER TABLE "PromotionTarget"
ADD CONSTRAINT "PromotionTarget_scope_check"
CHECK (num_nonnulls("productId", "variantId") = 1);

ALTER TABLE "PromotionTarget"
ADD CONSTRAINT "PromotionTarget_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "PromotionCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionTarget"
ADD CONSTRAINT "PromotionTarget_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionTarget"
ADD CONSTRAINT "PromotionTarget_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "VariantMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Duplicate targets inside one campaign are invalid. NULLs are distinct in a PostgreSQL unique
-- index, so these two constraints do not collide on the unused scope column.
CREATE UNIQUE INDEX "PromotionTarget_campaignId_productId_key"
ON "PromotionTarget"("campaignId", "productId");

CREATE UNIQUE INDEX "PromotionTarget_campaignId_variantId_key"
ON "PromotionTarget"("campaignId", "variantId");

CREATE INDEX "PromotionTarget_productId_idx" ON "PromotionTarget"("productId");
CREATE INDEX "PromotionTarget_variantId_idx" ON "PromotionTarget"("variantId");

-- One durable, server-owned, monotonic revision of effective promotion pricing.
--
-- Bounded cardinality is the requirement, not an optimization: a later Merchant cache decision must
-- be able to read the current generation cheaply inside its bounded DB budget, and a promotion
-- mutation must be able to advance it inside the same transaction that commits the mutation. The
-- primary-key check keeps it a singleton no matter what writes to it.
CREATE TABLE "PromotionPricingRevision" (
  "id" TEXT NOT NULL DEFAULT 'current',
  "revision" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PromotionPricingRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PromotionPricingRevision"
ADD CONSTRAINT "PromotionPricingRevision_singleton_check"
CHECK ("id" = 'current');

ALTER TABLE "PromotionPricingRevision"
ADD CONSTRAINT "PromotionPricingRevision_non_negative_check"
CHECK ("revision" >= 0);

INSERT INTO "PromotionPricingRevision" ("id", "revision", "updatedAt")
VALUES ('current', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Additive final-order promotion audit. `unitPriceVnd` stays the final customer price; the new
-- columns record what it would have been and which campaign changed it. The campaign reference is a
-- snapshot rather than a foreign key: finalized order history must never be rewritten by anything
-- that later happens to the campaign row.
ALTER TABLE "OrderLineSnapshot"
ADD COLUMN "baseUnitPriceVnd" BIGINT,
ADD COLUMN "promotionCampaignId" TEXT,
ADD COLUMN "promotionName" TEXT,
ADD COLUMN "promotionKind" "PromotionCampaignKind",
ADD COLUMN "promotionDiscountType" "PromotionDiscountType",
ADD COLUMN "promotionPercentageValue" INTEGER,
ADD COLUMN "promotionFixedPriceVnd" BIGINT;

ALTER TABLE "OrderLineSnapshot"
ADD CONSTRAINT "OrderLineSnapshot_base_unit_price_check"
CHECK ("baseUnitPriceVnd" IS NULL OR "baseUnitPriceVnd" >= 0);

-- Promotion audit is all-or-nothing. Historical rows have every column null and stay valid; a
-- promoted line can never claim an unnamed or untyped promotion, and audit facts can never appear
-- without the promotion they belong to.
ALTER TABLE "OrderLineSnapshot"
ADD CONSTRAINT "OrderLineSnapshot_promotion_audit_check"
CHECK (
  (
    "promotionCampaignId" IS NULL
    AND "promotionName" IS NULL
    AND "promotionKind" IS NULL
    AND "promotionDiscountType" IS NULL
    AND "promotionPercentageValue" IS NULL
    AND "promotionFixedPriceVnd" IS NULL
  )
  OR (
    "promotionCampaignId" IS NOT NULL
    AND "promotionName" IS NOT NULL
    AND "promotionKind" IS NOT NULL
    AND "baseUnitPriceVnd" IS NOT NULL
    AND (
      (
        "promotionDiscountType" = 'PERCENTAGE'
        AND "promotionPercentageValue" IS NOT NULL
        AND "promotionFixedPriceVnd" IS NULL
      )
      OR (
        "promotionDiscountType" = 'FIXED_PRICE'
        AND "promotionFixedPriceVnd" IS NOT NULL
        AND "promotionPercentageValue" IS NULL
      )
    )
  )
);
