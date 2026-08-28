import { Prisma } from "../generated/prisma/client.ts";
import { MAX_MEDIA_CANDIDATES_SCANNED } from "./product-media.ts";

/**
 * Database-side equivalents of the operational health predicates the admin directory filters on.
 *
 * These exist because the two hardest dimensions cannot be expressed as Prisma predicates:
 * `stocked-inactive` needs the *summed* warehouse quantity per variant (several warehouses can
 * cancel out to zero or below), and `missing-image` needs the exact effective storefront media
 * resolution. Both must be evaluated against the full catalog before pagination, so they are
 * written as bounded set-based SQL instead of post-filtering the current page.
 */

/**
 * The whitespace `String.prototype.trim()` strips: WhiteSpace + LineTerminator, i.e. the ASCII
 * blanks plus NBSP, ZWNBSP, LS/PS and the Unicode space separators. `parseTrustedProductImageUrl`
 * trims before every other check, so the SQL mirror has to trim exactly the same set.
 */
const JS_TRIM_CLASS =
  "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

/** The reviewed Pancake CDN path shape, mirroring `PANCAKE_MEDIA_PATH_REGEX`. */
const PANCAKE_MEDIA_PATH_PATTERN =
  "^/[a-zA-Z0-9_-]+/[0-9]+/[0-9]+/[0-9]+/[a-zA-Z0-9_.-]+\\.jpg$";

const TRUSTED_IMAGE_AUTHORITY = "content.pancake.vn";
const MAX_IMAGE_URL_LENGTH = 4096;

/**
 * Normalizes one raw candidate URL the way `parseTrustedProductImageUrl` does before it decides:
 *
 * - `trimmed` is the JS-trimmed input every raw check (length, `..`, authority) runs against;
 * - `authority` is the raw authority slice, so a credential, port or embedded control character
 *   fails exactly as it does in the parser;
 * - `pathFinal` is the WHATWG-normalized path: query/fragment removed, tab/newline/carriage
 *   return stripped anywhere in the URL, and `/./` segments resolved.
 */
function normalizedCandidateColumns(url: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      input."trimmed",
      SPLIT_PART(SUBSTR(input."trimmed", 9), '/', 1) AS "authority",
      REGEXP_REPLACE(
        TRANSLATE(
          SPLIT_PART(SPLIT_PART(
            SUBSTR(input."trimmed", 9 + LENGTH(SPLIT_PART(SUBSTR(input."trimmed", 9), '/', 1))),
            '#', 1
          ), '?', 1),
          CHR(9) || CHR(10) || CHR(13),
          ''
        ),
        '(/\\.)+/', '/', 'g'
      ) AS "pathFinal"
    FROM (
      SELECT REGEXP_REPLACE(
        ${url},
        ${`^${JS_TRIM_CLASS}+|${JS_TRIM_CLASS}+$`},
        '',
        'g'
      ) AS "trimmed"
    ) input
  `;
}

/** The trust decision over the normalized columns produced by `normalizedCandidateColumns`. */
const TRUSTED_CANDIDATE_CONDITION = Prisma.sql`
  norm."trimmed" <> ''
  AND LENGTH(norm."trimmed") <= ${MAX_IMAGE_URL_LENGTH}
  AND POSITION('/..' IN norm."trimmed") = 0
  AND POSITION('../' IN norm."trimmed") = 0
  AND POSITION('%2e%2e' IN LOWER(norm."trimmed")) = 0
  AND LOWER(LEFT(norm."trimmed", 8)) = 'https://'
  AND norm."authority" = ${TRUSTED_IMAGE_AUTHORITY}
  AND POSITION('..' IN norm."pathFinal") = 0
  AND norm."pathFinal" ~ ${PANCAKE_MEDIA_PATH_PATTERN}
`;

/** Single-value parity probe used by the media parity regression. */
export function trustedProductImageUrlProbeSql(url: string): Prisma.Sql {
  return Prisma.sql`
    SELECT (${TRUSTED_CANDIDATE_CONDITION}) AS "trusted"
    FROM (${normalizedCandidateColumns(Prisma.sql`${url}`)}) norm
  `;
}

function scopeCondition(column: Prisma.Sql, productIds: readonly string[] | null): Prisma.Sql {
  return productIds === null
    ? Prisma.sql`TRUE`
    : Prisma.sql`${column} = ANY(${[...productIds]}::text[])`;
}

/**
 * The effective storefront media inputs, in the resolver's scan order:
 * `ProductMirror.primaryImageUrl` first, then the `pancakeImageUrls` string entries of variants
 * with `isPresent = true AND isActive = true` ordered by `pancakeVariationId ASC`, preserving
 * each array's own order. `scanIndex` reproduces `resolveStorefrontProductMedia`'s raw candidate
 * counter, so the `MAX_MEDIA_CANDIDATES_SCANNED` bound means the same thing on both sides.
 */
function imageCandidateCte(productIds: readonly string[] | null): Prisma.Sql {
  return Prisma.sql`
    "health_image_candidate" AS (
      SELECT
        raw."productId",
        ROW_NUMBER() OVER (
          PARTITION BY raw."productId"
          ORDER BY raw."sourceRank" ASC, raw."variantRank" ASC, raw."imageRank" ASC
        ) AS "scanIndex",
        (${TRUSTED_CANDIDATE_CONDITION}) AS "isTrusted"
      FROM (
        SELECT
          p."id" AS "productId",
          0 AS "sourceRank",
          0::bigint AS "variantRank",
          0::bigint AS "imageRank",
          p."primaryImageUrl" AS "url"
        FROM "ProductMirror" p
        WHERE p."primaryImageUrl" IS NOT NULL
          AND p."primaryImageUrl" <> ''
          AND ${scopeCondition(Prisma.sql`p."id"`, productIds)}
        UNION ALL
        SELECT
          ordered."productId",
          1 AS "sourceRank",
          ordered."variantRank",
          image."imageRank",
          image."value" #>> '{}' AS "url"
        FROM (
          SELECT
            v."productId",
            v."pancakeImageUrls",
            ROW_NUMBER() OVER (
              PARTITION BY v."productId"
              ORDER BY v."pancakeVariationId" ASC
            ) AS "variantRank"
          FROM "VariantMirror" v
          WHERE v."isPresent" = TRUE
            AND v."isActive" = TRUE
            AND JSONB_TYPEOF(v."pancakeImageUrls") = 'array'
            AND ${scopeCondition(Prisma.sql`v."productId"`, productIds)}
        ) ordered
        CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(ordered."pancakeImageUrls")
          WITH ORDINALITY AS image("value", "imageRank")
        WHERE JSONB_TYPEOF(image."value") = 'string'
      ) raw
      CROSS JOIN LATERAL (${normalizedCandidateColumns(Prisma.sql`raw."url"`)}) norm
    )
  `;
}

/**
 * Present variants with their summed warehouse stock.
 *
 * A non-finite mirrored quantity makes the sum unusable rather than positive, matching the
 * quick-action's refusal to treat malformed stock as sellable.
 */
function variantStockCte(productIds: readonly string[] | null): Prisma.Sql {
  return Prisma.sql`
    "health_variant_stock" AS (
      SELECT
        v."productId",
        v."id",
        v."isActive",
        CASE
          WHEN BOOL_AND(
            ws."quantity" IS NULL
            OR (
              ws."quantity" <> 'NaN'::float8
              AND ws."quantity" <> 'Infinity'::float8
              AND ws."quantity" <> '-Infinity'::float8
            )
          ) THEN COALESCE(SUM(ws."quantity"), 0::float8)
          ELSE NULL
        END AS "stock"
      FROM "VariantMirror" v
      LEFT JOIN "WarehouseStock" ws ON ws."variantId" = v."id"
      WHERE v."isPresent" = TRUE
        AND ${scopeCondition(Prisma.sql`v."productId"`, productIds)}
      GROUP BY v."id"
    )
  `;
}

const MISSING_IMAGE_CONDITION = Prisma.sql`
  NOT EXISTS (
    SELECT 1
    FROM "health_image_candidate" candidate
    WHERE candidate."productId" = p."id"
      AND candidate."scanIndex" <= ${MAX_MEDIA_CANDIDATES_SCANNED}
      AND candidate."isTrusted"
  )
`;

const STOCKED_INACTIVE_CONDITION = Prisma.sql`
  EXISTS (
    SELECT 1
    FROM "health_variant_stock" stock
    WHERE stock."productId" = p."id"
      AND stock."isActive" = FALSE
      AND stock."stock" > 0
  )
`;

/** Full-catalog product IDs whose effective storefront media resolves to no primary image. */
export const missingImageProductIdsSql = Prisma.sql`
  WITH ${imageCandidateCte(null)}
  SELECT p."id"
  FROM "ProductMirror" p
  WHERE ${MISSING_IMAGE_CONDITION}
`;

/** Full-catalog product IDs with at least one present inactive variant holding positive stock. */
export const stockedInactiveProductIdsSql = Prisma.sql`
  WITH ${variantStockCte(null)}
  SELECT p."id"
  FROM "ProductMirror" p
  WHERE ${STOCKED_INACTIVE_CONDITION}
`;

/**
 * Server-derived row metrics for one bounded set of directory rows. One query for the whole page
 * rather than a per-product read, so the directory keeps a fixed query count.
 */
export function directoryHealthMetricsSql(productIds: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    WITH ${variantStockCte(productIds)},
    ${imageCandidateCte(productIds)}
    SELECT
      p."id",
      COUNT(stock."id")::bigint AS "presentVariantCount",
      COUNT(stock."id") FILTER (WHERE stock."isActive")::bigint AS "activeVariantCount",
      COUNT(stock."id") FILTER (
        WHERE stock."isActive" = FALSE AND stock."stock" > 0
      )::bigint AS "stockedInactiveCount",
      ${MISSING_IMAGE_CONDITION} AS "missingImage"
    FROM "ProductMirror" p
    LEFT JOIN "health_variant_stock" stock ON stock."productId" = p."id"
    WHERE p."id" = ANY(${[...productIds]}::text[])
    GROUP BY p."id"
  `;
}
