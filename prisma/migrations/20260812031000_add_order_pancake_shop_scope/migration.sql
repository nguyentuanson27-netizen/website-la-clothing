-- Existing orders predate persisted source scope. Keep them NULL so submission fails closed;
-- never backfill from the current PANCAKE_SHOP_ID because the original shop cannot be proven.
ALTER TABLE "OrderMirror" ADD COLUMN "pancakeShopId" INTEGER;
