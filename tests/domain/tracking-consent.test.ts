import assert from "node:assert/strict";
import test from "node:test";

import { buildTrackingBootstrapScript } from "../../src/tracking/bootstrap-script.ts";
import { resolveTrackingRuntime } from "../../src/tracking/config.ts";
import {
  buildConsentDefaultCommand,
  CONSENT_SIGNAL_KEYS,
  CURRENT_CONSENT_POLICY,
  readConsentPolicy,
  resolveConsentDefaults,
} from "../../src/tracking/consent.ts";

test("T3 current owner policy grants tracking on entry with the visible consent UI still deferred", () => {
  assert.deepEqual(CURRENT_CONSENT_POLICY, {
    id: "granted-on-entry",
    defaultSignal: "granted",
    visibleConsentUi: false,
  });
  assert.deepEqual(readConsentPolicy(), CURRENT_CONSENT_POLICY);
});

test("T3 consent defaults cover every Google consent signal the reviewed destinations need", () => {
  assert.deepEqual([...CONSENT_SIGNAL_KEYS], [
    "ad_storage",
    "ad_user_data",
    "ad_personalization",
    "analytics_storage",
    "functionality_storage",
    "personalization_storage",
    "security_storage",
  ]);

  const defaults = resolveConsentDefaults(CURRENT_CONSENT_POLICY);
  for (const key of CONSENT_SIGNAL_KEYS) {
    assert.equal(defaults[key], "granted", `${key} must follow the current owner policy`);
  }
});

test("T3 a later default-denied policy is a policy swap, not an event-contract change", () => {
  const denied = resolveConsentDefaults({
    id: "denied-until-choice",
    defaultSignal: "denied",
    visibleConsentUi: true,
  });

  for (const key of CONSENT_SIGNAL_KEYS) {
    if (key === "security_storage") {
      assert.equal(denied[key], "granted", "security storage is not an optional signal");
      continue;
    }
    assert.equal(denied[key], "denied", `${key} must follow the swapped policy`);
  }
});

test("T3 consent defaults are queued as a gtag consent default command", () => {
  const command = buildConsentDefaultCommand(CURRENT_CONSENT_POLICY);

  assert.equal(command[0], "consent");
  assert.equal(command[1], "default");
  assert.deepEqual(command[2], resolveConsentDefaults(CURRENT_CONSENT_POLICY));
});

test("T3 consent state carries no customer identity", () => {
  const [, , state] = buildConsentDefaultCommand(CURRENT_CONSENT_POLICY);

  assert.deepEqual(Object.keys(state).sort(), [...CONSENT_SIGNAL_KEYS].sort());
  for (const value of Object.values(state)) {
    assert.ok(value === "granted" || value === "denied", "consent carries signals only");
  }
});

test("T3 the browser bootstrap establishes the dataLayer and consent without contacting a vendor", () => {
  const script = buildTrackingBootstrapScript(
    resolveTrackingRuntime({ desiredMode: "live", containerId: "GTM-ABC123" }),
    CURRENT_CONSENT_POLICY,
  );

  assert.match(script, /window\.dataLayer = window\.dataLayer \|\| \[\];/);
  assert.match(script, /Object\.defineProperty\(window, 'la_tracking_mode'/);
  assert.match(script, /writable: false/);
  assert.match(script, /\["consent","default",/);

  for (const forbidden of ["googletagmanager", "gtm.js", "GTM-ABC123", "src=", "http"]) {
    assert.equal(
      script.includes(forbidden),
      false,
      `the bootstrap must not reference ${forbidden}`,
    );
  }
  assert.equal(script.includes("<"), false, "the bootstrap must not be able to close its script tag");
});
