import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("promotion kill-switch runbook recreates the app container after env changes", () => {
  const runbook = readFileSync(
    new URL("../../docs/operations/promotion-rollback-runbook.md", import.meta.url),
    "utf8",
  );

  assert.match(
    runbook,
    /docker compose up -d --no-deps --force-recreate app/,
    "changing .env.production must recreate app so the new kill-switch value reaches the container",
  );
  assert.doesNotMatch(
    runbook,
    /docker compose restart app/,
    "restart preserves the existing container environment and must not be documented for env changes",
  );
});
