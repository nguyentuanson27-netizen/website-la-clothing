import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrustedExperimentEnvironment,
  environmentFlagIsEnabled,
} from "../../scripts/pancake-w3-experiment.ts";

test("environmentFlagIsEnabled identifies true/false representations", () => {
  assert.equal(environmentFlagIsEnabled(undefined), false);
  assert.equal(environmentFlagIsEnabled(""), false);
  assert.equal(environmentFlagIsEnabled("0"), false);
  assert.equal(environmentFlagIsEnabled("false"), false);
  assert.equal(environmentFlagIsEnabled("FALSE"), false);

  assert.equal(environmentFlagIsEnabled("1"), true);
  assert.equal(environmentFlagIsEnabled("true"), true);
  assert.equal(environmentFlagIsEnabled("TRUE"), true);
  assert.equal(environmentFlagIsEnabled("anything"), true);
});

test("assertTrustedExperimentEnvironment refuses CI execution", () => {
  assert.throws(
    () => assertTrustedExperimentEnvironment({ CI: "true" } as unknown as NodeJS.ProcessEnv),
    /Trusted Pancake pricing experiment refuses CI execution/,
  );
  assert.throws(
    () => assertTrustedExperimentEnvironment({ GITHUB_ACTIONS: "true" } as unknown as NodeJS.ProcessEnv),
    /Trusted Pancake pricing experiment refuses CI execution/,
  );
  assert.doesNotThrow(() => assertTrustedExperimentEnvironment({} as unknown as NodeJS.ProcessEnv));
});
