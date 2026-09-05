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
 * be fetched in the environment this was written in, so the parser is pinned to the one export
 * format it was written against, refuses malformed shapes, and refuses a tag whose type it has no
 * reviewed parser for rather than certifying it on its firing guard. A live guard says *when* a tag
 * fires, never *where* it delivers; for a Custom HTML tag or a gallery template the delivery lives
 * in code the export does not even contain. A schema surprise therefore becomes a loud failure,
 * never a silently passing check.
 *
 * **It keeps vendor identity all the way through.** Approval is checked field by field against the
 * vendor that field belongs to, and a Google Ads conversion is approved as a whole `(id, label)`
 * pair. Flattening the approved ids into one set would prove only that a literal appears somewhere
 * among them — not that a GA4 field names a GA4 property, or that a reviewed Ads account is
 * reporting a reviewed conversion action.
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
  /** The export declares a format version this parser was not written against. */
  UNSUPPORTED_EXPORT_FORMAT: "UNSUPPORTED_EXPORT_FORMAT",
  /** A mutable workspace export, or one naming no saved version. */
  NOT_A_SAVED_VERSION: "NOT_A_SAVED_VERSION",
  /** A tag that can fire without `la_tracking_mode == live`. */
  TAG_WITHOUT_LIVE_GUARD: "TAG_WITHOUT_LIVE_GUARD",
  /** A tag type whose delivery this audit has no reviewed parser for. */
  UNAUDITABLE_TAG_TYPE: "UNAUDITABLE_TAG_TYPE",
  /** The mode variable the guards name is not a data-layer read of the application-owned fact. */
  TRACKING_MODE_VARIABLE_NOT_APP_OWNED: "TRACKING_MODE_VARIABLE_NOT_APP_OWNED",
  /** Tag sequencing gives a delivering tag a firing path this audit cannot account for. */
  TAG_SEQUENCING_NOT_AUDITABLE: "TAG_SEQUENCING_NOT_AUDITABLE",
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
  /**
   * Reviewed Google Ads conversions, as whole `(id, label)` pairs.
   *
   * The label is what names the conversion action; the id alone only names the account. Approving
   * the two separately would let a tag pair an approved id with the label of a conversion nobody
   * reviewed, so they are approved together and must match together.
   */
  googleAdsConversions: readonly Readonly<{ conversionId: string; conversionLabel: string }>[];
  tiktokPixelIds: readonly string[];
}>;

export type GtmAuditResult = Readonly<{
  ok: boolean;
  findings: readonly GtmAuditFinding[];
  containerVersionId: string | null;
  containerPublicId: string | null;
}>;

/** The container export format this parser was written against. */
const SUPPORTED_EXPORT_FORMAT_VERSION = 2;

/** The application-owned dataLayer fact every production tag must be gated on. */
const TRACKING_MODE_VARIABLE = "la_tracking_mode";
const LIVE_MODE = "live";

/**
 * The GTM variable type that reads a value out of the dataLayer.
 *
 * The guard is only worth anything if the thing it reads is the fact the application pushes. A
 * variable merely *named* `la_tracking_mode` proves nothing: a Constant (`c`) or a Custom
 * JavaScript variable (`jsm`) of that name could return `live` unconditionally, and then every
 * production tag would satisfy the static check while preview sessions saw `live` too and shipped
 * real traffic. Preview isolation has to be mechanical, so the variable type is checked, not the
 * name.
 */
const DATA_LAYER_VARIABLE_TYPE = "v";

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
 * cannot be certified by this audit as written. Under the locked v1 contract — plan §3.7, *TikTok
 * Pixel runs through GTM* — the only path that admits it is a reviewed parser for that exact
 * template, a human review step this audit deliberately leaves to a person. Delivering TikTok
 * outside GTM is not an alternative available here: that is an architecture change needing its own
 * approved amendment, not something this gate may open by loosening.
 */
const REVIEWED_TAG_TYPES: ReadonlySet<string> = new Set([
  "gclidw", // Conversion Linker — first-party cookies only
  "gaawc", // GA4 Configuration, the legacy name for the Google tag
  "googtag", // Google tag
  "gaawe", // GA4 event
  "awct", // Google Ads Conversion Tracking
]);

/**
 * Parameter keys that name a vendor destination, grouped by the vendor whose namespace they belong
 * to.
 *
 * The grouping is the point. Checking every id against one flat union proves only that a literal
 * appears somewhere in the approved set — not that a GA4 field names a GA4 property or that an Ads
 * field names an Ads conversion. A tag pairing an approved TikTok pixel id with a GA4 parameter
 * would satisfy a union and satisfies nothing here.
 */
const GA4_DESTINATION_KEYS: readonly string[] = ["measurementId", "measurementIdOverride", "tagId"];
const ADS_CONVERSION_ID_KEY = "conversionId";
const ADS_CONVERSION_LABEL_KEY = "conversionLabel";
const TIKTOK_DESTINATION_KEYS: readonly string[] = ["pixelId"];

const ALL_DESTINATION_KEYS: ReadonlySet<string> = new Set([
  ...GA4_DESTINATION_KEYS,
  ADS_CONVERSION_ID_KEY,
  ADS_CONVERSION_LABEL_KEY,
  ...TIKTOK_DESTINATION_KEYS,
]);

/** Which vendor's destination fields each reviewed tag type is allowed to carry. */
const GA4_TAG_TYPES: ReadonlySet<string> = new Set(["gaawc", "googtag", "gaawe"]);
const ADS_TAG_TYPES: ReadonlySet<string> = new Set(["awct"]);

/**
 * Parameter keys that carry a Google tag's configuration settings.
 *
 * Only these are followed when looking for the page-view toggle. Following every reference on the
 * tag was a fail-open: an unrelated variable that happened to hold `send_page_view = false` proved
 * the toggle off for a tag that never wired it as configuration settings at all.
 */
const CONFIGURATION_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "configSettingsTable",
  "configSettingsVariable",
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
 * Whether the container's `la_tracking_mode` variable really is the application's dataLayer fact.
 *
 * This is what makes every firing guard mean anything. The guards name a variable; without this,
 * naming is all they prove. The variable must exist exactly once, be a Data Layer Variable, and
 * read exactly the `la_tracking_mode` key — anything else, including a Constant or a computed
 * variable that happens to return `live`, would let preview sessions satisfy the same guard as
 * production.
 */
function trackingModeVariableIsAppOwned(variables: VariableIndex): boolean {
  const variable = variables.get(TRACKING_MODE_VARIABLE);
  if (variable === undefined || variable.duplicated) return false;
  if (!isRecord(variable.source)) return false;
  if (readString(variable.source.type) !== DATA_LAYER_VARIABLE_TYPE) return false;

  // A Data Layer Variable names the key it reads in its `name` parameter, which need not match the
  // variable's own name.
  const dataLayerKey = parameterValue(readParameters(variable.source.parameter), "name");
  return dataLayerKey === TRACKING_MODE_VARIABLE;
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
type VariableIndex = ReadonlyMap<
  string,
  Readonly<{ literal: string | null; source: unknown; duplicated: boolean }>
>;

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
  const index = new Map<string, { literal: string | null; source: unknown; duplicated: boolean }>();
  for (const candidate of variables) {
    if (!isRecord(candidate)) continue;
    const name = readString(candidate.name);
    if (name === null) continue;

    const parameters = readParameters(candidate.parameter);
    const rawValue = readString(candidate.type) === "c" ? parameterValue(parameters, "value") : null;
    // A constant whose value is itself a reference is not a literal this audit can stand behind.
    const literal = rawValue !== null && referencedVariableName(rawValue) === null ? rawValue : null;

    // Two definitions of one name leave the audit reading whichever it saw last, which is not the
    // one a reviewer looked at. The duplicate is remembered so it can be refused instead.
    index.set(name, { literal, source: candidate, duplicated: index.has(name) });
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
 * The literals a given destination key carries on this tag, resolved through the container's
 * variables.
 *
 * A `{{reference}}` is followed rather than skipped. Skipping it was a fail-open: a live-guarded tag
 * could name `{{Production GA4 ID}}`, the literal would never appear on the tag, and the approval
 * check would have nothing to compare. A reference that cannot be resolved to a literal is reported
 * as unresolved so the artifact is refused instead of quietly certified.
 */
function destinationValues(
  tag: Record<string, unknown>,
  key: string,
  variables: VariableIndex,
): Readonly<{ resolved: string[]; unresolved: string[] }> {
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const [candidateKey, value] of collectKeyedValues(tag.parameter)) {
    if (candidateKey !== key || value.length === 0) continue;

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

/** Every destination key this tag actually carries, whatever vendor it belongs to. */
function destinationKeysPresent(tag: Record<string, unknown>): Set<string> {
  const present = new Set<string>();
  for (const [key, value] of collectKeyedValues(tag.parameter)) {
    if (ALL_DESTINATION_KEYS.has(key) && value.length > 0) present.add(key);
  }
  return present;
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
  const parameters = readParameters(tag.parameter);
  const claims: string[] = [];

  // The legacy direct toggle, read only from the tag's own top-level parameters.
  for (const parameter of parameters) {
    const key = readString(parameter.key);
    if (key !== null && PAGE_VIEW_KEYS.has(key)) claims.push(readString(parameter.value) ?? "");
  }

  // Configuration settings: the inline table, and the variable the tag names as its settings
  // carrier. Nothing else is followed, so an unrelated variable that happens to hold the toggle
  // cannot answer for a tag that never wired it.
  for (const parameter of parameters) {
    const key = readString(parameter.key);
    if (key === null || !CONFIGURATION_SETTINGS_KEYS.has(key)) continue;

    const settings: unknown[] = [parameter];
    const named = readString(parameter.value);
    const reference = named === null ? null : referencedVariableName(named);
    const carrier = reference === null ? undefined : variables.get(reference);
    if (carrier !== undefined) settings.push(carrier.source);

    for (const source of settings) {
      for (const row of collectMapRows(source)) {
        // The settings table spells one setting as two cells, `parameter` naming it and
        // `parameterValue` holding its value. A row naming the toggle and then saying nothing about
        // it is an open question, and says so as an empty claim.
        const setting = row.get("parameter");
        if (setting !== undefined && PAGE_VIEW_KEYS.has(setting)) {
          claims.push(row.get("parameterValue") ?? "");
        }
        // Some shapes spell the same row as a direct key instead.
        for (const spelling of PAGE_VIEW_KEYS) {
          const direct = row.get(spelling);
          if (direct !== undefined) claims.push(direct);
        }
      }
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

  const approvedGa4 = new Set(approved.ga4MeasurementIds);
  const approvedTiktok = new Set(approved.tiktokPixelIds);
  const approvedAdsPairs = new Set(
    approved.googleAdsConversions.map((pair) => `${pair.conversionId}\u0000${pair.conversionLabel}`),
  );
  const approvedAdsIds = new Set(approved.googleAdsConversions.map((pair) => pair.conversionId));

  if (approvedGa4.size + approvedAdsPairs.size + approvedTiktok.size === 0) {
    // Owner gate O4. Passing here would certify a container against no reviewed destination at all.
    refuse(
      GTM_AUDIT_CODES.NO_APPROVED_DESTINATIONS,
      "no reviewed vendor destination ids were supplied (owner gate O4)",
    );
  }

  // The parser was written against one export format. A different one may spell the same fields
  // differently, so it is refused rather than read hopefully.
  const declaredFormat = isRecord(source) ? source.exportFormatVersion : undefined;
  if (declaredFormat !== SUPPORTED_EXPORT_FORMAT_VERSION) {
    refuse(
      GTM_AUDIT_CODES.UNSUPPORTED_EXPORT_FORMAT,
      `export declares format version ${JSON.stringify(declaredFormat) ?? "none"}; this audit reads only version ${SUPPORTED_EXPORT_FORMAT_VERSION}`,
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

  // An unreadable variable list is not an empty one: every reference would resolve to nothing and
  // the artifact would look cleaner than it is.
  if (version.variable !== undefined && !Array.isArray(version.variable)) {
    refuse(GTM_AUDIT_CODES.MALFORMED_EXPORT, "containerVersion.variable is not an array");
  }
  const variables = indexVariables(Array.isArray(version.variable) ? version.variable : []);

  // A workspace export carries no saved version, and "0" is the placeholder an unsaved export uses.
  if (containerVersionId === null || containerVersionId === "" || containerVersionId === "0") {
    refuse(
      GTM_AUDIT_CODES.NOT_A_SAVED_VERSION,
      "export names no saved container version; a mutable workspace export may not be published",
    );
  }

  // The guards name a variable; whether that variable is the application's fact is a property of the
  // container, checked once. If it is not, no trigger in this container can carry a guard, so the
  // guarded set is emptied rather than left to certify tags on a name match.
  const modeVariableIsAppOwned = trackingModeVariableIsAppOwned(variables);
  if (!modeVariableIsAppOwned) {
    refuse(
      GTM_AUDIT_CODES.TRACKING_MODE_VARIABLE_NOT_APP_OWNED,
      `${TRACKING_MODE_VARIABLE} is not a single Data Layer Variable reading the ${TRACKING_MODE_VARIABLE} key, so no firing guard built on it can be trusted`,
    );
  }

  // Tag sequencing is a firing path that never passes through a tag's own firingTriggerId: a setup
  // tag runs before its primary and a cleanup tag after it. A delivering tag on either end of such
  // an edge can therefore execute without its own live trigger ever being evaluated. This audit does
  // not model that graph — the export format was never read from primary documentation — so it
  // refuses delivering tags that take part in sequencing rather than guessing at the semantics.
  const sequencedTagNames = new Set<string>();
  for (const candidate of tags) {
    if (!isRecord(candidate)) continue;
    for (const key of ["setupTag", "teardownTag"]) {
      const edges = candidate[key];
      if (!Array.isArray(edges)) continue;
      for (const edge of edges) {
        if (!isRecord(edge)) continue;
        const named = readString(edge.tagName);
        if (named !== null) sequencedTagNames.add(named);
      }
    }
  }

  const guardedTriggerIds = modeVariableIsAppOwned ? new Set(
    triggers
      .filter(isRecord)
      .filter(triggerCarriesLiveGuard)
      .map((trigger) => readString(trigger.triggerId))
      .filter((id): id is string => id !== null),
  ) : new Set<string>();

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
      const declaresSequencing = ["setupTag", "teardownTag"].some(
        (key) => Array.isArray(candidate[key]) && (candidate[key] as unknown[]).length > 0,
      );
      const isSequenced = sequencedTagNames.has(readString(candidate.name) ?? "\u0000");
      if (declaresSequencing || isSequenced) {
        refuse(
          GTM_AUDIT_CODES.TAG_SEQUENCING_NOT_AUDITABLE,
          `${label} takes part in tag sequencing, which can fire it without its own trigger being evaluated`,
        );
      }

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

    // Which destination fields this tag type is entitled to carry. A field outside that set is a
    // vendor it was never meant to reach, so it is refused rather than checked against a union that
    // would happily accept another vendor's approved id.
    const allowedKeys = new Set<string>(
      GA4_TAG_TYPES.has(type)
        ? GA4_DESTINATION_KEYS
        : ADS_TAG_TYPES.has(type)
          ? [ADS_CONVERSION_ID_KEY, ADS_CONVERSION_LABEL_KEY]
          : [],
    );
    for (const key of destinationKeysPresent(candidate)) {
      if (!allowedKeys.has(key)) {
        refuse(
          GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
          `${label} carries the destination field "${key}", which its tag type does not deliver through`,
        );
      }
    }

    const unresolved = new Set<string>();
    const readKey = (key: string) => {
      const values = destinationValues(candidate, key, variables);
      for (const reference of values.unresolved) unresolved.add(reference);
      return values.resolved;
    };

    if (GA4_TAG_TYPES.has(type)) {
      for (const key of GA4_DESTINATION_KEYS) {
        for (const id of readKey(key)) {
          if (!approvedGa4.has(id)) {
            refuse(
              GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
              `${label} names a GA4 destination the owner has not reviewed`,
            );
          }
        }
      }
    }

    if (ADS_TAG_TYPES.has(type)) {
      // The id names the account; the label names the conversion action. Approving them separately
      // would let an approved id carry the label of a conversion nobody reviewed, so the pair is
      // what must match — and a conversion that names no label proves nothing about which action it
      // reports.
      const conversionIds = readKey(ADS_CONVERSION_ID_KEY);
      const conversionLabels = readKey(ADS_CONVERSION_LABEL_KEY);

      if (conversionIds.length === 0 || conversionLabels.length === 0) {
        refuse(
          GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
          `${label} does not name both a conversion id and a conversion label, so the conversion action it reports cannot be checked`,
        );
      }

      for (const conversionId of conversionIds) {
        for (const conversionLabel of conversionLabels) {
          if (!approvedAdsPairs.has(`${conversionId}\u0000${conversionLabel}`)) {
            refuse(
              GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
              approvedAdsIds.has(conversionId)
                ? `${label} pairs a reviewed conversion id with a conversion label the owner has not reviewed`
                : `${label} names a Google Ads conversion the owner has not reviewed`,
            );
          }
        }
      }
    }

    for (const key of TIKTOK_DESTINATION_KEYS) {
      for (const id of readKey(key)) {
        if (!approvedTiktok.has(id)) {
          refuse(
            GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
            `${label} names a TikTok destination the owner has not reviewed`,
          );
        }
      }
    }

    for (const reference of unresolved) {
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
