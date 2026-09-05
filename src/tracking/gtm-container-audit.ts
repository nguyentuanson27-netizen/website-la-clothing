/**
 * U28 / T8 — the static gate on a checked-in GTM container export.
 *
 * The storefront may not load a container that has not been proved safe from its own artifact. This
 * module is that proof: it reads an exported container version and answers whether this exact JSON
 * may be loaded. Everything downstream — the loader, the CSP origins, preview enablement — is gated
 * on it, so it is written as a security control rather than a linter.
 *
 * Two design choices follow from that, and both are deliberate:
 *
 * **It fails closed on anything it does not understand.** Google's published export schema could not
 * be fetched in the environment this was written in, so the parser refuses malformed shapes and
 * treats an unrecognised tag type as a possible production destination that still owes a live guard.
 * A schema surprise therefore becomes a loud failure, never a silently passing check.
 *
 * **It collects every violation.** An operator fixing a container wants the whole list, not the
 * first problem; and a partial list invites a second review round that believes it is the last.
 *
 * Tag Assistant is not a substitute for any of this. It observes one preview session; these rules
 * bind the artifact that will be published.
 */

export const GTM_AUDIT_CODES = {
  /** The export could not be parsed as a container version at all. */
  MALFORMED_EXPORT: "MALFORMED_EXPORT",
  /** A mutable workspace export, or one naming no saved version. */
  NOT_A_SAVED_VERSION: "NOT_A_SAVED_VERSION",
  /** A tag that can fire without `la_tracking_mode == live`. */
  TAG_WITHOUT_LIVE_GUARD: "TAG_WITHOUT_LIVE_GUARD",
  /** Meta belongs to the direct first-party integration, never to GTM. */
  META_TAG_PRESENT: "META_TAG_PRESENT",
  /** GA4 would send its own page view beside the application's canonical one. */
  GA4_AUTOMATIC_PAGE_VIEW: "GA4_AUTOMATIC_PAGE_VIEW",
  /** A vendor destination id the owner has not reviewed. */
  UNAPPROVED_DESTINATION: "UNAPPROVED_DESTINATION",
  /** Owner gate O4 is unresolved, so there is nothing to audit the container against. */
  NO_APPROVED_DESTINATIONS: "NO_APPROVED_DESTINATIONS",
} as const;

export type GtmAuditCode = (typeof GTM_AUDIT_CODES)[keyof typeof GTM_AUDIT_CODES];

export type GtmAuditFinding = Readonly<{
  code: GtmAuditCode;
  /** Bounded, non-secret detail: tag name and id only, never parameter payloads. */
  detail: string;
}>;

/**
 * The reviewed vendor ids, owner gate O4.
 *
 * Held as an explicit input rather than read from the environment so the audit is a pure function of
 * (artifact, approval) — the two things a reviewer must look at together.
 */
export type GtmApprovedDestinations = Readonly<{
  ga4MeasurementIds: readonly string[];
  googleAdsConversionIds: readonly string[];
  tiktokPixelIds: readonly string[];
}>;

export type GtmAuditResult = Readonly<{
  ok: boolean;
  findings: readonly GtmAuditFinding[];
  containerVersionId: string | null;
  containerPublicId: string | null;
}>;

/** The application-owned dataLayer fact every production tag must be gated on. */
const TRACKING_MODE_VARIABLE = "la_tracking_mode";
const LIVE_MODE = "live";

/**
 * Tag types that carry no vendor delivery of their own.
 *
 * Kept deliberately small. Everything absent from it — including a type this list has never seen —
 * is treated as a production destination and must prove its guard.
 */
const NON_DELIVERING_TAG_TYPES: ReadonlySet<string> = new Set([
  // Google's conversion linker only writes first-party cookies; it delivers no measurement itself.
  "gclidw",
]);

/** Parameter keys that name a vendor destination, wherever they appear in a tag's parameters. */
const DESTINATION_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  "measurementId",
  "conversionId",
  "pixelId",
  "tagId",
]);

/** Substrings that mark a tag as a Meta integration however it was authored. */
const META_MARKERS = ["facebook", "meta_pixel", "metapixel", "fbq(", "fbevents", "connect.facebook"];

type Parameter = Readonly<{ key?: unknown; value?: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readParameters(value: unknown): readonly Parameter[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parameterValue(parameters: readonly Parameter[], key: string): string | null {
  for (const parameter of parameters) {
    if (readString(parameter.key) === key) return readString(parameter.value);
  }
  return null;
}

/**
 * Whether this trigger admits only `la_tracking_mode == live`.
 *
 * The condition must be an equality on the mode variable against exactly `live`. A trigger with no
 * conditions, or whose conditions name something else, does not constrain the mode and so cannot
 * carry the guard.
 */
function triggerCarriesLiveGuard(trigger: Record<string, unknown>): boolean {
  const conditions = [
    ...(Array.isArray(trigger.filter) ? trigger.filter : []),
    ...(Array.isArray(trigger.customEventFilter) ? trigger.customEventFilter : []),
  ].filter(isRecord);

  return conditions.some((condition) => {
    if (readString(condition.type)?.toLowerCase() !== "equals") return false;
    const parameters = readParameters(condition.parameter);
    const left = parameterValue(parameters, "arg0");
    const right = parameterValue(parameters, "arg1");
    return (
      left !== null
      && right === LIVE_MODE
      && left.replaceAll(/[{}\s]/g, "") === TRACKING_MODE_VARIABLE
    );
  });
}

/**
 * Every string anywhere inside a tag, however deeply nested.
 *
 * GTM nests real payloads inside `LIST` and `MAP` parameters, and a custom template can bury a
 * vendor snippet or a destination id several levels down. A scan that read only top-level parameter
 * values would wave exactly the tags this audit most needs to catch, so both the Meta check and the
 * destination check walk the whole subtree.
 *
 * The walk is depth-bounded because the input is untrusted JSON: a self-referential or pathological
 * structure must not be able to hang the audit. Reaching the bound is itself suspicious, so the
 * caller treats it as a parse failure rather than a clean result.
 */
const MAX_PARAMETER_DEPTH = 32;

function collectStrings(
  value: unknown,
  depth = 0,
  found: { truncated: boolean } = { truncated: false },
): Readonly<{ strings: string[]; truncated: boolean }> {
  if (depth > MAX_PARAMETER_DEPTH) {
    found.truncated = true;
    return { strings: [], truncated: true };
  }

  const strings: string[] = [];
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) strings.push(...collectStrings(entry, depth + 1, found).strings);
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      strings.push(...collectStrings(entry, depth + 1, found).strings);
    }
  }
  return { strings, truncated: found.truncated };
}

/** Every `key`/`value` pair anywhere inside a tag's parameters, however deeply nested. */
function collectKeyedValues(value: unknown, depth = 0): Array<readonly [string, string]> {
  if (depth > MAX_PARAMETER_DEPTH) return [];
  const pairs: Array<readonly [string, string]> = [];
  if (Array.isArray(value)) {
    for (const entry of value) pairs.push(...collectKeyedValues(entry, depth + 1));
  } else if (isRecord(value)) {
    const key = readString(value.key);
    const literal = readString(value.value);
    if (key !== null && literal !== null) pairs.push([key, literal]);
    for (const entry of Object.values(value)) pairs.push(...collectKeyedValues(entry, depth + 1));
  }
  return pairs;
}

function tagIsMeta(tag: Record<string, unknown>): boolean {
  const haystack = collectStrings(tag).strings.join(" ").toLowerCase();
  return META_MARKERS.some((marker) => haystack.includes(marker));
}

/** Every destination id this tag would deliver to, whatever vendor it belongs to. */
function destinationIds(tag: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const [key, value] of collectKeyedValues(tag.parameter)) {
    if (!DESTINATION_PARAMETER_KEYS.has(key)) continue;
    // A `{{variable}}` reference is not a literal id and is reviewed through the variable it names.
    if (value.length > 0 && !value.includes("{{")) ids.push(value);
  }
  return ids;
}

function isGa4ConfigurationTag(tag: Record<string, unknown>): boolean {
  return readString(tag.type) === "gaawc";
}

export function auditGtmContainerExport({
  source,
  approved,
}: Readonly<{
  source: unknown;
  approved: GtmApprovedDestinations;
}>): GtmAuditResult {
  const findings: GtmAuditFinding[] = [];
  const refuse = (code: GtmAuditCode, detail: string) => findings.push(Object.freeze({ code, detail }));

  const approvedIds = new Set([
    ...approved.ga4MeasurementIds,
    ...approved.googleAdsConversionIds,
    ...approved.tiktokPixelIds,
  ]);
  if (approvedIds.size === 0) {
    // Owner gate O4. Passing here would certify a container against no reviewed destination at all.
    refuse(
      GTM_AUDIT_CODES.NO_APPROVED_DESTINATIONS,
      "no reviewed vendor destination ids were supplied (owner gate O4)",
    );
  }

  const version = isRecord(source) ? source.containerVersion : undefined;
  if (!isRecord(version)) {
    refuse(GTM_AUDIT_CODES.MALFORMED_EXPORT, "export has no containerVersion object");
    return Object.freeze({
      ok: false,
      findings: Object.freeze(findings),
      containerVersionId: null,
      containerPublicId: null,
    });
  }

  const tags = version.tag;
  const triggers = version.trigger;
  if (!Array.isArray(tags) || !Array.isArray(triggers)) {
    refuse(GTM_AUDIT_CODES.MALFORMED_EXPORT, "containerVersion has no tag/trigger arrays");
    return Object.freeze({
      ok: false,
      findings: Object.freeze(findings),
      containerVersionId: null,
      containerPublicId: null,
    });
  }

  const containerVersionId = readString(version.containerVersionId);
  const containerPublicId = isRecord(version.container)
    ? readString(version.container.publicId)
    : null;

  // A workspace export carries no saved version, and "0" is the placeholder an unsaved export uses.
  if (containerVersionId === null || containerVersionId === "" || containerVersionId === "0") {
    refuse(
      GTM_AUDIT_CODES.NOT_A_SAVED_VERSION,
      "export names no saved container version; a mutable workspace export may not be published",
    );
  }

  const guardedTriggerIds = new Set(
    triggers
      .filter(isRecord)
      .filter(triggerCarriesLiveGuard)
      .map((trigger) => readString(trigger.triggerId))
      .filter((id): id is string => id !== null),
  );

  for (const candidate of tags) {
    if (!isRecord(candidate)) {
      refuse(GTM_AUDIT_CODES.MALFORMED_EXPORT, "container holds a tag entry that is not an object");
      continue;
    }

    const label = `${readString(candidate.name) ?? "unnamed"} (#${readString(candidate.tagId) ?? "?"})`;

    if (collectStrings(candidate).truncated) {
      refuse(
        GTM_AUDIT_CODES.MALFORMED_EXPORT,
        `${label} nests parameters deeper than this audit will walk`,
      );
    }

    if (tagIsMeta(candidate)) {
      refuse(
        GTM_AUDIT_CODES.META_TAG_PRESENT,
        `${label} looks like a Meta integration; Meta stays direct and must not enter GTM`,
      );
    }

    const type = readString(candidate.type) ?? "";
    if (!NON_DELIVERING_TAG_TYPES.has(type)) {
      const firingTriggerIds = Array.isArray(candidate.firingTriggerId)
        ? candidate.firingTriggerId.map(readString).filter((id): id is string => id !== null)
        : [];
      // Every firing path must be guarded: one unguarded trigger is enough to fire the tag, and a
      // dangling id cannot be shown to carry a guard at all.
      const guarded =
        firingTriggerIds.length > 0
        && firingTriggerIds.every((id) => guardedTriggerIds.has(id));
      if (!guarded) {
        refuse(
          GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD,
          `${label} can fire without ${TRACKING_MODE_VARIABLE} == ${LIVE_MODE}`,
        );
      }
    }

    if (isGa4ConfigurationTag(candidate)) {
      const sendPageView = parameterValue(readParameters(candidate.parameter), "sendPageView");
      if (sendPageView !== "false") {
        refuse(
          GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW,
          `${label} does not disable GA4 automatic page views; the application owns the canonical page view`,
        );
      }
    }

    for (const id of destinationIds(candidate)) {
      if (!approvedIds.has(id)) {
        refuse(
          GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
          `${label} delivers to an unreviewed destination id`,
        );
      }
    }
  }

  return Object.freeze({
    ok: findings.length === 0,
    findings: Object.freeze(findings),
    containerVersionId,
    containerPublicId,
  });
}
