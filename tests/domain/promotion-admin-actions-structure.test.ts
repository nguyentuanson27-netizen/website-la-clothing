import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionsSource = readFileSync(
  new URL("../../src/app/admin/promotions/actions.ts", import.meta.url),
  "utf8",
);

function exportedActionSource(name: string): string {
  const marker = `export async function ${name}`;
  const start = actionsSource.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = actionsSource.indexOf("\nexport async function ", start + marker.length);
  return actionsSource.slice(start, next === -1 ? actionsSource.length : next);
}

test("P5b create/edit parsers stay behind the Server Action admin authorization boundary", () => {
  const boundaryStart = actionsSource.indexOf("async function runPromotionOperation(");
  const boundaryEnd = actionsSource.indexOf("\nfunction campaignIdFrom", boundaryStart);
  assert.notEqual(boundaryStart, -1);
  assert.notEqual(boundaryEnd, -1);

  const boundarySource = actionsSource.slice(boundaryStart, boundaryEnd);
  const authorizeAt = boundarySource.indexOf("session = await requireCurrentAdmin();");
  const operationAt = boundarySource.indexOf("const outcome = await operation(session);");
  assert.ok(authorizeAt >= 0, "shared mutation boundary must authorize the current admin");
  assert.ok(
    operationAt > authorizeAt,
    "the mutation callback must not run until requireCurrentAdmin has succeeded",
  );

  for (const name of ["createPromotionAction", "editPromotionAction"] as const) {
    const source = exportedActionSource(name);
    assert.match(
      source,
      // The leading argument is the observability operation label. It is matched as a literal so a
      // request-derived value here would fail this assertion rather than ride along unnoticed.
      /const outcome = await runPromotionOperation\("[a-z-]+", (?:async )?\(session\) => \{\s*const parseResult = parseCampaignFormInput\(formData\);/,
      `${name} must parse FormData inside the authorized callback, never before it`,
    );
  }
});

test("P5b promotion target search is pinned to the configured Pancake shop", () => {
  const source = exportedActionSource("searchPromotionTargetsAction");
  assert.match(source, /const shopId = readPancakeShopId\(\);/);
  assert.match(source, /searchTargetProducts\(\{ shopId, search \}\)/);
  assert.match(source, /searchTargetVariants\(\{ shopId, search \}\)/);
});
