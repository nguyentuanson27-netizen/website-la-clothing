import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("reviewed-contract verifier safely localizes configuration failure without exposing secrets", () => {
  const apiKey = "must-not-be-printed";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/pancake-contract-shape.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PANCAKE_API_KEY: "",
        PANCAKE_SHOP_ID: "",
        LEAK_SENTINEL: apiKey,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /stage=configuration reason=configuration/i,
  );
  assert.equal(result.stderr.includes(apiKey), false);
  assert.equal(result.stdout.includes(apiKey), false);
});
