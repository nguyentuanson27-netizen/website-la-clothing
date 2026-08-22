import assert from "node:assert/strict";
import test from "node:test";

import { readCompositeParentVariationCount } from "../../scripts/p17-live-catalog-acceptance.ts";

const MALFORMED_COUNT = /composite parent count payload is malformed/i;

function clientWithPayload(payload: unknown) {
  return {
    async getJson() {
      return payload;
    },
  };
}

test("P17 composite parent preflight rejects contradictory count, page, and row envelopes", async () => {
  const contradictoryPayloads: readonly unknown[] = [
    {
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 0,
      total_pages: 1,
      data: [{}],
    },
    {
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 1,
      total_pages: 1,
      data: [],
    },
    {
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 2,
      total_pages: 1,
      data: [{}],
    },
    {
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 1,
      total_pages: 1,
      data: ["not-a-row-object"],
    },
    {
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 0,
      total_pages: 2,
      data: [],
    },
  ];

  for (const payload of contradictoryPayloads) {
    await assert.rejects(
      readCompositeParentVariationCount(clientWithPayload(payload), 47),
      MALFORMED_COUNT,
    );
  }
});

test("P17 composite parent preflight accepts either reviewed empty-page convention", async () => {
  for (const totalPages of [0, 1] as const) {
    const count = await readCompositeParentVariationCount(
      clientWithPayload({
        success: true,
        page_number: 1,
        page_size: 1,
        total_entries: 0,
        total_pages: totalPages,
        data: [],
      }),
      47,
    );

    assert.equal(count, 0);
  }
});
