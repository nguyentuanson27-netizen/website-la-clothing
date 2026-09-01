import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ALLOWED_AUDIT_DATABASE_NAME,
  assertAuditDatabaseUrl,
  assertDurabilityEvidenceEnvironment,
  compareCatalogSnapshots,
  createCatalogIdSnapshot,
} from "../../src/commerce/merchant-identity-durability.ts";

test("creates well-formed snapshot with sorted hashed identifiers", () => {
  const snapshot = createCatalogIdSnapshot({
    runIndex: 1,
    timestamp: "2026-09-02T00:00:00.000Z",
    shopId: 1635185058,
    productExternalIds: ["prod-b", "prod-a"],
    variationExternalIds: ["var-2", "var-1"],
    internalVariantIdMap: { "var-1": "cuid-1", "var-2": "cuid-2" },
  });

  assert.equal(snapshot.runIndex, 1);
  assert.equal(snapshot.shopId, 1635185058);
  assert.deepEqual(snapshot.productExternalIds, ["prod-a", "prod-b"]);
  assert.deepEqual(snapshot.variationExternalIds, ["var-1", "var-2"]);
  assert.equal(typeof snapshot.productExternalIdsHash, "string");
  assert.equal(snapshot.productExternalIdsHash.length, 64);
  assert.equal(typeof snapshot.variationExternalIdsHash, "string");
  assert.equal(snapshot.variationExternalIdsHash.length, 64);
});

test("snapshot creator fails closed on malformed input", () => {
  assert.throws(
    () =>
      createCatalogIdSnapshot({
        runIndex: -1,
        timestamp: "2026-09-02",
        shopId: 123,
        productExternalIds: [],
        variationExternalIds: [],
      }),
    /runIndex must be a non-negative integer/i,
  );

  assert.throws(
    () =>
      createCatalogIdSnapshot({
        runIndex: 0,
        timestamp: "",
        shopId: 123,
        productExternalIds: [],
        variationExternalIds: [],
      }),
    /timestamp must be a non-empty string/i,
  );

  assert.throws(
    () =>
      createCatalogIdSnapshot({
        runIndex: 0,
        timestamp: "2026-09-02",
        shopId: 0,
        productExternalIds: [],
        variationExternalIds: [],
      }),
    /shopId must be a positive safe integer/i,
  );
});

test("comparison requires at least two snapshots and matching shop scope", () => {
  const snap1 = createCatalogIdSnapshot({
    runIndex: 0,
    timestamp: "2026-09-02T00:00:00Z",
    shopId: 100,
    productExternalIds: ["p1"],
    variationExternalIds: ["v1"],
  });

  assert.throws(() => compareCatalogSnapshots([snap1]), /at least two independent snapshots/i);

  const snapOtherShop = createCatalogIdSnapshot({
    runIndex: 1,
    timestamp: "2026-09-02T00:01:00Z",
    shopId: 200,
    productExternalIds: ["p1"],
    variationExternalIds: ["v1"],
  });

  assert.throws(
    () => compareCatalogSnapshots([snap1, snapOtherShop]),
    /must share the same shop scope/i,
  );
});

test("repeated identical runs prove stability with 100% match", () => {
  const products = ["p1", "p2", "p3"];
  const variations = ["v1", "v2", "v3", "v4"];
  const internalMap = { v1: "c1", v2: "c2", v3: "c3", v4: "c4" };

  const snap1 = createCatalogIdSnapshot({
    runIndex: 0,
    timestamp: "2026-09-02T00:00:00Z",
    shopId: 100,
    productExternalIds: products,
    variationExternalIds: variations,
    internalVariantIdMap: internalMap,
  });

  const snap2 = createCatalogIdSnapshot({
    runIndex: 1,
    timestamp: "2026-09-02T00:01:00Z",
    shopId: 100,
    productExternalIds: products,
    variationExternalIds: variations,
    internalVariantIdMap: internalMap,
  });

  const snap3 = createCatalogIdSnapshot({
    runIndex: 2,
    timestamp: "2026-09-02T00:02:00Z",
    shopId: 100,
    productExternalIds: products,
    variationExternalIds: variations,
    internalVariantIdMap: internalMap,
  });

  const comparison = compareCatalogSnapshots([snap1, snap2, snap3]);

  assert.equal(comparison.runsAudited, 3);
  assert.equal(comparison.isDurable, true);
  assert.equal(comparison.productStabilityPercent, 100);
  assert.equal(comparison.variationStabilityPercent, 100);
  assert.equal(comparison.disappearedProductIds.length, 0);
  assert.equal(comparison.appearedProductIds.length, 0);
  assert.equal(comparison.disappearedVariationIds.length, 0);
  assert.equal(comparison.appearedVariationIds.length, 0);
  assert.equal(comparison.duplicateProductIds.length, 0);
  assert.equal(comparison.duplicateVariationIds.length, 0);
  assert.equal(comparison.internalRowIdReplacedCount, 0);
  assert.equal(comparison.internalRowIdPreservedCount, 8); // 4 vars * 2 comparisons
});

test("changing or disappearing upstream IDs are detected and fail durability", () => {
  const snap1 = createCatalogIdSnapshot({
    runIndex: 0,
    timestamp: "2026-09-02T00:00:00Z",
    shopId: 100,
    productExternalIds: ["p1", "p2"],
    variationExternalIds: ["v1", "v2"],
  });

  // In run 2, v2 disappeared and v3 appeared (unexpected ID replacement)
  const snap2 = createCatalogIdSnapshot({
    runIndex: 1,
    timestamp: "2026-09-02T00:01:00Z",
    shopId: 100,
    productExternalIds: ["p1", "p2"],
    variationExternalIds: ["v1", "v3"],
  });

  const comparison = compareCatalogSnapshots([snap1, snap2]);

  assert.equal(comparison.isDurable, false);
  assert.deepEqual(comparison.disappearedVariationIds, ["v2"]);
  assert.deepEqual(comparison.appearedVariationIds, ["v3"]);
  assert.equal(comparison.variationStabilityPercent, 50);
});

test("internal row ID replacement fails durability", () => {
  const snap1 = createCatalogIdSnapshot({
    runIndex: 0,
    timestamp: "2026-09-02T00:00:00Z",
    shopId: 100,
    productExternalIds: ["p1"],
    variationExternalIds: ["v1"],
    internalVariantIdMap: { v1: "cuid-first" },
  });

  // Same external ID, but internal mirror row ID changed (mirror failed to reconcile by external ID)
  const snap2 = createCatalogIdSnapshot({
    runIndex: 1,
    timestamp: "2026-09-02T00:01:00Z",
    shopId: 100,
    productExternalIds: ["p1"],
    variationExternalIds: ["v1"],
    internalVariantIdMap: { v1: "cuid-second" },
  });

  const comparison = compareCatalogSnapshots([snap1, snap2]);

  assert.equal(comparison.isDurable, false);
  assert.equal(comparison.internalRowIdReplacedCount, 1);
});

test("trusted durability evidence script refuses CI before reading credentials", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/pancake-durability-evidence.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true" },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /durability evidence script refuses CI execution/i);
});

test("durability evidence refuses production database name", () => {
  assert.throws(
    () =>
      assertAuditDatabaseUrl("postgresql://user:pass@localhost:5432/la_clothing"),
    (err: unknown) => {
      assert(err instanceof Error);
      assert.match(err.message, new RegExp(`expected database '${ALLOWED_AUDIT_DATABASE_NAME}', got 'la_clothing'`, "i"));
      return true;
    },
  );
});

test("durability evidence allows exact approved audit database name", () => {
  const result = assertAuditDatabaseUrl(
    `postgresql://audit_user:secret@localhost:5432/${ALLOWED_AUDIT_DATABASE_NAME}?schema=public`,
  );
  assert.equal(result.databaseName, ALLOWED_AUDIT_DATABASE_NAME);
});

test("durability evidence refuses missing, empty, or malformed DATABASE_URL", () => {
  assert.throws(
    () => assertAuditDatabaseUrl(undefined),
    /DATABASE_URL is required to run durability evidence/i,
  );
  assert.throws(
    () => assertAuditDatabaseUrl("   "),
    /DATABASE_URL is required to run durability evidence/i,
  );
  assert.throws(
    () => assertAuditDatabaseUrl("not-a-valid-url"),
    /DATABASE_URL is malformed/i,
  );
  assert.throws(
    () => assertAuditDatabaseUrl("postgresql:///"),
    /expected database 'la_clothing_durability_audit', got ''/i,
  );
});

test("durability evidence environment validator refuses CI before database validation", () => {
  assert.throws(
    () =>
      assertDurabilityEvidenceEnvironment({
        CI: "true",
        DATABASE_URL: `postgresql://user:pass@localhost:5432/${ALLOWED_AUDIT_DATABASE_NAME}`,
      }),
    /durability evidence script refuses CI execution/i,
  );
  assert.throws(
    () =>
      assertDurabilityEvidenceEnvironment({
        GITHUB_ACTIONS: "true",
        // Note: Even if DATABASE_URL is missing or invalid, CI check must trigger first!
        DATABASE_URL: undefined,
      }),
    /durability evidence script refuses CI execution/i,
  );
});

test("durability evidence error messages never leak passwords, hosts, or full URL secrets", () => {
  const sensitiveUrl =
    "postgresql://secret_user:super_secret_password_xyz987@prod-internal-db.example.com:5432/la_clothing?sslmode=require";

  try {
    assertAuditDatabaseUrl(sensitiveUrl);
    assert.fail("assertAuditDatabaseUrl should have thrown");
  } catch (error) {
    assert(error instanceof Error);
    assert.doesNotMatch(error.message, /secret_user/);
    assert.doesNotMatch(error.message, /super_secret_password_xyz987/);
    assert.doesNotMatch(error.message, /prod-internal-db\.example\.com/);
    assert.doesNotMatch(error.message, /sslmode/);
    assert.match(error.message, /la_clothing/);
  }

  // Also verify CLI stderr does not leak secrets when rejecting a production database
  const cliResult = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/pancake-durability-evidence.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        CI: "false",
        GITHUB_ACTIONS: "false",
        DATABASE_URL: sensitiveUrl,
      },
    },
  );
  assert.notEqual(cliResult.status, 0);
  assert.match(cliResult.stderr, /expected database 'la_clothing_durability_audit', got 'la_clothing'/);
  assert.doesNotMatch(cliResult.stderr, /secret_user/);
  assert.doesNotMatch(cliResult.stderr, /super_secret_password_xyz987/);
  assert.doesNotMatch(cliResult.stderr, /prod-internal-db\.example\.com/);
});
