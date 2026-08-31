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
  assert.match(script, /window\.gtag = window\.gtag \|\| function \(\) \{ window\.dataLayer\.push\(arguments\); \};/);
  assert.match(script, /window\.gtag\("consent", "default", \{/);

  for (const forbidden of ["googletagmanager", "gtm.js", "GTM-ABC123", "src=", "http"]) {
    assert.equal(
      script.includes(forbidden),
      false,
      `the bootstrap must not reference ${forbidden}`,
    );
  }
  assert.equal(script.includes("<"), false, "the bootstrap must not be able to close its script tag");
});

/**
 * Runs the emitted bytes against a synthetic window, so what is asserted is what a browser would
 * actually do rather than what the source looks like.
 */
function runBootstrap(policy = CURRENT_CONSENT_POLICY) {
  const script = buildTrackingBootstrapScript(
    resolveTrackingRuntime({ desiredMode: "preview", containerId: "GTM-ABC123" }),
    policy,
  );
  const win: Record<string, unknown> = {};
  new Function("window", script)(win);
  return win;
}

test("T3 the executed bootstrap initializes the dataLayer and pins the tracking mode", () => {
  const win = runBootstrap();

  assert.ok(Array.isArray(win.dataLayer));
  assert.equal(win.la_tracking_mode, "preview");
  assert.deepEqual(Object.getOwnPropertyDescriptor(win, "la_tracking_mode"), {
    value: "preview",
    writable: false,
    enumerable: false,
    configurable: false,
  });
  assert.deepEqual((win.dataLayer as unknown[])[0], { la_tracking_mode: "preview" });
});

test("T3 consent defaults reach the dataLayer as a gtag arguments object, not a plain array", () => {
  const win = runBootstrap();
  const pushed = win.dataLayer as unknown[];
  const consentEntry = pushed[1] as Record<string, unknown> & { length: number };

  // This is the finding this test exists for: `gtag(...)` pushes its `arguments` object. A plain
  // array would serialize identically in the source and be ignored by a container.
  assert.equal(Object.prototype.toString.call(consentEntry), "[object Arguments]");
  assert.equal(Array.isArray(consentEntry), false);
  assert.equal(consentEntry.length, 3);
  assert.equal(consentEntry[0], "consent");
  assert.equal(consentEntry[1], "default");
  assert.deepEqual(consentEntry[2], resolveConsentDefaults(CURRENT_CONSENT_POLICY));
});

test("T3 the bootstrap never replaces an existing dataLayer or gtag", () => {
  const script = buildTrackingBootstrapScript(
    resolveTrackingRuntime({ desiredMode: "live", containerId: "GTM-ABC123" }),
    CURRENT_CONSENT_POLICY,
  );
  const existingEntries = [{ event: "gtm.js" }];
  const seenByExistingGtag: unknown[] = [];
  const existingGtag = (...args: unknown[]) => {
    seenByExistingGtag.push(args);
  };
  const win: Record<string, unknown> = { dataLayer: existingEntries, gtag: existingGtag };

  new Function("window", script)(win);

  assert.equal(win.dataLayer, existingEntries, "an initialized dataLayer must survive");
  assert.equal(win.gtag, existingGtag, "an existing gtag must not be replaced");
  assert.deepEqual(existingEntries[0], { event: "gtm.js" }, "prior entries stay in order");
  assert.deepEqual(seenByExistingGtag, [["consent", "default", resolveConsentDefaults(CURRENT_CONSENT_POLICY)]]);
});

test("T3 a swapped default-denied policy changes the queued state and nothing else", () => {
  const denied = { id: "denied-until-choice", defaultSignal: "denied" as const, visibleConsentUi: true };
  const win = runBootstrap(denied);
  const consentEntry = (win.dataLayer as unknown[])[1] as Record<string, unknown>;

  assert.equal(consentEntry[0], "consent");
  assert.equal(consentEntry[1], "default");
  assert.deepEqual(consentEntry[2], resolveConsentDefaults(denied));
});
