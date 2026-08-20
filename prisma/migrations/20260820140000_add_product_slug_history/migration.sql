-- P6 keeps every previous public slug reserved for permanent redirect history.
CREATE TABLE "ProductSlugHistory" (
    "slug" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSlugHistory_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX "ProductSlugHistory_productId_idx" ON "ProductSlugHistory"("productId");

ALTER TABLE "ProductSlugHistory"
ADD CONSTRAINT "ProductSlugHistory_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every legacy opaque slug before replacing it. The migration runs
-- transactionally, so a collision while assigning the new current slug rolls
-- back the history insert as well rather than leaving a partial lifecycle.
INSERT INTO "ProductSlugHistory" ("slug", "productId")
SELECT "slug", "id"
FROM "ProductMirror"
WHERE "slug" ~ '^p-[0-9a-f]{20}$';

-- Bootstrap a Vietnamese-friendly website-owned slug from the current product
-- name while retaining the existing stable 20-hex product identity digest.
-- PostgreSQL normalization requires UTF-8; the application database is UTF-8.
WITH bootstrap AS (
    SELECT
        "id",
        "slug" AS "oldSlug",
        COALESCE(
            NULLIF(
                BTRIM(
                    REGEXP_REPLACE(
                        LOWER(
                            TRANSLATE(
                                NORMALIZE("name", NFD),
                                U&'\0110\0111\0300\0301\0309\0303\0323\0302\0306\031B',
                                'Dd'
                            )
                        ),
                        '[^a-z0-9]+',
                        '-',
                        'g'
                    ),
                    '-'
                ),
                ''
            ),
            'san-pham'
        ) AS "normalizedName"
    FROM "ProductMirror"
    WHERE "slug" ~ '^p-[0-9a-f]{20}$'
), candidates AS (
    SELECT
        "id",
        "oldSlug",
        COALESCE(
            NULLIF(
                BTRIM(
                    LEFT(
                        CASE
                            WHEN "normalizedName" = 'p' THEN 'san-pham'
                            ELSE "normalizedName"
                        END,
                        139
                    ),
                    '-'
                ),
                ''
            ),
            'san-pham'
        ) || '-' || SUBSTRING("oldSlug" FROM 3) AS "newSlug"
    FROM bootstrap
)
UPDATE "ProductMirror" AS product
SET
    "slug" = candidates."newSlug",
    "updatedAt" = CURRENT_TIMESTAMP
FROM candidates
WHERE product."id" = candidates."id";
