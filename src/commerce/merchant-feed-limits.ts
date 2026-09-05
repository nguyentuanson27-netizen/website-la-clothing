export const MAX_MERCHANT_OFFERS = 5_000;
export const MAX_MERCHANT_FEED_BYTES = 16 * 1024 * 1024;
export const MAX_MERCHANT_DB_ROUND_TRIPS = 8;
export const MERCHANT_FEED_CACHE_TTL_SECONDS = 300;
export const MERCHANT_FEED_FAILURE_BACKOFF_SECONDS = 60;

/**
 * U26 can spend one query on the canonical U25 product projection and at most seven on promotion
 * membership. The trusted promotion reader deliberately stays below the generic PostgreSQL
 * parameter ceiling and, unlike the public/cart reader, accepts no request-controlled identities.
 */
export const MAX_MERCHANT_PROMOTION_VARIANTS_PER_QUERY = 1_000;
export const MAX_MERCHANT_CANDIDATE_VARIANTS =
  (MAX_MERCHANT_DB_ROUND_TRIPS - 1) * MAX_MERCHANT_PROMOTION_VARIANTS_PER_QUERY;
