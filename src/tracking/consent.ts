/**
 * Vendor-neutral consent state.
 *
 * The application owns the policy; destinations only observe the resulting signals. Current owner
 * policy grants tracking as soon as a visitor enters the site and keeps the visible consent UI
 * deferred. Replacing that later with a default-denied policy plus a real consent surface must be a
 * change to this module alone — the commerce event contract does not encode consent, so swapping
 * the policy cannot invalidate any event shape.
 */

export type ConsentSignal = "granted" | "denied";

export const CONSENT_SIGNAL_KEYS = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
  "functionality_storage",
  "personalization_storage",
  "security_storage",
] as const;

export type ConsentSignalKey = (typeof CONSENT_SIGNAL_KEYS)[number];

export type ConsentState = Readonly<Record<ConsentSignalKey, ConsentSignal>>;

export type ConsentPolicy = Readonly<{
  id: string;
  defaultSignal: ConsentSignal;
  visibleConsentUi: boolean;
}>;

/**
 * `security_storage` covers storage strictly required to keep the site secure. It is not an
 * optional measurement signal, so it stays granted under any policy.
 */
const ALWAYS_GRANTED: ReadonlySet<ConsentSignalKey> = new Set(["security_storage"]);

export const CURRENT_CONSENT_POLICY: ConsentPolicy = Object.freeze({
  id: "granted-on-entry",
  defaultSignal: "granted" as const,
  visibleConsentUi: false,
});

export function readConsentPolicy(): ConsentPolicy {
  return CURRENT_CONSENT_POLICY;
}

export function resolveConsentDefaults(policy: ConsentPolicy): ConsentState {
  const state = {} as Record<ConsentSignalKey, ConsentSignal>;
  for (const key of CONSENT_SIGNAL_KEYS) {
    state[key] = ALWAYS_GRANTED.has(key) ? "granted" : policy.defaultSignal;
  }
  return Object.freeze(state);
}

export type ConsentDefaultCommand = readonly ["consent", "default", ConsentState];

/**
 * The Google consent-default command, queued before any measurement can run. It is a plain data
 * value here so it can be serialized into the first-party bootstrap and asserted in tests without a
 * vendor library being present.
 */
export function buildConsentDefaultCommand(policy: ConsentPolicy): ConsentDefaultCommand {
  return Object.freeze(["consent", "default", resolveConsentDefaults(policy)] as const);
}
