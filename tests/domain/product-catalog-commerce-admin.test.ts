import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  ADMIN_CATALOG_CONFIRMATION_LIMITS,
  issueAdminCatalogConfirmationProof,
  verifyAdminCatalogConfirmationProof,
} from "../../src/commerce/admin-catalog-confirmation.ts";
import { createProductCommerceAdminService } from "../../src/commerce/product-commerce-admin.ts";

const adminSession = {
  user: { id: "admin-catalog", role: "ADMIN" },
  session: { id: "session-admin-catalog" },
} as const;
const customerSession = {
  user: { id: "customer-catalog", role: "CUSTOMER" },
  session: { id: "session-customer-catalog" },
} as const;
const secret = "product-catalog-admin-test-secret-123456789";
const nowMs = Date.parse("2026-08-27T09:30:00.000Z");

function dependencies() {
  return {
    async setVariantActivation() {
      return true;
    },
    async readCatalogEnableWarningState(productId: string) {
      return {
        zeroActiveProductIds: [productId],
        compositeChildProductIds: [],
      };
    },
    async commitCatalogEnable() {
      return { ok: true } as const;
    },
    async disableCatalog() {
      return true;
    },
    async activateProductAndStockedVariants() {
      return { ok: true, activatedVariantCount: 2 } as const;
    },
    readConfirmationSecret() {
      return secret;
    },
    nowMs() {
      return nowMs;
    },
  };
}

test("catalog prepare requires ADMIN and returns a server-authenticated proof for current warning state", async () => {
  let warningReads = 0;
  const deps = dependencies();
  const service = createProductCommerceAdminService({
    ...deps,
    async readCatalogEnableWarningState(productId: string) {
      warningReads += 1;
      return deps.readCatalogEnableWarningState(productId);
    },
  });

  await assert.rejects(
    () => service.prepareCatalogEnable(customerSession, "product-1"),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
  assert.equal(warningReads, 0);

  const result = await service.prepareCatalogEnable(adminSession, "product-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.warningState, {
    zeroActiveProductIds: ["product-1"],
    compositeChildProductIds: [],
  });
  assert.equal(
    verifyAdminCatalogConfirmationProof({
      secret,
      nowMs,
      proof: result.proof,
      actorId: adminSession.user.id,
      operation: "enable",
      targetProductIds: ["product-1"],
      zeroActiveProductIds: ["product-1"],
      compositeChildProductIds: [],
    }),
    true,
  );
});

test("catalog prepare fails closed for malformed or unavailable route product", async () => {
  const deps = dependencies();
  const unavailable = createProductCommerceAdminService({
    ...deps,
    async readCatalogEnableWarningState() {
      return null;
    },
  });

  assert.deepEqual(await unavailable.prepareCatalogEnable(adminSession, ""), {
    ok: false,
    reason: "INVALID_INPUT",
  });
  assert.deepEqual(await unavailable.prepareCatalogEnable(adminSession, "missing-product"), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });
});

test("catalog commit binds the persisted route target and ignores a forged browser productId", async () => {
  const calls: unknown[] = [];
  const deps = dependencies();
  const service = createProductCommerceAdminService({
    ...deps,
    async commitCatalogEnable(input) {
      calls.push(input);
      return { ok: true } as const;
    },
  });
  const proof = issueAdminCatalogConfirmationProof({
    secret,
    nowMs,
    actorId: adminSession.user.id,
    operation: "enable",
    targetProductIds: ["route-product"],
    zeroActiveProductIds: ["route-product"],
    compositeChildProductIds: [],
  }).proof;

  assert.deepEqual(
    await service.commitCatalogEnable(adminSession, "route-product", {
      productId: "forged-product",
      proof,
    }),
    { ok: true },
  );
  assert.deepEqual(calls, [
    {
      productId: "route-product",
      actorId: adminSession.user.id,
      proof,
      secret,
      nowMs,
    },
  ]);
});

test("catalog commit treats missing empty and oversized proof as reconfirmation freshness failures", async () => {
  const deps = dependencies();
  let warningReads = 0;
  let commitCalls = 0;
  const service = createProductCommerceAdminService({
    ...deps,
    async readCatalogEnableWarningState(productId: string) {
      warningReads += 1;
      return deps.readCatalogEnableWarningState(productId);
    },
    async commitCatalogEnable() {
      commitCalls += 1;
      return { ok: true } as const;
    },
  });

  for (const input of [
    {},
    { proof: "" },
    { proof: "x".repeat(ADMIN_CATALOG_CONFIRMATION_LIMITS.proofLength + 1) },
  ]) {
    const result = await service.commitCatalogEnable(adminSession, "product-1", input);
    assert.equal(result.ok, false);
    if (result.ok || result.reason !== "RECONFIRM_REQUIRED") continue;
    assert.deepEqual(result.warningState, {
      zeroActiveProductIds: ["product-1"],
      compositeChildProductIds: [],
    });
    assert.equal(
      verifyAdminCatalogConfirmationProof({
        secret,
        nowMs,
        proof: result.proof,
        actorId: adminSession.user.id,
        operation: "enable",
        targetProductIds: ["product-1"],
        zeroActiveProductIds: ["product-1"],
        compositeChildProductIds: [],
      }),
      true,
    );
  }

  assert.equal(warningReads, 3);
  assert.equal(commitCalls, 0);
});

test("catalog stale commit returns a fresh proof for the server-returned warning state", async () => {
  const deps = dependencies();
  const service = createProductCommerceAdminService({
    ...deps,
    async commitCatalogEnable() {
      return {
        ok: false,
        reason: "RECONFIRM_REQUIRED",
        warningState: {
          zeroActiveProductIds: [],
          compositeChildProductIds: ["product-1"],
        },
      } as const;
    },
  });

  const result = await service.commitCatalogEnable(adminSession, "product-1", {
    proof: "stale-proof",
  });
  assert.equal(result.ok, false);
  if (result.ok || result.reason !== "RECONFIRM_REQUIRED") return;
  assert.deepEqual(result.warningState, {
    zeroActiveProductIds: [],
    compositeChildProductIds: ["product-1"],
  });
  assert.equal(
    verifyAdminCatalogConfirmationProof({
      secret,
      nowMs,
      proof: result.proof,
      actorId: adminSession.user.id,
      operation: "enable",
      targetProductIds: ["product-1"],
      zeroActiveProductIds: [],
      compositeChildProductIds: ["product-1"],
    }),
    true,
  );
});

test("catalog disable and combined quick action are distinct route-owned ADMIN operations", async () => {
  const deps = dependencies();
  const disableTargets: string[] = [];
  const quickTargets: string[] = [];
  const service = createProductCommerceAdminService({
    ...deps,
    async disableCatalog(productId: string) {
      disableTargets.push(productId);
      return true;
    },
    async activateProductAndStockedVariants(productId: string) {
      quickTargets.push(productId);
      return { ok: true, activatedVariantCount: 3 } as const;
    },
  });

  assert.deepEqual(await service.disableCatalog(adminSession, "route-product"), {
    ok: true,
  });
  assert.deepEqual(
    await service.activateProductAndStockedVariants(adminSession, "route-product"),
    { ok: true, activatedVariantCount: 3 },
  );
  assert.deepEqual(disableTargets, ["route-product"]);
  assert.deepEqual(quickTargets, ["route-product"]);

  await assert.rejects(() => service.disableCatalog(null, "route-product"), AuthorizationError);
  await assert.rejects(
    () => service.activateProductAndStockedVariants(customerSession, "route-product"),
    AuthorizationError,
  );
  assert.deepEqual(disableTargets, ["route-product"]);
  assert.deepEqual(quickTargets, ["route-product"]);
});
