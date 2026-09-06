/**
 * The brand identity a social card carries, in one place.
 *
 * The product detail page and the root fallback have to agree about what LA Clothing's card looks
 * like — same name, same image, same alt text — or a share from a collection page and a share from
 * a product page would present the site as two different brands. They are separate metadata
 * builders answering to separate contracts, so the agreement lives here rather than in either of
 * them.
 *
 * Everything here is an existing, owner-approved site fact. No social handle, contact channel or
 * business claim belongs in this file; those are owner decisions that have not been made.
 */

export const SITE_NAME = "LA Clothing";

/**
 * The website-owned branded card, served by Next from `src/app/` as a file-based asset.
 *
 * Referenced as a path, never a full URL: it is resolved against whichever trusted origin the
 * server owns at request time, so it follows the origin rather than pinning a hostname.
 */
export const SOCIAL_FALLBACK_PATH = "/la-clothing-modern-menswear-social-card.png";

export const SOCIAL_FALLBACK_ALT = "LA Clothing — Modern Menswear";

/** The site's own locale, matching the `lang` the root layout serves. */
export const SITE_LOCALE = "vi_VN";
