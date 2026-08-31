/**
 * The authoritative campaign-name bound.
 *
 * `MAX_CAMPAIGN_NAME_LENGTH` is defined by #151 as **JavaScript string code units after trim**, and
 * that is a bound only JavaScript can evaluate. PostgreSQL's `char_length` counts characters, so a
 * name of 120 non-BMP characters is 120 to the database and 240 code units to the source contract.
 *
 * The database therefore keeps a sound-but-incomplete guard (non-blank after trim, and no more than
 * 120 characters, which can never reject a name this function accepts) and this function is the one
 * place the exact contract is enforced, before persistence.
 */

export const MAX_CAMPAIGN_NAME_LENGTH = 120;

export const COPY_NAME_SUFFIX = " - Bản sao";

export type PromotionCampaignNameError =
  | "EMPTY_NAME"
  | "NAME_TOO_LONG"
  | "UNSUPPORTED_NAME_CHARACTER";

/**
 * PostgreSQL `text` cannot hold a NUL byte. Without this check a NUL-bearing name passes validation
 * and then fails at the driver — in practice with an empty error message, which is the worst
 * possible outcome for an admin trying to understand why a save failed. If this function returns
 * `ok`, the value must be storable.
 */
const UNSTORABLE_CHARACTER = /\u0000/;

export type PromotionCampaignNameResult =
  | Readonly<{ ok: true; name: string }>
  | Readonly<{ ok: false; error: PromotionCampaignNameError }>;

/**
 * Trims a browser- or service-supplied campaign name and validates it against the exact bound.
 *
 * Returns a typed result rather than throwing: a name that is too long is ordinary invalid input on
 * an admin form, including for a Draft, not an exceptional condition.
 */
export function normalizePromotionCampaignName(raw: unknown): PromotionCampaignNameResult {
  if (typeof raw !== "string") return { ok: false, error: "EMPTY_NAME" };

  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "EMPTY_NAME" };
  if (name.length > MAX_CAMPAIGN_NAME_LENGTH) return { ok: false, error: "NAME_TOO_LONG" };
  if (UNSTORABLE_CHARACTER.test(name)) {
    return { ok: false, error: "UNSUPPORTED_NAME_CHARACTER" };
  }

  return { ok: true, name };
}
