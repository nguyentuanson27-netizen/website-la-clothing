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
 * be fetched in the environment this was written in, so the parser refuses malformed shapes, and a
 * tag whose type it has no reviewed parser for is refused outright rather than certified by its
 * firing guard. A live guard says *when* a tag fires, never *where* it delivers; for a Custom HTML
 * tag or a gallery template the delivery lives in code the export does not even contain. A schema
 * surprise therefore becomes a loud failure, never a silently passing check.
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
  /** A tag type whose delivery this audit has no reviewed parser for. */
  UNAUDITABLE_TAG_TYPE: "UNAUDITABLE_TAG_TYPE",
  /** Meta belongs to the direct first-party integration, never to GTM. */
  META_TAG_PRESENT: "META_TAG_PRESENT",
  /** GA4 would send its own page view beside the application's canonical one. */
  GA4_AUTOMATIC_PAGE_VIEW: "GA4_AUTOMATIC_PAGE_VIEW",
  /** A vendor destination id the owner has not reviewed. */
  UNAPPROVED_DESTINATION: "UNAPPROVED_DESTINATION",
  /** A destination named through a variable this audit cannot resolve to a literal. */
  UNRESOLVED_DESTINATION_REFERENCE: "UNRESOLVED_DESTINATION_REFERENCE",
  /** The export came from a container the owner did not approve. */
  CONTAINER_NOT_APPROVED: "CONTAINER_NOT_APPROVED",
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
  /** The reviewed `GTM-...` container. Binds the artifact to the container it must have come from. */
  gtmContainerId: string;
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

/**
 * Tag types whose delivery this audit has a reviewed parser for.
 *
 * A type earns a place here only when the type itself fixes the vendor, so the parameters that can
 * name a destination are bounded and readable from the export alone. Google's built-in tags qualify.
 *
 * A Custom HTML tag or a gallery template does not, and no parameter allowlist can rescue it: its
 * delivery lives in template or script code the export does not contain, so a production endpoint
 * can sit under any key — `html`, `code`, a template-defined name — or behind a variable reference,
 * with no recognised destination key anywhere on the tag. Certifying such a tag because it carries a
 * live guard would confuse *when* it fires with *where* it delivers. It is refused instead.
 *
 * The consequence is deliberate and worth stating: delivering TikTok through its gallery template
 * cannot be certified by this audit as written. Admitting it means adding a reviewed parser for that
 * exact template — a human review step, correctly gated — or delivering TikTok outside GTM. Neither
 * is decidable here while owner gate O4 is open, so the audit refuses rather than assumes.
 */
const REVIEWED_TAG_TYPES: ReadonlySet<string> = new Set([
  "gclidw", // Conversion Linker — first-party cookies only
  "gaawc", // GA4 Configuration, the legacy name for the Google tag
  "googtag", // Google tag
  "gaawe", // GA4 event
  "awct", // Google Ads Conversion Tracking
]);

/** Parameter keys that name a vendor destination, wherever they appear in a tag's parameters. */
const DESTINATION_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  "measurementId",
  "conversionId",
  "pixelId",
  "tagId",
]);

/**
 * Tag types that configure a Google destination and can therefore emit an automatic page view.
 *
 * `gaawc` is the legacy GA4 Configuration tag; `googtag` is the Google tag it became. Both are
 * listed because an export may predate the upgrade.
 */
const GOOGLE_CONFIGURATION_TAG_TYPES: ReadonlySet<string> = new Set(["gaawc", "googtag"]);

/** How the page-view toggle is spelled across the tag, its settings table and a settings variable. */
const PAGE_VIEW_KEYS: ReadonlySet<string> = new Set(["sendPageView", "send_page_view"]);

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

/**
 * Every `MAP` row inside a parameter tree, each row kept as its own key→value table.
 *
 * Row identity is the point. A settings table spells one setting as two cells — `parameter` naming
 * it and `parameterValue` holding its value — so a scan that flattens the tree into loose pairs can
 * pair the name from one row with the value from another. That is not a cosmetic loss: it lets a row
 * asserting `send_page_view = true` be "proved" false by an unrelated row that happens to say false.
 * Rows are therefore read as rows, and a claim is only ever read from the row that makes it.
 */
function collectMapRows(value: unknown, depth = 0): Array<ReadonlyMap<string, string>> {
  if (depth > MAX_PARAMETER_DEPTH) return [];
  const rows: Array<ReadonlyMap<string, string>> = [];
  if (Array.isArray(value)) {
    for (const entry of value) rows.push(...collectMapRows(entry, depth + 1));
  } else if (isRecord(value)) {
    if (Array.isArray(value.map)) {
      const row = new Map<string, string>();
      for (const cell of value.map) {
        if (!isRecord(cell)) continue;
        const key = readString(cell.key);
        const literal = readString(cell.value);
        if (key !== null && literal !== null) row.set(key, literal);
      }
      if (row.size > 0) rows.push(row);
    }
    for (const entry of Object.values(value)) rows.push(...collectMapRows(entry, depth + 1));
  }
  return rows;
}

/**
 * The container's variables, indexed by the name a `{{reference}}` uses.
 *
 * Only constant variables resolve to a literal. Anything computed — a JavaScript variable, a lookup
 * table, a data-layer read — cannot be evaluated statically, so it stays unresolved and any
 * destination that depends on it is refused rather than assumed approved.
 */
type VariableIndex = ReadonlyMap<string, Readonly<{ literal: string | null; source: unknown }>>;

const VARIABLE_REFERENCE = /^\{\{(.+)\}\}$/;
const EMBEDDED_VARIABLE_REFERENCE = /\{\{([^{}]+)\}\}/g;

/** The variable a value names outright. A destination id must *be* the reference, not contain one. */
function referencedVariableName(value: string): string | null {
  return VARIABLE_REFERENCE.exec(value.trim())?.[1]?.trim() ?? null;
}

/**
 * Every variable a value mentions, including references embedded in a larger string.
 *
 * A snippet reads `<script>{{Meta snippet}}</script>`, not `{{Meta snippet}}`, so a whole-string
 * match would follow none of the references that actually carry a payload.
 */
function embeddedVariableNames(value: string): string[] {
  return [...value.matchAll(EMBEDDED_VARIABLE_REFERENCE)].map((match) => match[1]!.trim());
}

function indexVariables(variables: readonly unknown[]): VariableIndex {
  const index = new Map<string, { literal: string | null; source: unknown }>();
  for (const candidate of variables) {
    if (!isRecord(candidate)) continue;
    const name = readString(candidate.name);
    if (name === null) continue;

    const parameters = readParameters(candidate.parameter);
    const rawValue = readString(candidate.type) === "c" ? parameterValue(parameters, "value") : null;
    // A constant whose value is itself a reference is not a literal this audit can stand behind.
    const literal = rawValue !== null && referencedVariableName(rawValue) === null ? rawValue : null;

    index.set(name, { literal, source: candidate });
  }
  return index;
}

/**
 * Every string the tag would deliver, following variable references transitively.
 *
 * A tag can hold nothing but `{{Meta snippet}}` and still ship a Meta pixel, because the snippet
 * lives in the variable. Scanning the tag object alone would read the reference and never the
 * payload, so the walk follows each reference into the variable it names. Visited names are
 * remembered: container variables may reference one another, and a cycle must not hang the audit.
 */
function payloadStrings(
  tag: Record<string, unknown>,
  variables: VariableIndex,
): Readonly<{ strings: string[]; truncated: boolean }> {
  const own = collectStrings(tag);
  const strings = [...own.strings];
  let truncated = own.truncated;

  const visited = new Set<string>();
  const pending = [...own.strings];
  while (pending.length > 0) {
    const value = pending.pop()!;
    for (const name of embeddedVariableNames(value)) {
      if (visited.has(name)) continue;
      visited.add(name);
      const variable = variables.get(name);
      if (variable === undefined) continue;
      const nested = collectStrings(variable.source);
      truncated ||= nested.truncated;
      strings.push(...nested.strings);
      pending.push(...nested.strings);
    }
  }

  return { strings, truncated };
}

function tagIsMeta(tag: Record<string, unknown>, variables: VariableIndex): boolean {
  const haystack = payloadStrings(tag, variables).strings.join(" ").toLowerCase();
  return META_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Every destination this tag would deliver to, resolved through the container's variables.
 *
 * A `{{reference}}` is followed rather than skipped. Skipping it was a fail-open: a live-guarded tag
 * could name `{{Production GA4 ID}}`, the literal would never appear on the tag, and the approval
 * check would have nothing to compare. A reference that cannot be resolved to a literal is reported
 * as unresolved so the artifact is refused instead of quietly certified.
 */
function destinationIds(
  tag: Record<string, unknown>,
  variables: VariableIndex,
): Readonly<{ resolved: string[]; unresolved: string[] }> {
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const [key, value] of collectKeyedValues(tag.parameter)) {
    if (!DESTINATION_PARAMETER_KEYS.has(key) || value.length === 0) continue;

    const reference = referencedVariableName(value);
    if (reference === null) {
      resolved.push(value);
      continue;
    }

    const literal = variables.get(reference)?.literal ?? null;
    if (literal === null) unresolved.push(reference);
    else resolved.push(literal);
  }

  return { resolved, unresolved };
}

/**
 * Whether this Google configuration tag positively proves it sends no page view.
 *
 * Positive proof is the requirement, not the absence of a contrary signal: the application owns the
 * canonical page view, and the toggle now lives inside configuration settings or a referenced
 * settings variable rather than on the tag. A tag whose settings this audit cannot read therefore
 * cannot be shown to be safe, and is refused.
 */
function provesPageViewsDisabled(tag: Record<string, unknown>, variables: VariableIndex): boolean {
  const sources: unknown[] = [tag.parameter];

  // Follow any settings variable the tag references, so its table is read as if it were inline.
  for (const value of collectStrings(tag.parameter).strings) {
    for (const name of embeddedVariableNames(value)) {
      const referenced = variables.get(name);
      if (referenced !== undefined) sources.push(referenced.source);
    }
  }

  // Every claim the artifact makes about the toggle, in either shape it can be written: a direct
  // key on the tag, or a `parameter`/`parameterValue` row of a settings table. Each claim is read
  // from the row that makes it, never assembled from cells of different rows.
  const claims: string[] = [];
  for (const source of sources) {
    for (const [key, value] of collectKeyedValues(source)) {
      if (PAGE_VIEW_KEYS.has(key)) claims.push(value);
    }
    for (const row of collectMapRows(source)) {
      const named = row.get("parameter");
      if (named === undefined || !PAGE_VIEW_KEYS.has(named)) continue;
      // A row naming the toggle but carrying no value proves nothing, and says so as an empty claim.
      claims.push(row.get("parameterValue") ?? "");
    }
  }

  // Proof, not the absence of a contrary signal: something must assert the toggle, and nothing may
  // contradict it. A tag that claims both `true` and `false` has not been shown to be safe.
  return claims.length > 0 && claims.every((value) => value === "false");
}

function isGoogleConfigurationTag(tag: Record<string, unknown>): boolean {
  return GOOGLE_CONFIGURATION_TAG_TYPES.has(readString(tag.type) ?? "");
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

  // Bind the artifact to the reviewed container. Without this, an export from a different container
  // that happened to reuse the same destination ids would certify just as cleanly.
  if (containerPublicId !== approved.gtmContainerId) {
    refuse(
      GTM_AUDIT_CODES.CONTAINER_NOT_APPROVED,
      "export does not come from the owner-approved GTM container",
    );
  }

  const variables = indexVariables(Array.isArray(version.variable) ? version.variable : []);

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

    if (payloadStrings(candidate, variables).truncated) {
      refuse(
        GTM_AUDIT_CODES.MALFORMED_EXPORT,
        `${label} nests parameters deeper than this audit will walk`,
      );
    }

    if (tagIsMeta(candidate, variables)) {
      refuse(
        GTM_AUDIT_CODES.META_TAG_PRESENT,
        `${label} looks like a Meta integration; Meta stays direct and must not enter GTM`,
      );
    }

    const type = readString(candidate.type) ?? "";

    // A live guard says when a tag fires, never where it delivers. For a type this audit has no
    // reviewed parser for, nothing in the export bounds the destination, so the guard cannot stand
    // in for one and the artifact is refused.
    if (!REVIEWED_TAG_TYPES.has(type)) {
      refuse(
        GTM_AUDIT_CODES.UNAUDITABLE_TAG_TYPE,
        `${label} has tag type "${type === "" ? "(none)" : type}", which this audit has no reviewed parser for`,
      );
    }

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

    if (isGoogleConfigurationTag(candidate) && !provesPageViewsDisabled(candidate, variables)) {
      refuse(
        GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW,
        `${label} does not prove page views are disabled; the application owns the canonical page view`,
      );
    }

    const destinations = destinationIds(candidate, variables);
    for (const id of destinations.resolved) {
      if (!approvedIds.has(id)) {
        refuse(
          GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
          `${label} delivers to an unreviewed destination id`,
        );
      }
    }
    for (const reference of destinations.unresolved) {
      refuse(
        GTM_AUDIT_CODES.UNRESOLVED_DESTINATION_REFERENCE,
        `${label} names its destination through "${reference}", which this audit cannot resolve to a reviewed literal`,
      );
    }
  }

  return Object.freeze({
    ok: findings.length === 0,
    findings: Object.freeze(findings),
    containerVersionId,
    containerPublicId,
  });
}
