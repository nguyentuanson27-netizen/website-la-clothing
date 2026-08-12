ALTER TABLE "OrderMirror"
ADD COLUMN "sourceCartId" TEXT;

CREATE INDEX "OrderMirror_sourceCartId_idx"
ON "OrderMirror"("sourceCartId");

CREATE UNIQUE INDEX "OrderMirror_one_active_checkout_per_cart_key"
ON "OrderMirror"("sourceCartId")
WHERE "sourceCartId" IS NOT NULL
  AND "state" IN ('DRAFT', 'VALIDATING', 'POS_SUBMITTING', 'CONFIRMED', 'SYNC_UNKNOWN');
