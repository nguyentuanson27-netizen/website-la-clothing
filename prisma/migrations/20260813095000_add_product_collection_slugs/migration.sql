-- AlterTable
ALTER TABLE "ProductContent"
ADD COLUMN "collectionSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
