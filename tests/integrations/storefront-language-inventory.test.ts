import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INVENTORY_FILE = "tests/integrations/storefront-language-inventory.test.ts";
const SOURCE_ROOTS = ["src", "tests"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const NON_BUYER_PREFIXES = [
  "src/generated/",
  "src/app/admin/",
  "tests/a11y-runtime/admin-",
] as const;

const PHRASE_TERMS = [
  "Shop the collection",
  "View collections",
  "Shop edit",
  "View all",
  "Explore collection",
  "Shop by category",
  "Add to Bag",
  "Giỏ hàng",
  "New arrivals",
  "New Arrivals",
  "Search products",
  "Customer / Account",
] as const;

const HEADING_TERMS = [
  "YOUR BAG",
  "SEARCH",
  "NEW ARRIVALS",
  "ACCOUNT",
  "COLLECTIONS",
  "SHOP",
] as const;

const EXACT_LABELS = [
  "Shop",
  "Collections",
  "Search",
  "Account",
  "Bag",
  "Cart",
] as const;

const NON_BUYER_TECHNICAL_HITS = new Set([
  "src/seo/structured-data.ts::Shop",
  "tests/domain/structured-data.test.ts::Shop",
  "tests/integrations/pancake-shops.test.ts::Shop",
]);

const PENDING_U1_BUYER_HITS = new Set([
  "src/app/cart/error.tsx::Bag",
  "src/app/cart/error.tsx::YOUR BAG",
  "src/app/cart/loading.tsx::Bag",
  "src/app/cart/page.tsx::YOUR BAG",
  "src/app/checkout/page.tsx::Giỏ hàng",
  "src/app/collections/page.tsx::Collections",
  "src/app/collections/page.tsx::Explore collection",
  "src/app/collections/page.tsx::COLLECTIONS",
  "src/app/collections/[slug]/page.tsx::Collections",
  "src/app/new-arrivals/page.tsx::New Arrivals",
  "src/app/new-arrivals/page.tsx::NEW ARRIVALS",
  "src/app/page.tsx::Shop the collection",
  "src/app/page.tsx::View collections",
  "src/app/page.tsx::Shop edit",
  "src/app/page.tsx::View all",
  "src/app/page.tsx::Shop by category",
  "src/app/search/page.tsx::Search",
  "src/app/search/page.tsx::Search products",
  "src/app/search/page.tsx::SEARCH",
  "src/app/shop/[slug]/page.tsx::Add to Bag",
  "src/app/shop/[slug]/page.tsx::Shop",
  "src/app/shop/loading.tsx::SHOP",
  "src/app/shop/page.tsx::Shop",
  "src/app/shop/page.tsx::SHOP",
  "src/commerce/checkout-submit-feedback.ts::Giỏ hàng",
  "src/components/commerce/product-purchase-panel.tsx::Add to Bag",
  "tests/a11y-runtime/checkout.spec.ts::YOUR BAG",
  "tests/a11y-runtime/discovery.spec.ts::SHOP",
  "tests/a11y-runtime/checkout.spec.ts::Giỏ hàng",
  "tests/a11y-runtime/editorial.spec.ts::View collections",
  "tests/a11y-runtime/editorial.spec.ts::Shop edit",
  "tests/a11y-runtime/editorial.spec.ts::Explore collection",
  "tests/a11y-runtime/editorial.spec.ts::COLLECTIONS",
  "tests/a11y-runtime/editorial.spec.ts::Add to Bag",
  "tests/a11y-runtime/storefront-commerce.spec.ts::Add to Bag",
  "tests/a11y-runtime/storefront-composite.spec.ts::Add to Bag",
  "tests/domain/catalog-listing-metadata.test.ts::Shop",
]);

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

function isExactBuyerLabelLine(line: string, label: string): boolean {
  const trimmed = line.trim();
  if (trimmed === label) return true;

  const quoted = `["'\\\`]${label}(?:\\s*↗)?["'\\\`]`;
  return new RegExp(
    `(?:>\\s*${label}(?:\\s*↗)?\\s*<|(?:label|title|name)\\s*:\\s*${quoted}|const\\s+[A-Z0-9_]+\\s*=\\s*${quoted})`,
  ).test(line);
}

function isEmbeddedBuyerLabelLine(line: string, label: string): boolean {
  if (label !== "Bag" && label !== "Cart") return false;

  const token = new RegExp("\\b" + label + "\\b");
  const jsxStart = line.indexOf(">");
  const jsxEnd = jsxStart >= 0 ? line.indexOf("<", jsxStart + 1) : -1;
  if (jsxStart >= 0 && jsxEnd > jsxStart) {
    const jsxText = line.slice(jsxStart + 1, jsxEnd);
    if (token.test(jsxText)) return true;
  }

  const copyKeys = [
    "title:",
    "label:",
    "message:",
    "description:",
    "placeholder=",
    "aria-label=",
  ];
  if (!copyKeys.some((key) => line.includes(key))) return false;

  const quotedSegments = line.match(/["'][^"']*["']/g) ?? [];
  return quotedSegments.some((segment) => token.test(segment));
}

function findHits(path: string, source: string): InventoryHit[] {
  const hits: InventoryHit[] = [];

  source.split("\n").forEach((line, index) => {
    for (const term of PHRASE_TERMS) {
      if (line.includes(term)) {
        hits.push({ path, line: index + 1, term, text: line.trim() });
      }
    }

    for (const term of HEADING_TERMS) {
      const trimmed = line.trim();
      const quoted = `["'\\\`]${term}["'\\\`]`;
      if (
        trimmed === term ||
        new RegExp(`(?:name|title|label)\\s*:\\s*${quoted}`).test(line)
      ) {
        hits.push({ path, line: index + 1, term, text: trimmed });
      }
    }

    for (const label of EXACT_LABELS) {
      if (
        isExactBuyerLabelLine(line, label) ||
        isEmbeddedBuyerLabelLine(line, label)
      ) {
        hits.push({ path, line: index + 1, term: label, text: line.trim() });
      }
    }
  });

  return hits;
}

test("U1 inventory catches embedded buyer labels without matching technical identifiers", () => {
  assert.deepEqual(
    findHits("fixture.tsx", '<p className="eyebrow">Shopping / Bag</p>'),
    [
      {
        path: "fixture.tsx",
        line: 1,
        term: "Bag",
        text: '<p className="eyebrow">Shopping / Bag</p>',
      },
    ],
  );
  assert.deepEqual(findHits("fixture.ts", "class CartError extends Error {}"), []);
  assert.deepEqual(findHits("fixture.ts", 'const query = "FROM \\"Cart\\"";'), []);
});

test("U1 inventory classifies every locked old buyer-copy literal before edits", async () => {
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map((root) => listSourceFiles(join(REPO_ROOT, root))),
    )
  ).flat();

  const hits: InventoryHit[] = [];
  for (const absolutePath of files) {
    const path = relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
    if (
      path === INVENTORY_FILE ||
      NON_BUYER_PREFIXES.some((prefix) => path.startsWith(prefix))
    ) {
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    hits.push(...findHits(path, source));
  }

  const unexpected = hits.filter(({ path, term }) => {
    const key = `${path}::${term}`;
    return !PENDING_U1_BUYER_HITS.has(key) && !NON_BUYER_TECHNICAL_HITS.has(key);
  });

  assert.deepEqual(
    unexpected,
    [],
    `Unclassified locked buyer-copy hits:\n${JSON.stringify(unexpected, null, 2)}`,
  );

  const observedPending = new Set(
    hits
      .map(({ path, term }) => `${path}::${term}`)
      .filter((key) => PENDING_U1_BUYER_HITS.has(key)),
  );

  assert.deepEqual(
    [...observedPending].sort(),
    [...PENDING_U1_BUYER_HITS].sort(),
    "The reviewed U1 buyer-functional/test-assertion inventory drifted",
  );
});
