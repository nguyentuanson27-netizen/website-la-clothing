import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCopyCampaignName,
  deriveCampaignLifecycle,
  type CampaignLifecycleFacts,
} from "../../src/commerce/promotion-campaign-lifecycle.ts";
import { MAX_CAMPAIGN_NAME_LENGTH } from "../../src/commerce/promotion-campaign-name.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const PAST = new Date("2026-09-01T00:00:00.000Z");
const FUTURE = new Date("2026-10-01T00:00:00.000Z");

function facts(overrides: Partial<CampaignLifecycleFacts> = {}): CampaignLifecycleFacts {
  return {
    isEnabled: false,
    enabledAt: null,
    disabledAt: null,
    startsAt: null,
    endsAt: null,
    now: NOW,
    ...overrides,
  };
}

test("P3 a campaign that was never enabled is a Draft, not a Disabled one", () => {
  const lifecycle = deriveCampaignLifecycle(facts());

  assert.equal(lifecycle.status, "DRAFT");
  assert.equal(lifecycle.everActive, false);
  assert.equal(lifecycle.isTerminal, false);
});

test("P3 an enabled open-ended campaign is Active", () => {
  const lifecycle = deriveCampaignLifecycle(
    facts({ isEnabled: true, enabledAt: PAST, startsAt: null, endsAt: null }),
  );

  assert.equal(lifecycle.status, "ACTIVE");
  assert.equal(lifecycle.everActive, true);
  assert.equal(lifecycle.nextTransitionAt, null);
});

test("P3 an enabled campaign whose window has not opened is Scheduled", () => {
  const lifecycle = deriveCampaignLifecycle(
    facts({ isEnabled: true, enabledAt: PAST, startsAt: FUTURE, endsAt: null }),
  );

  assert.equal(lifecycle.status, "SCHEDULED");
  assert.equal(lifecycle.everActive, false);
  assert.deepEqual(lifecycle.nextTransitionAt, FUTURE);
});

test("P3 the active window is half-open at both ends", () => {
  const startsAt = new Date("2026-09-15T00:00:00.000Z");
  const endsAt = new Date("2026-09-16T00:00:00.000Z");
  const enabled = { isEnabled: true, enabledAt: PAST, startsAt, endsAt } as const;

  assert.equal(deriveCampaignLifecycle(facts({ ...enabled, now: startsAt })).status, "ACTIVE");
  assert.equal(
    deriveCampaignLifecycle(facts({ ...enabled, now: new Date(startsAt.getTime() - 1) })).status,
    "SCHEDULED",
  );
  assert.equal(
    deriveCampaignLifecycle(facts({ ...enabled, now: new Date(endsAt.getTime() - 1) })).status,
    "ACTIVE",
  );
  assert.equal(deriveCampaignLifecycle(facts({ ...enabled, now: endsAt })).status, "ENDED");
});

/**
 * The zero-traffic requirement: nothing observes the campaign while its window opens and closes, so
 * the status has to be derivable from persisted intent alone.
 */
test("P3 a window that opened and closed with zero traffic still reads as Ended and ever-active", () => {
  const lifecycle = deriveCampaignLifecycle(
    facts({
      isEnabled: true,
      enabledAt: new Date("2026-08-01T00:00:00.000Z"),
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-02T00:00:00.000Z"),
    }),
  );

  assert.equal(lifecycle.status, "ENDED");
  assert.equal(lifecycle.everActive, true, "no observation write is needed to know it ran");
  assert.equal(lifecycle.isTerminal, true);
});

test("P3 the same facts give the same status after a restart", () => {
  const input = facts({ isEnabled: true, enabledAt: PAST, startsAt: PAST, endsAt: FUTURE });

  assert.deepEqual(deriveCampaignLifecycle(input), deriveCampaignLifecycle({ ...input }));
});

test("P3 a campaign disabled before it was ever active can be re-enabled", () => {
  const lifecycle = deriveCampaignLifecycle(
    facts({
      isEnabled: false,
      enabledAt: new Date("2026-09-10T00:00:00.000Z"),
      disabledAt: new Date("2026-09-11T00:00:00.000Z"),
      // The window opens after it was already disabled, so it never ran.
      startsAt: FUTURE,
      endsAt: null,
    }),
  );

  assert.equal(lifecycle.status, "DISABLED");
  assert.equal(lifecycle.everActive, false);
  assert.equal(lifecycle.canReEnable, true);
  assert.equal(lifecycle.isTerminal, false);
});

test("P3 a campaign disabled after it was active is terminal and cannot be re-enabled", () => {
  const lifecycle = deriveCampaignLifecycle(
    facts({
      isEnabled: false,
      enabledAt: PAST,
      disabledAt: new Date("2026-09-10T00:00:00.000Z"),
      startsAt: PAST,
      endsAt: FUTURE,
    }),
  );

  assert.equal(lifecycle.status, "DISABLED");
  assert.equal(lifecycle.everActive, true, "its enabled interval overlapped its window");
  assert.equal(lifecycle.canReEnable, false);
  assert.equal(lifecycle.isTerminal, true);
});

test("P3 ever-active is the overlap of the enabled interval and the configured window", () => {
  // Enabled only after the window had already closed: it never ran.
  const enabledTooLate = deriveCampaignLifecycle(
    facts({
      isEnabled: false,
      enabledAt: new Date("2026-09-10T00:00:00.000Z"),
      disabledAt: new Date("2026-09-12T00:00:00.000Z"),
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-05T00:00:00.000Z"),
    }),
  );
  assert.equal(enabledTooLate.everActive, false);
  assert.equal(enabledTooLate.canReEnable, true);

  // Enabled and disabled entirely inside the window: it ran.
  const enabledInside = deriveCampaignLifecycle(
    facts({
      isEnabled: false,
      enabledAt: new Date("2026-09-02T00:00:00.000Z"),
      disabledAt: new Date("2026-09-03T00:00:00.000Z"),
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-05T00:00:00.000Z"),
    }),
  );
  assert.equal(enabledInside.everActive, true);
  assert.equal(enabledInside.canReEnable, false);
});

test("P3 an enabled interval that only touches the window boundary never ran", () => {
  // Disabled exactly at the instant the window opens: the half-open overlap is empty.
  const lifecycle = deriveCampaignLifecycle(
    facts({
      isEnabled: false,
      enabledAt: new Date("2026-09-01T00:00:00.000Z"),
      disabledAt: new Date("2026-09-05T00:00:00.000Z"),
      startsAt: new Date("2026-09-05T00:00:00.000Z"),
      endsAt: FUTURE,
    }),
  );

  assert.equal(lifecycle.everActive, false);
  assert.equal(lifecycle.canReEnable, true);
});

test("P3 Copy appends the reviewed suffix and stays inside the name bound", () => {
  assert.equal(buildCopyCampaignName("Flash Sale tháng 9"), "Flash Sale tháng 9 - Bản sao");
  assert.equal(buildCopyCampaignName("  Flash Sale  "), "Flash Sale - Bản sao");
});

test("P3 Copy of a name at the bound truncates the source rather than overflowing", () => {
  const atBound = "a".repeat(MAX_CAMPAIGN_NAME_LENGTH);
  const copied = buildCopyCampaignName(atBound);

  assert.equal(copied.length, MAX_CAMPAIGN_NAME_LENGTH);
  assert.ok(copied.endsWith(" - Bản sao"));
  assert.equal(copied.trim(), copied, "no trailing space is left before the suffix");
});

test("P3 Copy at 119 and 120 code units both stay valid and deterministic", () => {
  for (const length of [119, MAX_CAMPAIGN_NAME_LENGTH]) {
    const copied = buildCopyCampaignName("a".repeat(length));
    assert.ok(copied.length <= MAX_CAMPAIGN_NAME_LENGTH, `${length} must not overflow`);
    assert.equal(copied, buildCopyCampaignName("a".repeat(length)), "deterministic");
  }
});

test("P3 Copy never splits a surrogate pair when it truncates", () => {
  const nonBmp = "\u{1D49C}";
  // The leading ASCII character puts the pairs on odd offsets, so the truncation point lands
  // *inside* a pair. Without the guard this leaves a lone high surrogate behind.
  const source = `a${nonBmp.repeat(60)}`;
  const copied = buildCopyCampaignName(source);

  assert.ok(copied.length <= MAX_CAMPAIGN_NAME_LENGTH);
  assert.ok(copied.endsWith(" - B\u1ea3n sao"));
  assert.equal(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(copied),
    false,
    "no lone surrogate survives truncation",
  );
});

test("P3 Copy of a Copy still produces a storable name", () => {
  let name = "Flash Sale tháng 9";
  for (let round = 0; round < 20; round += 1) {
    name = buildCopyCampaignName(name);
    assert.ok(name.length <= MAX_CAMPAIGN_NAME_LENGTH, `round ${round} must stay inside the bound`);
    assert.ok(name.endsWith(" - Bản sao"));
  }
});
