import assert from "node:assert/strict";
import test from "node:test";

import { runCurrentPancakeCatalogAudit } from "../../src/integrations/pancake/catalog-audit-current.ts";

function currentScope(productIds: string[], variationIds: string[]) {
  return {
    productIds: new Set(productIds),
    variationIds: new Set(variationIds),
  };
}

test("current catalog audit excludes historical products and inactive variation media from trusted evidence", async () => {
  const pages: Record<number, unknown> = {
    1: {
      success: true,
      page_number: 1,
      page_size: 2,
      total_entries: 3,
      total_pages: 2,
      data: [
        {
          id: "variation-current",
          product_id: "product-current",
          images: ["https://media.current.example/products/100/current.jpg"],
          product: {
            note_product: "Approved current description",
            image: "https://media.current.example/products/100/hero.webp",
            categories: [{ id: 10 }],
          },
        },
        {
          id: "variation-inactive",
          product_id: "product-current",
          images: ["https://inactive-only.example/products/100/old.jpg"],
          product: {
            note_product: "Approved current description",
            image: "https://media.current.example/products/100/hero.webp",
            categories: [{ id: 10 }],
          },
        },
      ],
    },
    2: {
      success: true,
      page_number: 2,
      page_size: 2,
      total_entries: 3,
      total_pages: 2,
      data: [
        {
          id: "variation-historical",
          product_id: "product-historical",
          images: ["https://historical-only.example/archive/old.jpg"],
          product: {
            note_product: "Historical description",
            image: "https://historical-only.example/archive/hero.jpg",
            categories: [{ id: 11 }],
          },
        },
      ],
    },
  };

  const client = {
    async getJson(endpoint: string, query?: Readonly<Record<string, string | number | boolean>>) {
      if (endpoint.endsWith("/categories")) {
        return {
          success: true,
          data: [
            { id: 10, text: "Current", nodes: [] },
            { id: 11, text: "Historical", nodes: [] },
          ],
        };
      }
      return pages[Number(query?.page_number)];
    },
  };

  const report = await runCurrentPancakeCatalogAudit({
    client,
    shopId: 4741464,
    currentScope: currentScope(["product-current"], ["variation-current"]),
    pageSize: 2,
  });

  assert.deepEqual(report.source, { rawVariationEntries: 3 });
  assert.equal(report.currentCatalog.products.total, 1);
  assert.equal(report.currentCatalog.products.withNoteProduct, 1);
  assert.deepEqual(report.currentCatalog.variations, { total: 1 });
  assert.deepEqual(report.currentCatalog.images.origins, [
    {
      scheme: "https",
      hostname: "media.current.example",
      referenceCount: 2,
      pathShapes: ["/products/:id/:file.jpg", "/products/:id/:file.webp"],
    },
  ]);
  assert.equal(report.currentCatalog.categories.assignedProductCount, 1);
  assert.equal(report.currentCatalog.categories.knownAssignmentReferenceCount, 1);
  assert.equal(report.currentCatalog.categories.unknownAssignmentReferenceCount, 0);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("historical-only.example"), false);
  assert.equal(serialized.includes("inactive-only.example"), false);
  assert.equal(serialized.includes("Approved current description"), false);
  assert.equal(serialized.includes("Historical description"), false);
});

test("current catalog audit fails closed on duplicate raw variation identity across pages", async () => {
  const pages: Record<number, unknown> = {
    1: {
      success: true,
      page_number: 1,
      page_size: 2,
      total_entries: 4,
      total_pages: 2,
      data: [
        { id: "variation-a", product_id: "product-a", images: [], product: { note_product: null, image: null, categories: [] } },
        { id: "variation-b", product_id: "product-b", images: [], product: { note_product: null, image: null, categories: [] } },
      ],
    },
    2: {
      success: true,
      page_number: 2,
      page_size: 2,
      total_entries: 4,
      total_pages: 2,
      data: [
        { id: "variation-b", product_id: "product-b", images: [], product: { note_product: null, image: null, categories: [] } },
        { id: "variation-c", product_id: "product-c", images: [], product: { note_product: null, image: null, categories: [] } },
      ],
    },
  };

  const client = {
    async getJson(endpoint: string, query?: Readonly<Record<string, string | number | boolean>>) {
      if (endpoint.endsWith("/categories")) return { success: true, data: [] };
      return pages[Number(query?.page_number)];
    },
  };

  await assert.rejects(
    () => runCurrentPancakeCatalogAudit({
      client,
      shopId: 4741464,
      currentScope: currentScope(["product-a"], ["variation-a"]),
      pageSize: 2,
    }),
    /duplicate variation identity/i,
  );
});

test("current catalog audit fails closed when active mirror scope is missing from Pancake source", async () => {
  const client = {
    async getJson(endpoint: string) {
      if (endpoint.endsWith("/categories")) return { success: true, data: [] };
      return {
        success: true,
        page_number: 1,
        page_size: 100,
        total_entries: 1,
        total_pages: 1,
        data: [
          { id: "variation-a", product_id: "product-a", images: [], product: { note_product: null, image: null, categories: [] } },
        ],
      };
    },
  };

  await assert.rejects(
    () => runCurrentPancakeCatalogAudit({
      client,
      shopId: 4741464,
      currentScope: currentScope(["product-missing"], ["variation-missing"]),
    }),
    /current storefront scope does not match pancake source/i,
  );
});
