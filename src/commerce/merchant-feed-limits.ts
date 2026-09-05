export const MAX_MERCHANT_OFFERS = 5_000;
export const MAX_MERCHANT_FEED_BYTES = 16 * 1024 * 1024;
export const MAX_MERCHANT_DB_ROUND_TRIPS = 8;
export const MERCHANT_FEED_CACHE_TTL_SECONDS = 300;
export const MERCHANT_FEED_FAILURE_BACKOFF_SECONDS = 60;

/**
 * U26 reads the public-feed catalog through eight flat, bounded Prisma queries. Candidate variants
 * are bounded separately from emitted offers because excluded variants still have to be audited and
 * mapped before the serializer can enforce the 5,000-offer output ceiling.
 */
export const MAX_MERCHANT_CANDIDATE_VARIANTS = 7_000;
