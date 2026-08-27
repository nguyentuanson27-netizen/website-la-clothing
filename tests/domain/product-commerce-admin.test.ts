import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  PRODUCT_COMMERCE_ADMIN_LIMITS,
  createProductCommerceAdminService,
} from "../../src/commerce/product-commerce-admin.ts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

const validInput = {
  variantIds: ["variant-1", "variant-2"],
  isActive: true,
} as const;

function commerceDependencies(
  setVariantActivation: (input: {
    productId: string;
    variantIds: readonly string[];
    isActive: boolean;
  }) => Promise<boolean>,
) {
  return {
    setVariantActivation,
    async readCatalogEnableWarningState() {
      return { zeroActiveProductIds: [], compositeChildProductIds: [] };
    },
    async commitCatalogEnable() {
      return { ok: true } as const;
    },
    async disableCatalog() {
      return true;
    },
    async activateProductAndStockedVariants() {
      return { ok: true, activatedVariantCount: 0 } as const;
    },
    readConfirmationSecret() {
      return "product-commerce-admin-test-secret-123456789";
    },
    nowMs() {
      return Date.parse("2026-08-27T09:30:00.000Z");
    },
  };
}

test("generic variant activation requires ADMIN before repository access", async () => {
  let calls = 0;
  const service = createProductCommerceAdminService(
    commerceDependencies(async () => {
      calls += 1;
      return true;
    }),
  );

  for (const [session, expectedCode] of [
    [null, "UNAUTHENTICATED"],
    [customerSession, "FORBIDDEN"],
  ] as const) {
    await assert.rejects(
      () => service.setVariantActivation(session, "product-1", validInput),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.code, expectedCode);
        return true;
      },
    );
  }

  assert.equal(calls, 0);
});

test("generic variant activation rejects malformed route identity and malformed duplicate or oversized browser input", async () => {
  let calls = 0;
  const service = createProductCommerceAdminService(
    commerceDependencies(async () => {
      calls += 1;
      return true;
    }),
  );

  for (const productId of [
    "",
    " product-1",
    "p".repeat(PRODUCT_COMMERCE_ADMIN_LIMITS.productId + 1),
  ]) {
    assert.deepEqual(await service.setVariantActivation(adminSession, productId, validInput), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }

  const invalidInputs: unknown[] = [
    null,
    [],
    { ...validInput, variantIds: [] },
    { ...validInput, variantIds: ["variant-1", "variant-1"] },
    {
      ...validInput,
      variantIds: Array.from(
        { length: PRODUCT_COMMERCE_ADMIN_LIMITS.variantCount + 1 },
        (_, index) => `variant-${index}`,
      ),
    },
    { ...validInput, variantIds: [""] },
    { ...validInput, variantIds: [" variant-1"] },
    {
      ...validInput,
      variantIds: ["v".repeat(PRODUCT_COMMERCE_ADMIN_LIMITS.variantId + 1)],
    },
    { ...validInput, variantIds: "variant-1" },
    { ...validInput, isActive: "true" },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.setVariantActivation(adminSession, "product-1", input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }

  assert.equal(calls, 0);
});

test("generic variant activation binds the persisted route product and ignores a forged browser productId", async () => {
  const calls: unknown[] = [];
  const service = createProductCommerceAdminService(
    commerceDependencies(async (input) => {
      calls.push(input);
      return true;
    }),
  );

  assert.deepEqual(
    await service.setVariantActivation(adminSession, "route-product", {
      productId: "forged-product",
      variantIds: ["variant-2", "variant-1"],
      isActive: false,
      forgedProductActive: true,
      forgedStock: 999,
    }),
    {
      ok: true,
      variantIds: ["variant-2", "variant-1"],
      isActive: false,
    },
  );
  assert.deepEqual(calls, [
    {
      productId: "route-product",
      variantIds: ["variant-2", "variant-1"],
      isActive: false,
    },
  ]);
});

test("generic variant activation fails closed when any requested variant is unavailable", async () => {
  const service = createProductCommerceAdminService(commerceDependencies(async () => false));

  assert.deepEqual(await service.setVariantActivation(adminSession, "product-1", validInput), {
    ok: false,
    reason: "VARIANT_NOT_AVAILABLE",
  });
});
