CREATE TABLE "CatalogSyncState" (
  "pancakeShopId" INTEGER NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CatalogSyncState_pkey" PRIMARY KEY ("pancakeShopId")
);
