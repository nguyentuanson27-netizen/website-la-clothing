import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INVENTORY_FILE = "tests/integrations/storefront-language-inventory.test.ts";
const SOURCE_ROOTS = ["src", "tests"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const PHRASE_TERMS = [
  "Shop the collection",
  "View collections",
  "Shop edit",
  "View all",
  "Explore collection",
  "Shop by category",
  "Add to Bag",
  "YOUR BAG",
  "Giỏ hàng",
  "NEW ARRIVALS",
  "New arrivals",
  "New Arrivals",
  "Search products",
] as const;

const EXACT_LABELS = [
  "Shop",
  "Collections",
  "Search",
  "Account",
  "Bag",
  "Cart",
] as const;

type InventoryHit = {
  path: string;
  line: number;
  term: string;
  text: string;
};

function extensionOf(path: string): string {
  const match = path.match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extensionOf(path))) continue;
    files.push(path);
  }

  return files;
}

function exactLabelPattern(label: string): RegExp {
  return new RegExp(
    `(?:["'\\\`]${label}(?:\\s*↗)?["'\\\`]|>\\s*${label}(?:\\s*↗)?\\s*<)`,
  );
}

function findHits(path: string, source: string): InventoryHit[] {
  const hits: InventoryHit[] = [];

  source.split("\n").forEach((line, index) => {
    for (const term of PHRASE_TERMS) {
      if (line.includes(term)) {
        hits.push({ path, line: index + 1, term, text: line.trim() });
      }
    }

    for (const label of EXACT_LABELS) {
      if (exactLabelPattern(label).test(line)) {
        hits.push({ path, line: index + 1, term: label, text: line.trim() });
      }
    }
  });

  return hits;
}

test("U1 inventory captures every locked old buyer-copy literal before edits", async () => {
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map((root) => listSourceFiles(join(REPO_ROOT, root))),
    )
  ).flat();

  const hits: InventoryHit[] = [];
  for (const absolutePath of files) {
    const path = relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
    if (path === INVENTORY_FILE) continue;
    const source = await readFile(absolutePath, "utf8");
    hits.push(...findHits(path, source));
  }

  hits.sort((left, right) =>
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.term.localeCompare(right.term),
  );

  assert.deepEqual(
    hits,
    [],
    `Locked old buyer-copy inventory is not empty:\n${JSON.stringify(hits, null, 2)}`,
  );
});
