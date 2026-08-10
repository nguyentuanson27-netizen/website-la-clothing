import assert from "node:assert/strict";
import test from "node:test";

import {
  PancakeCatalogContractError,
  parsePancakeCatalogVariations,
  parsePancakeWarehouses,
} from "../../src/integrations/pancake/catalog-contract.ts";
import {
  assertReviewedPancakeContractKeysConfigured,
  REVIEWED_PANCAKE_CONTRACT_KEYS,
} from "../../src/integrations/pancake/reviewed-contract-keys.ts";

const productVariationsPayload = {
  success: true,
  page_number: 1,
  page_size: 100,
  total_entries: 1,
  total_pages: 1,
  data: [
    {
      id: "variation-1",
      product_id: "product-1",
      display_id: "DISPLAY-1",
      barcode: "BAR-1",
      fields: [
        { id: "field-color", keyValue: "color", name: "Color", value: "Black" },
        { id: "field-size", keyValue: "size", name: "Size", value: "M" },
      ],
      images: ["https://example.test/product-1.jpg"],
      is_hidden: false,
      is_locked: false,
      retail_price: 500_000,
      retail_price_after_discount: 450_000,
      product: {
        id: "product-1",
        name: "Test Shirt",
      },
      variations_warehouses: [
        { warehouse_id: "warehouse-a", remain_quantity: 3 },
        { warehouse_id: "warehouse-b", remain_quantity: 4 },
      ],
      ignored_external_field: "must-not-cross-the-adapter",
    },
  ],
};

const warehousesPayload = {
  success: true,
  data: [
    {
      id: "warehouse-a",
      name: "Warehouse A",
      allow_create_order: true,
      address: null,
    },
  ],
};

test("catalog contract maps reviewed storefront fields, pagination, and all-warehouse sellable stock", () => {
  const result = parsePancakeCatalogVariations(productVariationsPayload);

  assert.deepEqual(result, {
    pageNumber: 1,
    pageSize: 100,
    totalEntries: 1,
    totalPages: 1,
    variations: [
      {
        id: "variation-1",
        productId: "product-1",
        displayId: "DISPLAY-1",
        barcode: "BAR-1",
        fields: [
          { id: "field-color", keyValue: "color", name: "Color", value: "Black" },
          { id: "field-size", keyValue: "size", name: "Size", value: "M" },
        ],
        imageUrls: ["https://example.test/product-1.jpg"],
        isHidden: false,
        isLocked: false,
        retailPrice: 500_000,
        retailPriceAfterDiscount: 450_000,
        product: { id: "product-1", name: "Test Shirt" },
        warehouseStocks: [
          { warehouseId: "warehouse-a", remainQuantity: 3 },
          { warehouseId: "warehouse-b", remainQuantity: 4 },
        ],
        sellableStock: 7,
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes("ignored_external_field"), false);
});

test("catalog contract rejects malformed pagination needed for bounded full-catalog sync", () => {
  const malformed = structuredClone(productVariationsPayload);
  malformed.total_pages = Number.NaN;

  assert.throws(() => parsePancakeCatalogVariations(malformed), /pagination/i);
});

test("catalog contract fails closed on malformed sellable quantity instead of coercing it", () => {
  const malformed = structuredClone(productVariationsPayload);
  malformed.data[0]!.variations_warehouses[0]!.remain_quantity = "3" as unknown as number;

  assert.throws(() => parsePancakeCatalogVariations(malformed), PancakeCatalogContractError);
});

test("catalog contract rejects duplicate warehouse rows before aggregation", () => {
  const duplicate = structuredClone(productVariationsPayload);
  duplicate.data[0]!.variations_warehouses.push({
    warehouse_id: "warehouse-a",
    remain_quantity: 1,
  });

  assert.throws(() => parsePancakeCatalogVariations(duplicate), /duplicate warehouse/i);
});

test("catalog contract validates the minimal warehouse identity surface", () => {
  assert.deepEqual(parsePancakeWarehouses(warehousesPayload), [
    { id: "warehouse-a", name: "Warehouse A", allowCreateOrder: true },
  ]);
});

test("reviewed Pancake allowlists are configured with the live-discovered catalog keys", () => {
  assert.doesNotThrow(() => assertReviewedPancakeContractKeysConfigured());

  for (const requiredKey of [
    "data",
    "success",
    "page_number",
    "page_size",
    "total_entries",
    "total_pages",
    "id",
    "product_id",
    "display_id",
    "barcode",
    "fields",
    "images",
    "is_hidden",
    "is_locked",
    "retail_price",
    "retail_price_after_discount",
    "product",
    "variations_warehouses",
    "warehouse_id",
    "remain_quantity",
  ]) {
    assert.equal(REVIEWED_PANCAKE_CONTRACT_KEYS.productVariations.includes(requiredKey), true);
  }

  for (const requiredKey of ["data", "success", "id", "name", "allow_create_order"]) {
    assert.equal(REVIEWED_PANCAKE_CONTRACT_KEYS.warehouses.includes(requiredKey), true);
  }
});
