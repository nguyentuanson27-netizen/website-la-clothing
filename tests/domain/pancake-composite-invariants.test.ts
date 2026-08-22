import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrustedCompositeInvariantEnvironment,
  buildCompositeInvariantReport,
  compositeInvariantFailureMessage,
} from "../../scripts/pancake-composite-invariants.ts";

test("trusted composite invariant probe refuses CI before live dependencies are needed", () => {
  assert.throws(
    () => assertTrustedCompositeInvariantEnvironment({ CI: "true" }),
    /refuses CI execution/i,
  );
  assert.throws(
    () => assertTrustedCompositeInvariantEnvironment({ GITHUB_ACTIONS: "1" }),
    /refuses CI execution/i,
  );
});

test("composite invariant report exposes only aggregate counts and reviewed booleans", () => {
  const report = buildCompositeInvariantReport({
    parentVariationIds: ["private-parent-id"],
    componentVariationIds: ["private-shirt-id", "private-pants-id"],
    edges: [
      { parentVariationId: "private-parent-id", componentVariationId: "private-shirt-id", quantity: 1 },
      { parentVariationId: "private-parent-id", componentVariationId: "private-pants-id", quantity: 2 },
    ],
  });

  assert.deepEqual(report.counts, {
    parentVariations: 1,
    componentVariations: 2,
    edges: 2,
  });
  assert.deepEqual(report.invariants, {
    parentIdentityConsistent: true,
    componentIdentityConsistent: true,
    configuredShopConsistent: true,
    directComponentsOnly: true,
    positiveIntegerQuantities: true,
    duplicateParentComponentPairs: false,
    unresolvedComponents: false,
    overlappingParentChildRoles: false,
  });

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("private-parent-id"), false);
  assert.equal(serialized.includes("private-shirt-id"), false);
  assert.equal(serialized.includes("private-pants-id"), false);
  assert.equal(serialized.includes("\"quantity\""), false);
});

test("composite invariant failures collapse to a fixed generic message", () => {
  const secret = "secret-upstream-value";
  const message = compositeInvariantFailureMessage(new Error(secret));
  assert.match(message, /failed without logging external scalar values/i);
  assert.equal(message.includes(secret), false);
});
