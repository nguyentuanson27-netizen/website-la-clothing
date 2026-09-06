/**
 * Advisory SEO lengths for the admin editor (U34a / W16).
 *
 * These are the points past which search results usually truncate, so the editor counts towards
 * them and says when copy runs long. They are advice and nothing else: no validation reads them,
 * no save path consults them, and nothing is blocked, disabled or gated on them. The only enforced
 * bounds are `PRODUCT_CONTENT_LIMITS` in `product-content-admin.ts`, which sit far above these -
 * a domain test pins that gap so the advice cannot quietly become a limit.
 *
 * This module deliberately imports nothing. The counter is a client component, and
 * `product-content-admin.ts` reaches server-only authorization, so the two must not share a file.
 */
export const SEO_LENGTH_GUIDANCE = {
  seoTitle: 60,
  seoDescription: 155,
} as const;

/**
 * What the editor shows. Counted in code points rather than UTF-16 units so a character the author
 * typed counts once, which is what the advice is about.
 */
export function measureSeoLength(
  value: string,
  recommendedLength: number,
): Readonly<{ length: number; overRecommended: boolean }> {
  const length = Array.from(value).length;
  return { length, overRecommended: length > recommendedLength };
}
