import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const APP_DIRECTORY = fileURLToPath(new URL("../../src/app/", import.meta.url));
const STOREFRONT_SOURCES = [
  {
    name: "homepage",
    url: new URL("../../src/app/page.tsx", import.meta.url),
  },
  {
    name: "header",
    url: new URL("../../src/components/layout/site-header.tsx", import.meta.url),
  },
  {
    name: "footer",
    url: new URL("../../src/components/layout/site-footer.tsx", import.meta.url),
  },
] as const;
const INTERNAL_PATH_LITERAL = /(["'`])(\/(?!\/)[^"'`\s]*)\1/g;

type RouteExists = (pathname: string) => Promise<boolean>;

async function routeExists(pathname: string): Promise<boolean> {
  const routeDirectory = pathname === "/"
    ? APP_DIRECTORY
    : join(APP_DIRECTORY, ...pathname.split("/").filter(Boolean));

  try {
    await access(join(routeDirectory, "page.tsx"));
    return true;
  } catch {
    return false;
  }
}

async function findMissingInternalLinks(
  source: string,
  exists: RouteExists = routeExists,
): Promise<string[]> {
  const hrefs = new Set<string>();

  for (const match of source.matchAll(INTERNAL_PATH_LITERAL)) {
    hrefs.add(match[2]);
  }

  const missing: string[] = [];
  for (const href of hrefs) {
    const pathname = new URL(href, "https://storefront.invalid").pathname;
    if (!(await exists(pathname))) {
      missing.push(href);
    }
  }

  return missing;
}

test("shared storefront literal internal links resolve to implemented App Router pages", async () => {
  const missingBySource: Record<string, string[]> = {};

  for (const source of STOREFRONT_SOURCES) {
    const content = await readFile(source.url, "utf8");
    const missing = await findMissingInternalLinks(content);

    if (missing.length > 0) {
      missingBySource[source.name] = missing;
    }
  }

  assert.deepEqual(missingBySource, {});
});

test("storefront link guard detects a missing internal destination", async () => {
  const source = `
    const valid = "/shop?category=shirts";
    const broken = "/products/missing-product";
  `;

  const missing = await findMissingInternalLinks(
    source,
    async (pathname) => pathname === "/shop",
  );

  assert.deepEqual(missing, ["/products/missing-product"]);
});
