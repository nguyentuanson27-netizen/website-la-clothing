import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROMOTION_ACTIVATION_OPERATIONS } from "../../src/operations/promotion-observability.ts";

function sourceOf(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const actionsSource = sourceOf("../../src/app/admin/promotions/actions.ts");
const funnelSource = sourceOf("../../src/operations/promotion-admin-operation.ts");
const serviceSource = sourceOf("../../src/commerce/promotion-activation-service.ts");

function exportedActionSource(name: string): string {
  const marker = `export async function ${name}`;
  const start = actionsSource.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = actionsSource.indexOf("\nexport async function ", start + marker.length);
  return actionsSource.slice(start, next === -1 ? actionsSource.length : next);
}

test("P5b create/edit parsers stay behind the Server Action admin authorization boundary", () => {
  // The order lives in the funnel now, so the property is asserted where it is executed rather
  // than where it used to be written.
  const authorizeAt = funnelSource.indexOf("session = await authorize();");
  const runAt = funnelSource.indexOf("const outcome = await run(session, context);");
  assert.ok(authorizeAt >= 0, "the shared mutation funnel must authorize before anything else");
  assert.ok(
    runAt > authorizeAt,
    "the mutation callback must not run until authorize() has resolved",
  );

  // And the wiring that makes that authorization the real admin check.
  assert.match(actionsSource, /authorize: \(\) => requireCurrentAdmin\(\),/);
  assert.match(actionsSource, /run: operation,/);

  for (const name of ["createPromotionAction", "editPromotionAction"] as const) {
    const source = exportedActionSource(name);
    assert.match(
      source,
      // The leading argument is the observability operation label. It is matched as a literal so a
      // request-derived value here would fail this assertion rather than ride along unnoticed.
      /runPromotionOperation\(\s*"[a-z-]+",\s*(?:async )?\(session(?:, context)?\) => \{\s*const parseResult = parseCampaignFormInput\(formData\);/,
      `${name} must parse FormData inside the authorized callback, never before it`,
    );
  }
});

/**
 * Each action, the operation label it reports under, and the service call that label describes.
 *
 * A label is the only part of a signal that is chosen rather than derived, so a copy-paste that
 * leaves `"publish"` on the disable action would silently misattribute every refusal it emits.
 * Pinning the label against the service function the action actually calls is what makes that a
 * test failure instead of a plausible-looking log line.
 */
const ACTION_CONTRACT = {
  publishPromotionAction: { operation: "publish", service: "publishPromotionCampaign" },
  disablePromotionAction: { operation: "disable", service: "disablePromotionCampaign" },
  endPromotionEarlyAction: { operation: "end-early", service: "endPromotionCampaignEarly" },
  copyPromotionAction: { operation: "copy", service: "copyPromotionCampaign" },
  createPromotionAction: { operation: "create", service: "createDraftPromotionCampaign" },
  editPromotionAction: { operation: "edit", service: "editDraftPromotionCampaign" },
} as const;

test("every promotion action reports under its own operation label", () => {
  for (const [action, { operation, service }] of Object.entries(ACTION_CONTRACT)) {
    const source = exportedActionSource(action);

    const labels = [...source.matchAll(/runPromotionOperation\(\s*"([a-z-]+)"/g)].map(
      (match) => match[1],
    );

    assert.deepEqual(
      labels,
      [operation],
      `${action} must report as "${operation}" and nothing else`,
    );
    assert.ok(source.includes(`${service}(`), `${action} must call ${service}`);
  }

  assert.deepEqual(
    new Set(Object.values(ACTION_CONTRACT).map((entry) => entry.operation)),
    new Set(PROMOTION_ACTIVATION_OPERATIONS),
    "every operation in the closed vocabulary must be produced by exactly one action",
  );
});

/**
 * The gate signal is reported by the branch that is about to enter a gate-governed code path, not
 * inferred from the action label, because `edit` reaches `editScheduledPromotionCampaign` only for
 * a Scheduled campaign — a Draft edit, a malformed input or a missing campaign never consults the
 * gate. That placement is a property of the action file, which a test cannot import, so it is
 * pinned here: every call to a service function that reads the gate must be preceded by a report,
 * and there must be no report that is not guarding one.
 */
function gateReadingServiceFunctions(): ReadonlySet<string> {
  const reading = new Set<string>();

  for (const match of serviceSource.matchAll(/export async function (\w+)\(/g)) {
    const start = match.index ?? 0;
    const next = serviceSource.indexOf("\nexport async function ", start + 1);
    const body = serviceSource.slice(start, next === -1 ? serviceSource.length : next);
    if (body.includes("isPromotionActivationEnabled(env)")) reading.add(match[1]);
  }

  return reading;
}

test("the activation gate is reported by exactly the branches that reach it", () => {
  const gateReading = gateReadingServiceFunctions();

  assert.deepEqual(
    gateReading,
    new Set(["publishPromotionCampaign", "editScheduledPromotionCampaign"]),
    "a service function that newly reads the gate needs a report at its call site",
  );

  let guardedCallSites = 0;

  for (const name of gateReading) {
    const callSites = [...actionsSource.matchAll(new RegExp(`${name}\\(`, "g"))];
    assert.ok(callSites.length > 0, `${name} must be called from an action`);

    for (const callSite of callSites) {
      const before = actionsSource.slice(0, callSite.index ?? 0);
      const reportedAt = before.lastIndexOf("context.reportActivationGate();");
      const previousCall = before.lastIndexOf(`${name}(`);
      assert.ok(
        reportedAt > previousCall,
        `${name} must be reached only after context.reportActivationGate()`,
      );
      guardedCallSites += 1;
    }
  }

  // The other direction: no branch reports gate state without entering a gate-governed path.
  assert.equal(
    [...actionsSource.matchAll(/context\.reportActivationGate\(\);/g)].length,
    guardedCallSites,
    "every gate report must guard a call into a gate-reading service function",
  );
});

// Ungated operations must not claim the gate had a bearing on them.
test("the ungated promotion operations never report gate state", () => {
  for (const action of [
    "disablePromotionAction",
    "endPromotionEarlyAction",
    "copyPromotionAction",
    "createPromotionAction",
  ] as const) {
    assert.ok(
      !exportedActionSource(action).includes("reportActivationGate"),
      `${action} does not consult the activation gate and must not report it`,
    );
  }
});

test("P5b promotion target search is pinned to the configured Pancake shop", () => {
  const source = exportedActionSource("searchPromotionTargetsAction");
  assert.match(source, /const shopId = readPancakeShopId\(\);/);
  assert.match(source, /searchTargetProducts\(\{ shopId, search \}\)/);
  assert.match(source, /searchTargetVariants\(\{ shopId, search \}\)/);
});
