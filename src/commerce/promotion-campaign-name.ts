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

export type PromotionCampaignNameError = "EMPTY_NAME" | "NAME_TOO_LONG";

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

  return { ok: true, name };
}
