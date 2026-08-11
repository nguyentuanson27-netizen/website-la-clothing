-- AlterTable
ALTER TABLE "OrderMirror"
ADD COLUMN "checkoutSnapshottedAt" TIMESTAMP(3),
ADD COLUMN "guestName" TEXT,
ADD COLUMN "guestPhone" TEXT,
ADD COLUMN "provinceRef" TEXT,
ADD COLUMN "districtRef" TEXT,
ADD COLUMN "communeRef" TEXT,
ADD COLUMN "addressDetail" TEXT,
ADD COLUMN "note" TEXT,
ADD COLUMN "merchandiseSubtotalVnd" BIGINT,
ADD COLUMN "shippingFeeVnd" BIGINT,
ADD COLUMN "totalVnd" BIGINT;

-- CreateTable
CREATE TABLE "OrderLineSnapshot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "pancakeVariationId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceVnd" BIGINT NOT NULL,
    "lineTotalVnd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLineSnapshot_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "OrderLineSnapshot_unit_price_nonnegative" CHECK ("unitPriceVnd" >= 0),
    CONSTRAINT "OrderLineSnapshot_line_total_nonnegative" CHECK ("lineTotalVnd" >= 0),
    CONSTRAINT "OrderLineSnapshot_pkey" PRIMARY KEY ("id")
);

-- Snapshot rows created before C7 remain valid with all snapshot fields NULL.
ALTER TABLE "OrderMirror"
ADD CONSTRAINT "OrderMirror_merchandise_subtotal_nonnegative"
CHECK ("merchandiseSubtotalVnd" IS NULL OR "merchandiseSubtotalVnd" >= 0),
ADD CONSTRAINT "OrderMirror_shipping_fee_nonnegative"
CHECK ("shippingFeeVnd" IS NULL OR "shippingFeeVnd" >= 0),
ADD CONSTRAINT "OrderMirror_total_nonnegative"
CHECK ("totalVnd" IS NULL OR "totalVnd" >= 0),
ADD CONSTRAINT "OrderMirror_checkout_snapshot_complete"
CHECK (
  (
    "checkoutSnapshottedAt" IS NULL
    AND "guestName" IS NULL
    AND "guestPhone" IS NULL
    AND "provinceRef" IS NULL
    AND "districtRef" IS NULL
    AND "communeRef" IS NULL
    AND "addressDetail" IS NULL
    AND "note" IS NULL
    AND "merchandiseSubtotalVnd" IS NULL
    AND "shippingFeeVnd" IS NULL
    AND "totalVnd" IS NULL
  )
  OR
  (
    "checkoutSnapshottedAt" IS NOT NULL
    AND "guestName" IS NOT NULL
    AND "guestPhone" IS NOT NULL
    AND "provinceRef" IS NOT NULL
    AND "districtRef" IS NOT NULL
    AND "communeRef" IS NOT NULL
    AND "addressDetail" IS NOT NULL
    AND "merchandiseSubtotalVnd" IS NOT NULL
    AND "shippingFeeVnd" IS NOT NULL
    AND "totalVnd" IS NOT NULL
  )
),
ADD CONSTRAINT "OrderMirror_checkout_total_matches"
CHECK (
  "totalVnd" IS NULL
  OR "totalVnd" = "merchandiseSubtotalVnd" + "shippingFeeVnd"
);

-- CreateIndex
CREATE INDEX "OrderLineSnapshot_orderId_idx" ON "OrderLineSnapshot"("orderId");

-- AddForeignKey
ALTER TABLE "OrderLineSnapshot"
ADD CONSTRAINT "OrderLineSnapshot_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "OrderMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;
