import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_REQUIRED_MESSAGE,
  assertM1ExperimentEnvironment,
  CI_REFUSAL_MESSAGE,
  EXPECTED_A132_PRODUCT_ID,
  EXPECTED_SHOP_ID,
  fetchFullPancakeCatalog,
  resolveA132Target,
  restoreA132Product,
  type ProductA132Snapshot,
} from "../../scripts/pancake-m1-durability-experiment.ts";
import { PancakeClient } from "../../src/integrations/pancake/client.ts";

test("assertM1ExperimentEnvironment refuses execution in CI environment", () => {
  for (const flag of ["1", "true", "yes", "on", "True", "TRUE"]) {
    assert.throws(
      () => assertM1ExperimentEnvironment({ CI: flag }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, CI_REFUSAL_MESSAGE);
        return true;
      },
    );
    assert.throws(
      () => assertM1ExperimentEnvironment({ GITHUB_ACTIONS: flag }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, CI_REFUSAL_MESSAGE);
        return true;
      },
    );
  }
});

test("assertM1ExperimentEnvironment requires explicit operator approval", () => {
  assert.throws(
    () => assertM1ExperimentEnvironment({}),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, APPROVAL_REQUIRED_MESSAGE);
      return true;
    },
  );

  assert.throws(
    () => assertM1ExperimentEnvironment({ M1_EXPERIMENT_APPROVED: "other-target" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, APPROVAL_REQUIRED_MESSAGE);
      return true;
    },
  );
});

test("assertM1ExperimentEnvironment enforces shop ID 1635185058", () => {
  assert.throws(
    () =>
      assertM1ExperimentEnvironment({
        M1_EXPERIMENT_APPROVED: "a132",
        PANCAKE_SHOP_ID: "9999999",
      }),
    /scoped exclusively to shop 1635185058/i,
  );

  assert.throws(
    () =>
      assertM1ExperimentEnvironment({
        M1_EXPERIMENT_APPROVED: "a132",
        PANCAKE_SHOP_ID: "invalid",
      }),
    /positive safe integer/i,
  );
});

test("assertM1ExperimentEnvironment passes with valid env or CLI args", () => {
  const resEnv = assertM1ExperimentEnvironment({
    M1_EXPERIMENT_APPROVED: "a132",
    PANCAKE_SHOP_ID: "1635185058",
  });
  assert.equal(resEnv.shopId, 1635185058);
  assert.equal(resEnv.approvedTarget, "a132");

  const resCli = assertM1ExperimentEnvironment(
    { PANCAKE_SHOP_ID: "1635185058" },
    ["--product=a132", "--allow-production-mutation"],
  );
  assert.equal(resCli.shopId, 1635185058);
  assert.equal(resCli.approvedTarget, "a132");
});

test("resolveA132Target fails closed when no products match a132", async () => {
  const fakeFetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new PancakeClient({ apiKey: "test-key", fetcher: fakeFetcher });

  await assert.rejects(
    () => resolveA132Target(client, EXPECTED_SHOP_ID),
    /Target product a132 could not be resolved/i,
  );
});

test("resolveA132Target fails closed when multiple products match a132", async () => {
  const fakeFetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: EXPECTED_A132_PRODUCT_ID, name: "ÁO A132", custom_id: "A132" },
          { id: "other-id", name: "ÁO A132 SECOND", custom_id: "A132-2" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const client = new PancakeClient({ apiKey: "test-key", fetcher: fakeFetcher });

  await assert.rejects(
    () => resolveA132Target(client, EXPECTED_SHOP_ID),
    /Target product a132 resolution is ambiguous/i,
  );
});

test("restoreA132Product restores original custom_id when custom_id != display_id and fails if display_id was sent instead", async () => {
  let capturedRestorePayload: {
    product: {
      variations: { custom_id?: string; display_id?: string }[];
    };
  } | null = null;
  const snapshot: ProductA132Snapshot = {
    id: EXPECTED_A132_PRODUCT_ID,
    name: "ÁO A132",
    custom_id: "A132",
    display_id: "145",
    note_product: "",
    categoryIds: [1],
    tags: [2],
    productAttributes: [],
    variations: [
      {
        id: "var-1",
        custom_id: "ORIGINAL-CUSTOM-S",
        display_id: "A132-S",
        barcode: null,
        retail_price: 429000,
        is_hidden: false,
        fields: [{ name: "Size", value: "S" }],
      },
    ],
  };

  const fetcher: typeof fetch = async (input, init) => {
    if (init?.method === "PUT") {
      capturedRestorePayload = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    // Fresh GET returns the restored variation with matching custom_id and display_id
    return new Response(
      JSON.stringify({
        data: {
          id: EXPECTED_A132_PRODUCT_ID,
          name: "ÁO A132",
          custom_id: "A132",
          note_product: "",
          variations: [
            {
              id: "var-1",
              custom_id: "ORIGINAL-CUSTOM-S",
              display_id: "A132-S",
            },
          ],
        },
      }),
      { status: 200 },
    );
  };

  const client = new PancakeClient({ apiKey: "test-key", fetcher });
  const result = await restoreA132Product(client, EXPECTED_SHOP_ID, snapshot);

  assert.equal(result.restored, true);
  assert.equal(result.verifiedFieldsMatch, true);
  assert.ok(capturedRestorePayload);
  const payload = capturedRestorePayload as unknown as {
    product: { variations: { custom_id?: string; display_id?: string }[] };
  };
  // Prove that restore payload sent custom_id: "ORIGINAL-CUSTOM-S", and NOT display_id: "A132-S"
  assert.equal(
    payload.product.variations[0]?.custom_id,
    "ORIGINAL-CUSTOM-S",
  );
  assert.notEqual(
    payload.product.variations[0]?.custom_id,
    "A132-S",
  );
});

test("restoreA132Product fails closed when fresh GET returns wrong custom_id", async () => {
  const snapshot: ProductA132Snapshot = {
    id: EXPECTED_A132_PRODUCT_ID,
    name: "ÁO A132",
    custom_id: "A132",
    display_id: "145",
    note_product: "",
    categoryIds: [1],
    tags: [2],
    productAttributes: [],
    variations: [
      {
        id: "var-1",
        custom_id: "ORIGINAL-CUSTOM-S",
        display_id: "A132-S",
        barcode: null,
        retail_price: 429000,
        is_hidden: false,
        fields: [{ name: "Size", value: "S" }],
      },
    ],
  };

  // Fake fetcher returns mismatched custom_id on GET verification (e.g. corrupting back to display_id)
  const mismatchFetcher: typeof fetch = async (input, init) => {
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        data: {
          id: EXPECTED_A132_PRODUCT_ID,
          name: "ÁO A132",
          custom_id: "A132",
          note_product: "",
          variations: [
            {
              id: "var-1",
              custom_id: "A132-S", // Mismatch: did not restore ORIGINAL-CUSTOM-S!
              display_id: "A132-S",
            },
          ],
        },
      }),
      { status: 200 },
    );
  };

  const client = new PancakeClient({ apiKey: "test-key", fetcher: mismatchFetcher });
  await assert.rejects(
    () => restoreA132Product(client, EXPECTED_SHOP_ID, snapshot),
    /FATAL: Restoration verification failed/i,
  );
});

test("fetchFullPancakeCatalog fetches all pages and verifies completeness", async () => {
  const page1Items = Array.from({ length: 100 }, (_, i) => ({ id: `var-${i + 1}`, display_id: `V-${i + 1}` }));
  const page2Items = Array.from({ length: 50 }, (_, i) => ({ id: `var-${i + 101}`, display_id: `V-${i + 101}` }));

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const pageNumber = url.searchParams.get("page_number");
    if (pageNumber === "1") {
      return new Response(
        JSON.stringify({ data: page1Items, total_pages: 2, total_entries: 150 }),
        { status: 200 },
      );
    }
    if (pageNumber === "2") {
      return new Response(
        JSON.stringify({ data: page2Items, total_pages: 2, total_entries: 150 }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: [], total_pages: 2, total_entries: 150 }), { status: 200 });
  };

  const client = new PancakeClient({ apiKey: "test-key", fetcher });
  const result = await fetchFullPancakeCatalog(client, EXPECTED_SHOP_ID, { pageSize: 100 });

  assert.equal(result.totalPages, 2);
  assert.equal(result.totalEntries, 150);
  assert.equal(result.allVariations.length, 150);
  assert.equal(result.pagesTraversed, 2);
});

test("fetchFullPancakeCatalog fails closed on pagination drift mid-traversal", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const pageNumber = url.searchParams.get("page_number");
    if (pageNumber === "1") {
      return new Response(
        JSON.stringify({ data: [{ id: "v1" }], total_pages: 2, total_entries: 2 }),
        { status: 200 },
      );
    }
    // Drift: total_pages changed to 3!
    return new Response(
      JSON.stringify({ data: [{ id: "v2" }], total_pages: 3, total_entries: 3 }),
      { status: 200 },
    );
  };

  const client = new PancakeClient({ apiKey: "test-key", fetcher });
  await assert.rejects(
    () => fetchFullPancakeCatalog(client, EXPECTED_SHOP_ID),
    /Pagination drift detected/i,
  );
});

test("fetchFullPancakeCatalog fails closed on collected count mismatch", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ id: "v1" }], total_pages: 1, total_entries: 50 }),
      { status: 200 },
    );

  const client = new PancakeClient({ apiKey: "test-key", fetcher });
  await assert.rejects(
    () => fetchFullPancakeCatalog(client, EXPECTED_SHOP_ID),
    /Pagination count mismatch/i,
  );
});
