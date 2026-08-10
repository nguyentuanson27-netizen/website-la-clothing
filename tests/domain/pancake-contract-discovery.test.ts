import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import * as discoveryModule from "../../scripts/pancake-contract-discover.ts";

type FailureMessageFormatter = (error: unknown) => string;

function failureMessageFormatter(): FailureMessageFormatter {
  const candidate = Reflect.get(discoveryModule, "trustedDiscoveryFailureMessage");
  assert.equal(
    typeof candidate,
    "function",
    "trusted discovery must centralize its safe error-message boundary",
  );
  return candidate as FailureMessageFormatter;
}

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

test("trusted discovery only exposes exact internal budget messages, never prefix-matching external errors", () => {
  const formatFailure = failureMessageFormatter();
  const safeBudgetMessage = "Trusted JSON discovery exceeded the inspection budget";
  const spoofedSecret = "external-secret-that-must-not-be-echoed";

  assert.equal(formatFailure(new Error(safeBudgetMessage)), safeBudgetMessage);

  const spoofed = formatFailure(
    new Error(`Trusted JSON discovery exceeded ${spoofedSecret}`),
  );
  assert.match(spoofed, /failed without logging external scalar values/i);
  assert.equal(spoofed.includes(spoofedSecret), false);
});
