import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("trusted Pancake contract discovery refuses to run in CI", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/pancake-contract-discover.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        PANCAKE_API_KEY: "must-not-be-read",
        PANCAKE_SHOP_ID: "1",
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trusted Pancake contract discovery refuses CI execution/i);
  assert.equal(result.stderr.includes("must-not-be-read"), false);
});
