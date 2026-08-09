-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SyncEventStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ProductMirror" (
    "id" TEXT NOT NULL,
    "pancakeProductId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMirror" (
    "id" TEXT NOT NULL,
    "pancakeVariationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "color" TEXT,
    "size" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantMirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStock" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "pancakeWarehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "SyncEventStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMirror_pancakeProductId_key" ON "ProductMirror"("pancakeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMirror_slug_key" ON "ProductMirror"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMirror_pancakeVariationId_key" ON "VariantMirror"("pancakeVariationId");

-- CreateIndex
CREATE INDEX "VariantMirror_productId_idx" ON "VariantMirror"("productId");

-- CreateIndex
CREATE INDEX "VariantMirror_sku_idx" ON "VariantMirror"("sku");

-- CreateIndex
CREATE INDEX "WarehouseStock_pancakeWarehouseId_idx" ON "WarehouseStock"("pancakeWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStock_variantId_pancakeWarehouseId_key" ON "WarehouseStock"("variantId", "pancakeWarehouseId");

-- CreateIndex
CREATE INDEX "SyncEvent_kind_status_idx" ON "SyncEvent"("kind", "status");

-- CreateIndex
CREATE INDEX "SyncEvent_externalId_idx" ON "SyncEvent"("externalId");

-- AddForeignKey
ALTER TABLE "VariantMirror" ADD CONSTRAINT "VariantMirror_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VariantMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

