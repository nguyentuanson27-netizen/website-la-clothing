import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPancakeStockProbe,
  PancakeStockProbeError,
} from "../../src/integrations/pancake/stock-probe.ts";

const payload = {
  data: [
    {
      id: "variation-1",
      display_id: "DISPLAY-1",
      barcode: "BAR-1",
      variations_warehouses: [
        {
          warehouse_id: "warehouse-a",
          actual_remain_quantity: 4,
          remain_quantity: 3,
          total_quantity: 6,
          pending_quantity: 1,
          waiting_quantity: 2,
          returning_quantity: 0,
        },
        {
          warehouse_id: "warehouse-b",
          actual_remain_quantity: 5,
          remain_quantity: 5,
          total_quantity: 5,
          pending_quantity: 0,
          waiting_quantity: 0,
          returning_quantity: 1,
        },
      ],
    },
    {
      id: "variation-2",
      display_id: "DISPLAY-2",
      barcode: "BAR-2",
      variations_warehouses: [],
    },
  ],
};

test("stock probe resolves one variation by id/display_id/barcode and totals all warehouses", () => {
  for (const selector of ["variation-1", "DISPLAY-1", "BAR-1"]) {
    const result = buildPancakeStockProbe(payload, selector);

    assert.equal(result.variation.id, "variation-1");
    assert.equal(result.warehouses.length, 2);
    assert.deepEqual(result.totals, {
      actual_remain_quantity: 9,
      remain_quantity: 8,
      total_quantity: 11,
      pending_quantity: 1,
      waiting_quantity: 2,
      returning_quantity: 1,
    });
  }
});

test("stock probe fails closed instead of treating null quantity as zero", () => {
  assert.throws(
    () =>
      buildPancakeStockProbe(
        {
          data: [
            {
              id: "variation-null",
              variations_warehouses: [
                {
                  warehouse_id: "warehouse-a",
                  actual_remain_quantity: null,
                  remain_quantity: 3,
                  total_quantity: 3,
                  pending_quantity: 0,
                  waiting_quantity: 0,
                  returning_quantity: 0,
                },
              ],
            },
          ],
        },
        "variation-null",
      ),
    PancakeStockProbeError,
  );
});

test("stock probe fails closed for malformed external quantity data", () => {
  assert.throws(
    () =>
      buildPancakeStockProbe(
        {
          data: [
            {
              id: "variation-bad",
              variations_warehouses: [
                {
                  warehouse_id: "warehouse-a",
                  actual_remain_quantity: "4",
                  remain_quantity: 4,
                  total_quantity: 4,
                  pending_quantity: 0,
                  waiting_quantity: 0,
                  returning_quantity: 0,
                },
              ],
            },
          ],
        },
        "variation-bad",
      ),
    PancakeStockProbeError,
  );
});

test("stock probe requires exactly one matching variation", () => {
  assert.throws(() => buildPancakeStockProbe(payload, "missing"), /exactly one/i);

  assert.throws(
    () =>
      buildPancakeStockProbe(
        {
          data: [
            { id: "same", variations_warehouses: [] },
            { display_id: "same", variations_warehouses: [] },
          ],
        },
        "same",
      ),
    /exactly one/i,
  );
});
