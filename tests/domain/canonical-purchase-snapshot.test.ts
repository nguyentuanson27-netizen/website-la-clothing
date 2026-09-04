import assert from "node:assert/strict";
import test from "node:test";

import {
  readCanonicalPurchaseSnapshot,
  readCanonicalPurchaseSnapshotSafely,
  type CanonicalPurchaseClient,
} from "../../src/commerce/canonical-purchase-snapshot.ts";

function createMockClient(options: {
  order?: unknown | null;
  variants?: unknown[];
  throwOnOrder?: boolean;
  throwOnVariants?: boolean;
}): CanonicalPurchaseClient {
  return {
    orderMirror: {
      findUnique: async () => {
        if (options.throwOnOrder) throw new Error("DB order connection exploded");
        return (options.order ?? null) as unknown as null;
      },
    },
    variantMirror: {
      findMany: async () => {
        if (options.throwOnVariants) throw new Error("DB variant connection exploded");
        return (options.variants ?? []) as unknown as [];
      },
    },
  } as unknown as CanonicalPurchaseClient;
}

const validConfirmedOrder = {
  publicCode: "LA-2026-0001",
  state: "CONFIRMED" as const,
  merchandiseSubtotalVnd: BigInt(798_000),
  shippingFeeVnd: BigInt(30_000),
  totalVnd: BigInt(828_000),
  lines: [
    {
      variantId: "local-cuid-1",
      pancakeVariationId: "pan-var-101",
      productName: "Áo Polo Pima",
      color: "Trắng",
      size: "L",
      quantity: 2,
      unitPriceVnd: BigInt(399_000),
      lineTotalVnd: BigInt(798_000),
      baseUnitPriceVnd: BigInt(449_000),
    },
  ],
};

const validVariants = [
  {
    id: "local-cuid-1",
    product: {
      pancakeProductId: "pan-prod-999",
    },
  },
];

test("Regression A: only CONFIRMED produces a canonical Purchase snapshot", async () => {
  const nonConfirmedStates = [
    "DRAFT",
    "VALIDATING",
    "POS_SUBMITTING",
    "SYNC_UNKNOWN",
    "REJECTED",
  ] as const;

  for (const state of nonConfirmedStates) {
    const client = createMockClient({
      order: { ...validConfirmedOrder, state },
      variants: validVariants,
    });
    const snapshot = await readCanonicalPurchaseSnapshot(client, "LA-2026-0001");
    assert.equal(
      snapshot,
      null,
      `Order in state ${state} must not emit a canonical Purchase snapshot`,
    );
  }

  // Non-existent order
  const missingClient = createMockClient({ order: null });
  assert.equal(await readCanonicalPurchaseSnapshot(missingClient, "NON-EXISTENT"), null);

  // Confirmed produces snapshot
  const confirmedClient = createMockClient({
    order: validConfirmedOrder,
    variants: validVariants,
  });
  const snapshot = await readCanonicalPurchaseSnapshot(confirmedClient, "LA-2026-0001");
  assert.notEqual(snapshot, null);
  assert.equal(snapshot?.publicCode, "LA-2026-0001");
});

test("Regression B: immutable finalized money derives strictly from snapshot without promotion recalculation", async () => {
  const client = createMockClient({
    order: validConfirmedOrder,
    variants: validVariants,
  });

  const snapshot = await readCanonicalPurchaseSnapshot(client, "LA-2026-0001");
  assert.notEqual(snapshot, null);

  const event = snapshot!.event;
  assert.equal(event.event, "purchase");
  assert.equal(event.ecommerce.currency, "VND");
  // Item price must be unitPriceVnd (399_000), not baseUnitPriceVnd (449_000)
  assert.equal(event.ecommerce.items[0].price, 399_000);
  assert.equal(event.ecommerce.value, 798_000);
  assert.equal(event.ecommerce.shipping, 30_000);
  assert.equal(event.ecommerce.la_total_vnd, 828_000);
});

test("Regression C: item identity uses external variation ID and snapshot quantity, never internal CUID", async () => {
  const client = createMockClient({
    order: validConfirmedOrder,
    variants: validVariants,
  });

  const snapshot = await readCanonicalPurchaseSnapshot(client, "LA-2026-0001");
  assert.notEqual(snapshot, null);

  type TestVariantItem = {
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
    item_variant?: string;
    item_group_id?: string;
  };

  const item = snapshot!.event.ecommerce.items[0] as TestVariantItem;
  // pancakeVariationId must be item_id
  assert.equal(item.item_id, "pan-var-101");
  assert.notEqual(item.item_id, "local-cuid-1");
  assert.equal(item.quantity, 2);
  assert.equal(item.item_name, "Áo Polo Pima");
  assert.equal(item.item_variant, "Trắng / L");
  assert.equal(item.item_group_id, "pan-prod-999");
});

test("Regression D: catalog deletion or enrichment loss does not suppress confirmed Purchase", async () => {
  // Empty variants array simulates deleted catalog mirrors
  const client = createMockClient({
    order: validConfirmedOrder,
    variants: [],
  });

  const snapshot = await readCanonicalPurchaseSnapshot(client, "LA-2026-0001");
  assert.notEqual(snapshot, null);

  type TestVariantItem = {
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
    item_variant?: string;
    item_group_id?: string;
  };

  const item = snapshot!.event.ecommerce.items[0] as TestVariantItem;
  assert.equal(item.item_id, "pan-var-101");
  assert.equal(item.item_name, "Áo Polo Pima");
  assert.equal(item.price, 399_000);
  assert.equal(item.quantity, 2);
  // item_group_id is omitted when optional enrichment is gone, but the event is intact
  assert.equal("item_group_id" in item, false);
  assert.equal(snapshot!.event.ecommerce.value, 798_000);
});

test("Regression E: repeat reads produce identical transaction and event identity without random tokens", async () => {
  const client = createMockClient({
    order: validConfirmedOrder,
    variants: validVariants,
  });

  const first = await readCanonicalPurchaseSnapshot(client, "LA-2026-0001");
  const second = await readCanonicalPurchaseSnapshot(client, "LA-2026-0001");

  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.deepEqual(first, second);
  assert.equal(first!.event.ecommerce.transaction_id, "LA-2026-0001");
  assert.equal(first!.event.ecommerce.event_id, "LA-2026-0001");
  assert.equal(second!.event.ecommerce.transaction_id, "LA-2026-0001");
  assert.equal(second!.event.ecommerce.event_id, "LA-2026-0001");
});

test("Regression F: tracking failure isolation ensures errors never leak or affect order confirmation", async () => {
  // DB error when loading order
  const errorClient = createMockClient({ throwOnOrder: true });
  const snapshot = await readCanonicalPurchaseSnapshotSafely(errorClient, "LA-2026-0001");
  assert.equal(snapshot, null);

  // Money exceeding safe integer fails closed safely
  const unsafeMoneyClient = createMockClient({
    order: {
      ...validConfirmedOrder,
      totalVnd: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(100),
    },
  });
  assert.equal(await readCanonicalPurchaseSnapshotSafely(unsafeMoneyClient, "LA-2026-0001"), null);

  // Inconsistent merchandise total fails closed safely
  const inconsistentClient = createMockClient({
    order: {
      ...validConfirmedOrder,
      merchandiseSubtotalVnd: BigInt(999_999), // does not equal 399_000 * 2
    },
  });
  assert.equal(await readCanonicalPurchaseSnapshotSafely(inconsistentClient, "LA-2026-0001"), null);
});
