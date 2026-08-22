import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePancakeCompositeSnapshot,
  type PancakeCompositeSnapshot,
} from "../../src/integrations/pancake/composite-contract.ts";

function parentRow({
  id = "set-m",
  productId = "set-product",
  edges = [
    componentEdge({ id: "edge-shirt", parentId: "set-m", componentId: "shirt-m", componentProductId: "shirt-product" }),
    componentEdge({ id: "edge-pants", parentId: "set-m", componentId: "pants-m", componentProductId: "pants-product" }),
  ],
}: {
  id?: string;
  productId?: string;
  edges?: unknown[];
} = {}) {
  return {
    id,
    product_id: productId,
    is_composite: true,
    composite_products: edges,
  };
}

function childRow({
  id,
  productId,
}: {
  id: string;
  productId: string;
}) {
  return {
    id,
    product_id: productId,
    is_composite: false,
    composite_products: [],
  };
}

function componentEdge({
  id,
  parentId,
  componentId,
  componentProductId,
  quantity = 1,
  shopId = 47,
}: {
  id: string;
  parentId: string;
  componentId: string;
  componentProductId: string;
  quantity?: number;
  shopId?: number;
}) {
  return {
    id,
    variation_id: parentId,
    component_id: componentId,
    quantity,
    shop_id: shopId,
    measure_info: null,
    component: {
      id: componentId,
      product_id: componentProductId,
      is_composite: false,
    },
  };
}

function validChildren() {
  return [
    childRow({ id: "shirt-m", productId: "shirt-product" }),
    childRow({ id: "pants-m", productId: "pants-product" }),
  ];
}

test("Pancake composite contract parses direct parent-to-component variation edges", () => {
  const snapshot = parsePancakeCompositeSnapshot({
    shopId: 47,
    parentEntries: [parentRow()],
    childEntries: validChildren(),
  });

  assert.deepEqual(snapshot, {
    parentVariationIds: ["set-m"],
    componentVariationIds: ["pants-m", "shirt-m"],
    edges: [
      { parentVariationId: "set-m", componentVariationId: "pants-m", quantity: 1 },
      { parentVariationId: "set-m", componentVariationId: "shirt-m", quantity: 1 },
    ],
  } satisfies PancakeCompositeSnapshot);
});

test("Pancake composite contract rejects identity, shop, nesting, quantity, duplicate, and unresolved-component contradictions", () => {
  const invalidCases: Array<{ parents: unknown[]; children?: unknown[] }> = [
    {
      parents: [
        parentRow({
          edges: [
            componentEdge({
              id: "edge-1",
              parentId: "different-parent",
              componentId: "shirt-m",
              componentProductId: "shirt-product",
            }),
          ],
        }),
      ],
    },
    {
      parents: [
        parentRow({
          edges: [
            componentEdge({
              id: "edge-1",
              parentId: "set-m",
              componentId: "shirt-m",
              componentProductId: "shirt-product",
              shopId: 48,
            }),
          ],
        }),
      ],
    },
    {
      parents: [
        parentRow({
          edges: [
            {
              ...componentEdge({
                id: "edge-1",
                parentId: "set-m",
                componentId: "shirt-m",
                componentProductId: "shirt-product",
              }),
              component: {
                id: "shirt-m",
                product_id: "shirt-product",
                is_composite: true,
              },
            },
          ],
        }),
      ],
    },
    {
      parents: [
        parentRow({
          edges: [
            componentEdge({
              id: "edge-1",
              parentId: "set-m",
              componentId: "shirt-m",
              componentProductId: "shirt-product",
              quantity: 0.5,
            }),
          ],
        }),
      ],
    },
    {
      parents: [
        parentRow({
          edges: [
            componentEdge({
              id: "edge-1",
              parentId: "set-m",
              componentId: "shirt-m",
              componentProductId: "shirt-product",
            }),
            componentEdge({
              id: "edge-2",
              parentId: "set-m",
              componentId: "shirt-m",
              componentProductId: "shirt-product",
            }),
          ],
        }),
      ],
    },
    {
      parents: [
        parentRow({
          edges: [
            componentEdge({
              id: "edge-1",
              parentId: "set-m",
              componentId: "missing-m",
              componentProductId: "missing-product",
            }),
          ],
        }),
      ],
    },
  ];

  for (const invalid of invalidCases) {
    assert.throws(
      () =>
        parsePancakeCompositeSnapshot({
          shopId: 47,
          parentEntries: invalid.parents,
          childEntries: invalid.children ?? validChildren(),
        }),
      /composite contract/i,
    );
  }
});

test("Pancake composite contract rejects overlapping parent/child roles and nested child edges", () => {
  assert.throws(
    () =>
      parsePancakeCompositeSnapshot({
        shopId: 47,
        parentEntries: [parentRow()],
        childEntries: [
          {
            id: "set-m",
            product_id: "set-product",
            is_composite: false,
            composite_products: [],
          },
          ...validChildren(),
        ],
      }),
    /composite contract/i,
  );

  assert.throws(
    () =>
      parsePancakeCompositeSnapshot({
        shopId: 47,
        parentEntries: [parentRow()],
        childEntries: [
          {
            ...childRow({ id: "shirt-m", productId: "shirt-product" }),
            composite_products: [{}],
          },
          childRow({ id: "pants-m", productId: "pants-product" }),
        ],
      }),
    /composite contract/i,
  );
});
