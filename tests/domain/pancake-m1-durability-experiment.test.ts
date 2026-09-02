import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_REQUIRED_MESSAGE,
  assertM1ExperimentEnvironment,
  CI_REFUSAL_MESSAGE,
  EXPECTED_A132_PRODUCT_ID,
  EXPECTED_SHOP_ID,
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

test("restoreA132Product verifies restoration and fails if verification mismatches", async () => {
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
        display_id: "A132-S",
        barcode: null,
        retail_price: 429000,
        is_hidden: false,
        fields: [{ name: "Size", value: "S" }],
      },
    ],
  };

  // Fake fetcher returns mismatch on GET verification
  const mismatchFetcher: typeof fetch = async (input, init) => {
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    // GET verification returns corrupted custom_id
    return new Response(
      JSON.stringify({
        data: {
          id: EXPECTED_A132_PRODUCT_ID,
          name: "ÁO A132",
          custom_id: "WRONG_ID",
          note_product: "",
          variations: [{ id: "var-1", display_id: "A132-S" }],
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
