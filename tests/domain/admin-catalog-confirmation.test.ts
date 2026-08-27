import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_CATALOG_CONFIRMATION_LIMITS,
  issueAdminCatalogConfirmationProof,
  verifyAdminCatalogConfirmationProof,
} from "../../src/commerce/admin-catalog-confirmation.ts";

const secret = "test-admin-catalog-confirmation-secret-1234567890";
const nowMs = Date.parse("2026-08-27T08:10:00.000Z");

const expected = {
  actorId: "admin-1",
  operation: "enable",
  targetProductIds: ["product-b", "product-a"],
  zeroActiveProductIds: ["product-b"],
  compositeChildProductIds: ["product-a"],
} as const;

function issue(overrides: Partial<typeof expected> = {}) {
  return issueAdminCatalogConfirmationProof({
    secret,
    nowMs,
    ...expected,
    ...overrides,
  });
}

function verify(
  proof: string,
  overrides: Partial<typeof expected> & { nowMs?: number; secret?: string } = {},
) {
  return verifyAdminCatalogConfirmationProof({
    secret: overrides.secret ?? secret,
    nowMs: overrides.nowMs ?? nowMs,
    proof,
    actorId: overrides.actorId ?? expected.actorId,
    operation: overrides.operation ?? expected.operation,
    targetProductIds: overrides.targetProductIds ?? expected.targetProductIds,
    zeroActiveProductIds: overrides.zeroActiveProductIds ?? expected.zeroActiveProductIds,
    compositeChildProductIds:
      overrides.compositeChildProductIds ?? expected.compositeChildProductIds,
  });
}

test("catalog enable confirmation proof round-trips and canonicalizes logical ID sets", () => {
  const issued = issue();

  assert.equal(typeof issued.proof, "string");
  assert.ok(issued.proof.length > 0);
  assert.equal(issued.expiresAtMs, nowMs + ADMIN_CATALOG_CONFIRMATION_LIMITS.ttlMs);
  assert.equal(
    verify(issued.proof, {
      targetProductIds: ["product-a", "product-b"],
      zeroActiveProductIds: ["product-b"],
      compositeChildProductIds: ["product-a"],
    }),
    true,
  );
});

test("catalog enable confirmation proof fails closed for tampering, wrong secret, and expiry", () => {
  const { proof, expiresAtMs } = issue();
  const replacement = proof.endsWith("A") ? "B" : "A";
  const tampered = `${proof.slice(0, -1)}${replacement}`;

  assert.equal(verify(tampered), false);
  assert.equal(
    verify(proof, { secret: "different-admin-catalog-secret-123456789012345" }),
    false,
  );
  assert.equal(verify(proof, { nowMs: expiresAtMs + 1 }), false);
});

test("catalog enable confirmation proof is bound to actor and exact target set", () => {
  const { proof } = issue();

  assert.equal(verify(proof, { actorId: "admin-2" }), false);
  assert.equal(verify(proof, { targetProductIds: ["product-a"] }), false);
  assert.equal(
    verify(proof, { targetProductIds: ["product-a", "product-b", "product-c"] }),
    false,
  );
});

test("catalog enable confirmation proof is bound to the enable operation", () => {
  const { proof } = issue();

  assert.equal(
    verify(proof, {
      operation: "disable" as never,
    }),
    false,
  );
});

test("catalog enable confirmation proof rejects warning-state drift", () => {
  const { proof } = issue();

  assert.equal(verify(proof, { zeroActiveProductIds: [] }), false);
  assert.equal(
    verify(proof, { zeroActiveProductIds: ["product-a", "product-b"] }),
    false,
  );
  assert.equal(verify(proof, { compositeChildProductIds: [] }), false);
  assert.equal(
    verify(proof, { compositeChildProductIds: ["product-a", "product-b"] }),
    false,
  );
});

test("catalog enable confirmation proof rejects duplicate and out-of-target IDs before signing", () => {
  assert.throws(
    () => issue({ targetProductIds: ["product-a", "product-a"] }),
    /invalid/i,
  );
  assert.throws(
    () => issue({ zeroActiveProductIds: ["product-b", "product-b"] }),
    /invalid/i,
  );
  assert.throws(
    () => issue({ compositeChildProductIds: ["product-c"] }),
    /invalid/i,
  );
});

test("catalog enable confirmation proof enforces bounded IDs and product count", () => {
  assert.throws(
    () => issue({ actorId: `a${"x".repeat(ADMIN_CATALOG_CONFIRMATION_LIMITS.idLength)}` }),
    /invalid/i,
  );
  assert.throws(
    () =>
      issue({
        targetProductIds: Array.from(
          { length: ADMIN_CATALOG_CONFIRMATION_LIMITS.productCount + 1 },
          (_, index) => `product-${index}`,
        ),
        zeroActiveProductIds: [],
        compositeChildProductIds: [],
      }),
    /invalid/i,
  );
});

test("catalog enable confirmation proof verification rejects malformed or duplicate expectations", () => {
  const { proof } = issue();

  assert.equal(verify("not-a-proof"), false);
  assert.equal(verify(proof, { targetProductIds: ["product-a", "product-a"] }), false);
  assert.equal(
    verify(proof, { zeroActiveProductIds: ["product-b", "product-b"] }),
    false,
  );
});