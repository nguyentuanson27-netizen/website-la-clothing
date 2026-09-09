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
  assert.match(
    runbook,
    /docker compose exec app node -e 'if \(process\.env\.LA_PROMOTION_ACTIVATION_ENABLED !== "false"\) process\.exit\(1\)'/,
    "the runbook must verify the recreated app received the disabled gate value",
  );
  assert.doesNotMatch(
    runbook,
    /```bash\s*docker compose restart app\s*```/,
    "restart must not be the executable command documented after an environment change",
  );
});
