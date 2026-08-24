import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BUYER_AXE_TAGS } from "../a11y-runtime/axe-tags.ts";

const A11Y_DIRECTORY = fileURLToPath(new URL("../a11y-runtime/", import.meta.url));
const REQUIRED_BUYER_AXE_SPECS = new Set([
  "checkout.spec.ts",
  "collection-landing.spec.ts",
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

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
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

test("U0b.1 required buyer Axe scans use the shared best-practice tag set", async () => {
  const axeSpecs = await listAxeSpecs();
  const axeSpecsByName = new Map(axeSpecs.map((spec) => [spec.name, spec.source]));
  const offenders: string[] = [];

  for (const required of REQUIRED_BUYER_AXE_SPECS) {
    const source = axeSpecsByName.get(required);
    assert.ok(source, `Missing required buyer-facing Axe inventory entry: ${required}`);

    const builderCount = countMatches(source, /new\s+AxeBuilder\s*\(/g);
    const withTagsCount = countMatches(source, /\.withTags\s*\(/g);
    const sharedTagsCount = countMatches(
      source,
      /\.withTags\s*\(\s*BUYER_AXE_TAGS\s*\)/g,
    );

    if (
      builderCount === 0 ||
      withTagsCount !== builderCount ||
      sharedTagsCount !== builderCount
    ) {
      offenders.push(
        `${required} (builders=${builderCount}, withTags=${withTagsCount}, shared=${sharedTagsCount})`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Required buyer-facing AxeBuilder scans must use BUYER_AXE_TAGS: ${offenders.join(", ")}`,
  );
});
