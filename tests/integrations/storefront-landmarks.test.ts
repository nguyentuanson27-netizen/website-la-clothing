import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const APP_DIRECTORY = fileURLToPath(new URL("../../src/app/", import.meta.url));
const ROOT_LAYOUT = new URL("../../src/app/layout.tsx", import.meta.url);
const SITE_HEADER = new URL(
  "../../src/components/layout/site-header.tsx",
  import.meta.url,
);
const ROUTE_WRAPPER_FILENAMES = new Set([
  "page.tsx",
  "layout.tsx",
  "loading.tsx",
  "error.tsx",
  "template.tsx",
  "default.tsx",
  "not-found.tsx",
]);
const EXCLUDED_PUBLIC_ROUTE_DIRECTORIES = new Set(["admin", "api"]);
const MAIN_OPENING_TAG = /<main(?:\s|>)/g;
const MAIN_CONTENT_ID = /\bid\s*=\s*["']main-content["']/g;
const SKIP_TARGET = /\bhref\s*=\s*["']#main-content["']/g;

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

async function listBuyerRouteWrappers(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const wrappers: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        directory === APP_DIRECTORY &&
        EXCLUDED_PUBLIC_ROUTE_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }
      wrappers.push(...(await listBuyerRouteWrappers(absolutePath)));
      continue;
    }

    if (
      entry.isFile() &&
      ROUTE_WRAPPER_FILENAMES.has(entry.name) &&
      absolutePath !== fileURLToPath(ROOT_LAYOUT)
    ) {
      wrappers.push(absolutePath);
    }
  }

  return wrappers.sort();
}

test("root layout solely owns the main-content page landmark", async () => {
  const source = await readFile(ROOT_LAYOUT, "utf8");

  assert.equal(countMatches(source, MAIN_OPENING_TAG), 1);
  assert.equal(countMatches(source, MAIN_CONTENT_ID), 1);
});

test("every buyer-facing route wrapper leaves the page-level main landmark to root layout", async () => {
  const offenders: Record<string, { main: number; mainContentId: number }> = {};

  for (const path of await listBuyerRouteWrappers(APP_DIRECTORY)) {
    const source = await readFile(path, "utf8");
    const main = countMatches(source, MAIN_OPENING_TAG);
    const mainContentId = countMatches(source, MAIN_CONTENT_ID);

    if (main > 0 || mainContentId > 0) {
      offenders[relative(APP_DIRECTORY, path)] = { main, mainContentId };
    }
  }

  assert.deepEqual(offenders, {});
});

test("shared skip link points once to the root-owned main-content target", async () => {
  const source = await readFile(SITE_HEADER, "utf8");

  assert.equal(countMatches(source, SKIP_TARGET), 1);
});
