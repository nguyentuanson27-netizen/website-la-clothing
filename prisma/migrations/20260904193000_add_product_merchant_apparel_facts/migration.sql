-- U25 / #153 M3 — ADR 0007 website-owned Merchant apparel overrides.
--
-- Additive only. Every column is nullable and no existing row is touched, so an older runtime that
-- knows nothing about this table keeps working unchanged: absence of an override is exactly the
-- inheritance state the ADR specifies, which is also the state every product is in before this
-- migration runs.
CREATE TYPE "MerchantGender" AS ENUM ('MALE', 'FEMALE', 'UNISEX');
CREATE TYPE "MerchantAgeGroup" AS ENUM ('NEWBORN', 'INFANT', 'TODDLER', 'KIDS', 'ADULT');
CREATE TYPE "MerchantCondition" AS ENUM ('NEW', 'REFURBISHED', 'USED');

CREATE TABLE "ProductMerchantFacts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "gender" "MerchantGender",
    "ageGroup" "MerchantAgeGroup",
    "condition" "MerchantCondition",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMerchantFacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductMerchantFacts_productId_key" ON "ProductMerchantFacts"("productId");

ALTER TABLE "ProductMerchantFacts"
  ADD CONSTRAINT "ProductMerchantFacts_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;
