import assert from "node:assert/strict";
import test from "node:test";

import { resolveEffectiveApparelFacts } from "../../src/commerce/merchant-apparel-facts.ts";

test("M3 a partial persisted override object fails closed instead of inheriting missing fields", () => {
  assert.deepEqual(
    resolveEffectiveApparelFacts({ gender: "unisex" } as never),
    {
      ok: false,
      reason: "APPAREL_FACT_UNRESOLVED",
      fields: ["ageGroup", "condition"],
    },
  );
});

test("M3 an explicit null remains legitimate inheritance while undefined is malformed persistence", () => {
  assert.deepEqual(
    resolveEffectiveApparelFacts({ gender: "unisex", ageGroup: null, condition: undefined } as never),
    {
      ok: false,
      reason: "APPAREL_FACT_UNRESOLVED",
      fields: ["condition"],
    },
  );
});
