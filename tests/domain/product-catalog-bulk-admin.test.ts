import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { verifyAdminCatalogConfirmationProof } from "../../src/commerce/admin-catalog-confirmation.ts";
import { createProductCatalogBulkAdminService } from "../../src/commerce/product-commerce-admin.ts";
import type {
  BulkCatalogEnableCommitInput,
  CatalogEnableWarningState,
} from "../../src/commerce/product-commerce-repository.ts";

const secret = "bulk-catalog-confirmation-secret-0123456789";
const nowMs = 1_800_000_000_000;

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

const otherAdminSession = {
  user: { id: "admin-2", role: "ADMIN" },
  session: { id: "session-admin-2" },
} as const;

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

type Recorder = {
  warningReads: string[][];
  commits: BulkCatalogEnableCommitInput[];
  disables: string[][];
  variantUpdates: Array<{ productIds: string[]; mode: string }>;
};

function recorder(): Recorder {
  return { warningReads: [], commits: [], disables: [], variantUpdates: [] };
}

function createService(
  calls: Recorder,
  options: Readonly<{
    warningState?: CatalogEnableWarningState | null;
    commitWarningState?: CatalogEnableWarningState;
    variantResult?: { ok: true; updatedProductCount: number; updatedVariantCount: number } | { ok: false; reason: "PRODUCT_NOT_AVAILABLE" };
  }> = {},
) {
  const warningState =
    options.warningState === undefined
      ? { zeroActiveProductIds: [], compositeChildProductIds: [] }
      : options.warningState;

  return createProductCatalogBulkAdminService({
    async readBulkCatalogEnableWarningState(productIds) {
      calls.warningReads.push([...productIds]);
      return warningState;
    },
    async commitBulkCatalogEnable(input) {
      calls.commits.push(input);
      const current = options.commitWarningState ?? warningState;
      if (!current) return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;

      const proofIsCurrent = verifyAdminCatalogConfirmationProof({
        secret: input.secret,
        nowMs: input.nowMs,
        proof: input.proof,
        actorId: input.actorId,
        operation: "enable",
        targetProductIds: input.productIds,
        zeroActiveProductIds: current.zeroActiveProductIds,
        compositeChildProductIds: current.compositeChildProductIds,
      });
      return proofIsCurrent
        ? ({ ok: true, updatedCount: input.productIds.length } as const)
        : ({ ok: false, reason: "RECONFIRM_REQUIRED", warningState: current } as const);
    },
    async disableBulkCatalog(productIds) {
      calls.disables.push([...productIds]);
      return { ok: true, updatedCount: productIds.length } as const;
    },
    async updateBulkVariantActivation(productIds, mode) {
      calls.variantUpdates.push({ productIds: [...productIds], mode });
      return (
        options.variantResult ?? {
          ok: true,
          updatedProductCount: productIds.length,
          updatedVariantCount: productIds.length * 2,
        }
      );
    },
    readConfirmationSecret: () => secret,
    nowMs: () => nowMs,
  });
}

test("bulk catalog operations require ADMIN before any repository access", async () => {
  const calls = recorder();
  const service = createService(calls);
  const input = { productIds: ["product-1"] };

  await assert.rejects(() => service.prepareEnable(customerSession, input), AuthorizationError);
  await assert.rejects(() => service.commitEnable(customerSession, input), AuthorizationError);
  await assert.rejects(() => service.disable(customerSession, input), AuthorizationError);
  await assert.rejects(() => service.prepareEnable(null, input), AuthorizationError);

  assert.deepEqual(calls.warningReads, []);
  assert.deepEqual(calls.commits, []);
  assert.deepEqual(calls.disables, []);
});

test("bulk catalog operations reject malformed selections before any repository access", async () => {
  const calls = recorder();
  const service = createService(calls);
  const tooMany = Array.from({ length: 101 }, (_, index) => `product-${index}`);

  const invalidInputs = [
    null,
    ["product-1"],
    {},
    { productIds: [] },
    { productIds: tooMany },
    { productIds: ["product-1", "product-1"] },
    { productIds: [" product-1"] },
    { productIds: [""] },
    { productIds: ["x".repeat(129)] },
    { productIds: [17] },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.prepareEnable(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
    assert.deepEqual(await service.commitEnable(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
    assert.deepEqual(await service.disable(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }

  assert.deepEqual(calls.warningReads, []);
  assert.deepEqual(calls.commits, []);
  assert.deepEqual(calls.disables, []);
});

test("bulk prepare binds the proof to the exact selection, actor and warning sets", async () => {
  const calls = recorder();
  const service = createService(calls, {
    warningState: {
      zeroActiveProductIds: ["product-2"],
      compositeChildProductIds: ["product-3"],
    },
  });

  const prepared = await service.prepareEnable(adminSession, {
    productIds: ["product-1", "product-2", "product-3"],
  });
  assert.equal(prepared.ok, true);
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.warningState, {
    zeroActiveProductIds: ["product-2"],
    compositeChildProductIds: ["product-3"],
  });

  const binding = {
    secret,
    nowMs,
    proof: prepared.proof,
    operation: "enable",
    zeroActiveProductIds: ["product-2"],
    compositeChildProductIds: ["product-3"],
  } as const;

  assert.equal(
    verifyAdminCatalogConfirmationProof({
      ...binding,
      actorId: adminSession.user.id,
      targetProductIds: ["product-1", "product-2", "product-3"],
    }),
    true,
  );
  assert.equal(
    verifyAdminCatalogConfirmationProof({
      ...binding,
      actorId: otherAdminSession.user.id,
      targetProductIds: ["product-1", "product-2", "product-3"],
    }),
    false,
    "another admin cannot reuse the proof",
  );
  assert.equal(
    verifyAdminCatalogConfirmationProof({
      ...binding,
      actorId: adminSession.user.id,
      targetProductIds: ["product-1", "product-2"],
    }),
    false,
    "a narrower selection cannot reuse the proof",
  );
});

test("bulk commit without a proof returns a fresh confirmation instead of writing", async () => {
  const calls = recorder();
  const service = createService(calls);

  const result = await service.commitEnable(adminSession, { productIds: ["product-1"] });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "RECONFIRM_REQUIRED");
  assert.deepEqual(calls.commits, []);
  assert.deepEqual(calls.warningReads, [["product-1"]]);
});

test("bulk commit accepts a current proof and forwards the exact selection", async () => {
  const calls = recorder();
  const service = createService(calls);
  const productIds = ["product-1", "product-2"];

  const prepared = await service.prepareEnable(adminSession, { productIds });
  assert.ok(prepared.ok);

  assert.deepEqual(await service.commitEnable(adminSession, { productIds, proof: prepared.proof }), {
    ok: true,
    updatedCount: 2,
  });
  assert.equal(calls.commits.length, 1);
  assert.deepEqual(calls.commits[0]?.productIds, productIds);
  assert.equal(calls.commits[0]?.actorId, adminSession.user.id);
});

test("a proof issued before warning-state drift is rejected and reissued with the current state", async () => {
  const calls = recorder();
  const service = createService(calls, {
    warningState: { zeroActiveProductIds: [], compositeChildProductIds: [] },
    commitWarningState: {
      zeroActiveProductIds: [],
      compositeChildProductIds: ["product-2"],
    },
  });
  const productIds = ["product-1", "product-2"];

  const prepared = await service.prepareEnable(adminSession, { productIds });
  assert.ok(prepared.ok);

  const stale = await service.commitEnable(adminSession, { productIds, proof: prepared.proof });
  assert.ok(!stale.ok && stale.reason === "RECONFIRM_REQUIRED");
  assert.deepEqual(stale.warningState, {
    zeroActiveProductIds: [],
    compositeChildProductIds: ["product-2"],
  });
  assert.notEqual(stale.proof, prepared.proof);
  assert.equal(
    verifyAdminCatalogConfirmationProof({
      secret,
      nowMs,
      proof: stale.proof,
      actorId: adminSession.user.id,
      operation: "enable",
      targetProductIds: productIds,
      zeroActiveProductIds: [],
      compositeChildProductIds: ["product-2"],
    }),
    true,
    "the reissued proof matches the current warning state",
  );
});

test("bulk disable needs no confirmation but still forwards the validated selection", async () => {
  const calls = recorder();
  const service = createService(calls);

  assert.deepEqual(await service.disable(adminSession, { productIds: ["product-1", "product-2"] }), {
    ok: true,
    updatedCount: 2,
  });
  assert.deepEqual(calls.disables, [["product-1", "product-2"]]);
  assert.deepEqual(calls.commits, []);
});

test("bulk prepare and commit fail closed when a selected product is unavailable", async () => {
  const calls = recorder();
  const service = createService(calls, { warningState: null });

  assert.deepEqual(await service.prepareEnable(adminSession, { productIds: ["gone"] }), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });
  assert.deepEqual(await service.commitEnable(adminSession, { productIds: ["gone"] }), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });
  assert.deepEqual(calls.commits, []);
});

test("bulk variant activation requires ADMIN before any repository access", async () => {
  const calls = recorder();
  const service = createService(calls);
  const input = { productIds: ["product-1"], mode: "enable-all" };

  await assert.rejects(() => service.updateVariantActivation(customerSession, input), AuthorizationError);
  await assert.rejects(() => service.updateVariantActivation(null, input), AuthorizationError);

  assert.deepEqual(calls.variantUpdates, []);
});

test("bulk variant activation rejects malformed inputs", async () => {
  const calls = recorder();
  const service = createService(calls);

  assert.deepEqual(await service.updateVariantActivation(adminSession, {}), {
    ok: false,
    reason: "INVALID_INPUT",
  });
  assert.deepEqual(await service.updateVariantActivation(adminSession, { productIds: [], mode: "enable-all" }), {
    ok: false,
    reason: "INVALID_INPUT",
  });
  assert.deepEqual(
    await service.updateVariantActivation(adminSession, { productIds: ["p1"], mode: "invalid-mode" }),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.deepEqual(
    await service.updateVariantActivation(adminSession, { productIds: ["p1", "p1"], mode: "enable-all" }),
    { ok: false, reason: "INVALID_INPUT" },
  );

  assert.deepEqual(calls.variantUpdates, []);
});

test("bulk variant activation forwards validated selection and mode to repository", async () => {
  const calls = recorder();
  const service = createService(calls, {
    variantResult: { ok: true, updatedProductCount: 2, updatedVariantCount: 6 },
  });

  const result = await service.updateVariantActivation(adminSession, {
    productIds: ["product-1", "product-2"],
    mode: "enable-stocked",
  });

  assert.deepEqual(result, {
    ok: true,
    mode: "enable-stocked",
    updatedProductCount: 2,
    updatedVariantCount: 6,
  });
  assert.deepEqual(calls.variantUpdates, [
    { productIds: ["product-1", "product-2"], mode: "enable-stocked" },
  ]);
});

test("bulk variant activation reports PRODUCT_NOT_AVAILABLE when target product is missing", async () => {
  const calls = recorder();
  const service = createService(calls, {
    variantResult: { ok: false, reason: "PRODUCT_NOT_AVAILABLE" },
  });

  const result = await service.updateVariantActivation(adminSession, {
    productIds: ["gone"],
    mode: "disable-all",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });
});
