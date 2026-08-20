-- P5 editorial workflow: additive, fail-closed publication state.
CREATE TYPE "ProductContentStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED');

ALTER TABLE "ProductContent"
ADD COLUMN "status" "ProductContentStatus" NOT NULL DEFAULT 'DRAFT';
