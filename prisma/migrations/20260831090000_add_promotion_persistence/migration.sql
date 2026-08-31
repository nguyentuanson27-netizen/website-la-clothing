-- P1 promotions & flash sale v1: campaign/target persistence, additive final-order promotion audit,
-- and one durable bounded promotion-pricing revision.
--
-- The migration is additive throughout. No existing column is dropped, retyped or made stricter, so
-- historical order rows stay valid and an application rollback is never blocked by a column that
-- older code does not write. The mirrored Pancake price columns keep their external `DOUBLE
-- PRECISION` contract; website-owned money is integer VND.
--
-- Only invariants that are universal for persisted state live here. Draft campaigns are explicit
-- work-in-progress and may be incomplete or business-invalid; P4's lifecycle service owns the
-- activation-capable Publish/re-enable/Scheduled-edit checks for economic validity and time windows.
-- The database still protects syntactic name storage, discount-field shape, target shape/identity,
-- uniqueness, final-order audit integrity, and the bounded durable pricing revision.

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

-- A sound-but-incomplete guard, deliberately not a restatement of the source bound.
--
-- #151 defines the name bound as 120 JavaScript string code units *after trim*, which PostgreSQL
-- cannot evaluate: `char_length` counts characters, so 120 non-BMP characters are 120 here and 240
-- code units there. What the database can express exactly is that a name is never blank after
-- trimming, plus a character ceiling that can only ever reject names the source bound already
-- rejects — it never accepts less than JavaScript does, so it is safe as defence in depth.
--
-- The blank check trims the ASCII whitespace set rather than bare `btrim`, which strips spaces only
-- and would let a tab-and-newline name through. JavaScript's `trim()` also strips Unicode
-- whitespace, which this does not; that residue is the application bound's job too.
--
-- `normalizePromotionCampaignName` in src/commerce/promotion-campaign-name.ts is the one place the
-- exact contract is enforced, before persistence.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_name_check"
CHECK (btrim("name", E' \t\n\r\f\x0B') <> '' AND char_length("name") <= 120);

-- Discount-field shape is universal at rest: the inactive field for the selected discount type must
-- stay null so a row never carries two competing money representations. The selected value itself
-- may be null or business-invalid while Draft; Publish/re-enable validates completeness and the
-- 1..99 / positive-below-base economic rules in P4.
ALTER TABLE "PromotionCampaign"
ADD CONSTRAINT "PromotionCampaign_discount_money_check"
CHECK (
  (
    "discountType" = 'PERCENTAGE'
    AND "fixedPriceVnd" IS NULL
  )
  OR (
    "discountType" = 'FIXED_PRICE'
    AND "percentageValue" IS NULL
  )
);

-- Time configuration is intentionally unconstrained at rest beyond PostgreSQL timestamp storage.
-- Draft may carry missing, empty or inverted windows while an admin edits it. P4 validates the
-- half-open interval contract and requires both Flash Sale bounds before an activation-capable write.

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