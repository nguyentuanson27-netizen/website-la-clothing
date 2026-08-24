import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BUYER_AXE_TAGS } from "../a11y-runtime/axe-tags.ts";

const A11Y_DIRECTORY = fileURLToPath(new URL("../a11y-runtime/", import.meta.url));
const ADMIN_ONLY_AXE_SPECS = new Set([
  "admin-collections.spec.ts",
  "admin-editor.spec.ts",
]);
const REQUIRED_BUYER_AXE_SPECS = new Set([
  "checkout.spec.ts",
  "collection-landing.spec.ts",
  "discovery.spec.ts",
  "editorial.spec.ts",
  "p18-final-qa.spec.ts",
  "storefront-commerce.spec.ts",
  "storefront-composite.spec.ts",
  "storefront-media.spec.ts",
  "tracking.spec.ts",
]);

async function listAxeSpecs(): Promise<Array<{ name: string; source: string }>> {
  const entries = await readdir(A11Y_DIRECTORY, { withFileTypes: true });
  const specs: Array<{ name: string; source: string }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".spec.ts")) continue;
    const path = join(A11Y_DIRECTORY, entry.name);
    const source = await readFile(path, "utf8");
    if (!source.includes("AxeBuilder")) continue;
    specs.push({ name: basename(path), source });
  }

  return specs.sort((left, right) => left.name.localeCompare(right.name));
}

test("buyer Axe tag set keeps WCAG coverage and opts into best-practice landmarks", () => {
  assert.deepEqual(BUYER_AXE_TAGS, [
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "best-practice",
  ]);
});

test("every buyer-facing Axe spec uses the shared best-practice tag set", async () => {
  const axeSpecs = await listAxeSpecs();
  const buyerSpecs = axeSpecs.filter(({ name }) => !ADMIN_ONLY_AXE_SPECS.has(name));
  const buyerSpecNames = new Set(buyerSpecs.map(({ name }) => name));

  for (const required of REQUIRED_BUYER_AXE_SPECS) {
    assert.equal(
      buyerSpecNames.has(required),
      true,
      `Missing required buyer-facing Axe inventory entry: ${required}`,
    );
  }

  const offenders = buyerSpecs
    .filter(({ source }) => !source.includes("BUYER_AXE_TAGS"))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    `Buyer-facing Axe specs must use BUYER_AXE_TAGS: ${offenders.join(", ")}`,
  );
});
