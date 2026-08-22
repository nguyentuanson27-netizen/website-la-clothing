import assert from "node:assert/strict";
import test from "node:test";

import { fetchPancakeCompositeSnapshot } from "../../src/integrations/pancake/composite-pages.ts";

type Query = Readonly<Record<string, string | number | boolean>>;

function edge({
  id,
  parentId,
  componentId,
  componentProductId,
}: {
  id: string;
  parentId: string;
  componentId: string;
  componentProductId: string;
}) {
  return {
    id,
    variation_id: parentId,
    component_id: componentId,
    quantity: 1,
    shop_id: 47,
    measure_info: null,
    component: {
      id: componentId,
      product_id: componentProductId,
      is_composite: false,
    },
  };
}

function page({
  pageNumber,
  pageSize = 100,
  totalEntries,
  totalPages,
  data,
}: {
  pageNumber: number;
  pageSize?: number;
  totalEntries: number;
  totalPages: number;
  data: unknown[];
}) {
  return {
    success: true,
    page_number: pageNumber,
    page_size: pageSize,
    total_entries: totalEntries,
    total_pages: totalPages,
    data,
  };
}

test("composite traversal requests documented parent/children roles and parses one complete snapshot", async () => {
  const calls: Array<{ endpoint: string; query: Query }> = [];
  const client = {
    async getJson(endpoint: string, query: Query) {
      calls.push({ endpoint, query });
      if (query.included_composite === "parent") {
        return page({
          pageNumber: 1,
          totalEntries: 1,
          totalPages: 1,
          data: [
            {
              id: "set-m",
              product_id: "set-product",
              is_composite: true,
              composite_products: [
                edge({
                  id: "edge-shirt",
                  parentId: "set-m",
                  componentId: "shirt-m",
                  componentProductId: "shirt-product",
                }),
              ],
            },
          ],
        });
      }

      return page({
        pageNumber: 1,
        totalEntries: 1,
        totalPages: 1,
        data: [
          {
            id: "shirt-m",
            product_id: "shirt-product",
            is_composite: false,
            composite_products: [],
          },
        ],
      });
    },
  };

  const snapshot = await fetchPancakeCompositeSnapshot({ client, shopId: 47 });

  assert.deepEqual(calls, [
    {
      endpoint: "/shops/47/products/variations",
      query: { page_number: 1, page_size: 100, included_composite: "parent" },
    },
    {
      endpoint: "/shops/47/products/variations",
      query: { page_number: 1, page_size: 100, included_composite: "children" },
    },
  ]);
  assert.deepEqual(snapshot.parentIdentities, [
    { variationId: "set-m", productId: "set-product" },
  ]);
  assert.deepEqual(snapshot.componentIdentities, [
    { variationId: "shirt-m", productId: "shirt-product" },
  ]);
  assert.deepEqual(snapshot.edges, [
    { parentVariationId: "set-m", componentVariationId: "shirt-m", quantity: 1 },
  ]);
});

test("composite traversal rejects contradictory pagination before returning a snapshot", async () => {
  const client = {
    async getJson(_endpoint: string, query: Query) {
      if (query.included_composite === "parent") {
        return page({ pageNumber: 1, totalEntries: 0, totalPages: 1, data: [{}] });
      }
      return page({ pageNumber: 1, totalEntries: 0, totalPages: 0, data: [] });
    },
  };

  await assert.rejects(
    fetchPancakeCompositeSnapshot({ client, shopId: 47 }),
    /composite pagination/i,
  );
});

test("composite traversal validates all pages and stable pagination before parsing", async () => {
  const parentRows = Array.from({ length: 101 }, (_, index) => ({
    id: `set-${index + 1}`,
    product_id: `set-product-${index + 1}`,
    is_composite: true,
    composite_products: [
      edge({
        id: `edge-${index + 1}`,
        parentId: `set-${index + 1}`,
        componentId: `child-${index + 1}`,
        componentProductId: `child-product-${index + 1}`,
      }),
    ],
  }));
  const childRows = Array.from({ length: 101 }, (_, index) => ({
    id: `child-${index + 1}`,
    product_id: `child-product-${index + 1}`,
    is_composite: false,
    composite_products: [],
  }));

  const client = {
    async getJson(_endpoint: string, query: Query) {
      const rows = query.included_composite === "parent" ? parentRows : childRows;
      const pageNumber = Number(query.page_number);
      const offset = (pageNumber - 1) * 100;
      return page({
        pageNumber,
        totalEntries: rows.length,
        totalPages: 2,
        data: rows.slice(offset, offset + 100),
      });
    },
  };

  const snapshot = await fetchPancakeCompositeSnapshot({ client, shopId: 47 });
  assert.equal(snapshot.parentVariationIds.length, 101);
  assert.equal(snapshot.componentVariationIds.length, 101);
  assert.equal(snapshot.parentIdentities.length, 101);
  assert.equal(snapshot.componentIdentities.length, 101);
  assert.equal(snapshot.edges.length, 101);
});
