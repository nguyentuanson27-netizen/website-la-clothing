ALTER TABLE "CollectionDefinition"
ADD COLUMN "homepagePosition" INTEGER;

CREATE UNIQUE INDEX "CollectionDefinition_homepagePosition_key"
ON "CollectionDefinition"("homepagePosition");

ALTER TABLE "CollectionDefinition"
ADD CONSTRAINT "CollectionDefinition_homepagePosition_check"
CHECK (
  "homepagePosition" IS NULL
  OR "homepagePosition" BETWEEN 1 AND 6
);
