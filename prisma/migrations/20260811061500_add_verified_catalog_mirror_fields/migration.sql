ALTER TABLE "ProductMirror"
  ADD COLUMN "pancakeShopId" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isPresent" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "VariantMirror"
  ADD COLUMN "pancakeDisplayId" TEXT,
  ADD COLUMN "pancakeBarcode" TEXT,
  ADD COLUMN "pancakeFields" JSONB,
  ADD COLUMN "pancakeImageUrls" JSONB,
  ADD COLUMN "pancakeIsHidden" BOOLEAN,
  ADD COLUMN "pancakeIsLocked" BOOLEAN,
  ADD COLUMN "pancakeRetailPrice" DOUBLE PRECISION,
  ADD COLUMN "pancakeRetailPriceAfterDiscount" DOUBLE PRECISION,
  ADD COLUMN "isPresent" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "WarehouseStock"
  ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;

CREATE INDEX "ProductMirror_pancakeShopId_isPresent_idx"
  ON "ProductMirror"("pancakeShopId", "isPresent");

CREATE INDEX "VariantMirror_isPresent_idx"
  ON "VariantMirror"("isPresent");
