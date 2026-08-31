/**
 * Campaign lifecycle, derived rather than stored.
 *
 * Admin-visible status is a function of persisted intent — whether the campaign is enabled, when it
 * was enabled and disabled, and its configured window — plus an explicit `now`. Nothing here is
 * written back.
 *
 * That matters for one specific failure the spec calls out: "ever active" must never be recorded by
 * a lazy observation write that only happens when some request sees the campaign running. A window
 * that opens and closes overnight with zero traffic would leave such a flag unset, and the campaign
 * would wrongly look re-enableable afterwards. Deriving it from the overlap of two intervals is
 * correct after a restart and correct with no traffic at all.
 *
 * Economic validity is not re-checked here. A Draft may legitimately be incomplete or
 * business-invalid at rest, and activation-time validation belongs to the admin service.
 */

import { COPY_NAME_SUFFIX, MAX_CAMPAIGN_NAME_LENGTH } from "./promotion-campaign-name.ts";

export type CampaignLifecycleStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "ENDED"
  | "DISABLED";

export type CampaignLifecycleFacts = Readonly<{
  isEnabled: boolean;
  enabledAt: Date | null;
  disabledAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  now: Date;
}>;

export type CampaignLifecycle = Readonly<{
  status: CampaignLifecycleStatus;
  /** Whether the enabled interval has ever overlapped the configured active window. */
  everActive: boolean;
  /** Only a never-active disabled campaign may be re-enabled; anything else copies to a new Draft. */
  canReEnable: boolean;
  /** Terminal states are read-only except for Copy. */
  isTerminal: boolean;
  /** The next instant this status could change, for scheduling a refresh. */
  nextTransitionAt: Date | null;
}>;

const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;
const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;

function instant(value: Date | null, whenNull: number): number {
  return value === null ? whenNull : value.getTime();
}

/**
 * Both intervals are half-open, so touching endpoints do not overlap: a campaign disabled at the
 * exact instant its window opens never ran.
 */
function intervalsOverlap(
  [startA, endA]: readonly [number, number],
  [startB, endB]: readonly [number, number],
): boolean {
  return startA < endB && startB < endA;
}

function deriveEverActive(facts: CampaignLifecycleFacts): boolean {
  if (facts.enabledAt === null) return false;

  const enabledInterval = [
    facts.enabledAt.getTime(),
    // Still enabled means the interval runs up to now; only elapsed time can have been active.
    facts.isEnabled ? facts.now.getTime() : instant(facts.disabledAt, facts.now.getTime()),
  ] as const;
  const window = [
    instant(facts.startsAt, NEGATIVE_INFINITY),
    Math.min(instant(facts.endsAt, POSITIVE_INFINITY), facts.now.getTime()),
  ] as const;

  return intervalsOverlap(enabledInterval, window);
}

function deriveNextTransition(facts: CampaignLifecycleFacts): Date | null {
  const now = facts.now.getTime();
  for (const boundary of [facts.startsAt, facts.endsAt]) {
    if (boundary !== null && boundary.getTime() > now) return boundary;
  }
  return null;
}

export function deriveCampaignLifecycle(facts: CampaignLifecycleFacts): CampaignLifecycle {
  const everActive = deriveEverActive(facts);
  const nextTransitionAt = deriveNextTransition(facts);

  if (!facts.isEnabled) {
    // Never enabled at all is Draft; enabled once and then switched off is Disabled. Keeping those
    // apart is what decides whether re-enable or Copy is the legal next move.
    const status: CampaignLifecycleStatus = facts.enabledAt === null ? "DRAFT" : "DISABLED";
    return Object.freeze({
      status,
      everActive,
      canReEnable: status === "DISABLED" && !everActive,
      isTerminal: status === "DISABLED" && everActive,
      nextTransitionAt: status === "DRAFT" ? nextTransitionAt : null,
    });
  }

  const now = facts.now.getTime();
  if (facts.startsAt !== null && now < facts.startsAt.getTime()) {
    return Object.freeze({
      status: "SCHEDULED" as const,
      everActive,
      canReEnable: false,
      isTerminal: false,
      nextTransitionAt,
    });
  }

  if (facts.endsAt !== null && now >= facts.endsAt.getTime()) {
    // A campaign enabled only after its window closed reaches here with `everActive: false`. It is
    // over either way, so it reads as Ended; the `everActive` fact is what distinguishes the two.
    return Object.freeze({
      status: "ENDED" as const,
      everActive,
      canReEnable: false,
      isTerminal: true,
      nextTransitionAt: null,
    });
  }

  return Object.freeze({
    status: "ACTIVE" as const,
    everActive,
    canReEnable: false,
    isTerminal: false,
    nextTransitionAt,
  });
}

/** True when cutting a string here would leave half of a surrogate pair behind. */
function splitsSurrogatePair(value: string, index: number): boolean {
  const code = value.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Copy naming.
 *
 * The suffix always survives, because it is what tells an admin which record they are looking at;
 * the source name is what gets shortened. Truncation never splits a surrogate pair and never leaves
 * a trailing space in front of the suffix, so repeated copies stay storable and deterministic.
 */
export function buildCopyCampaignName(sourceName: string): string {
  const source = sourceName.trim();
  const available = MAX_CAMPAIGN_NAME_LENGTH - COPY_NAME_SUFFIX.length;

  if (source.length <= available) return `${source}${COPY_NAME_SUFFIX}`;

  let cut = available;
  if (splitsSurrogatePair(source, cut)) cut -= 1;

  return `${source.slice(0, cut).trimEnd()}${COPY_NAME_SUFFIX}`;
}
