import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT_LAYOUT = new URL("../../src/app/layout.tsx", import.meta.url);
const SITE_HEADER = new URL(
  "../../src/components/layout/site-header.tsx",
  import.meta.url,
);
const BUYER_ROUTE_WRAPPERS = [
  {
    name: "/collections/[slug]",
    url: new URL("../../src/app/collections/[slug]/page.tsx", import.meta.url),
  },
  {
    name: "/shop/[slug]",
    url: new URL("../../src/app/shop/[slug]/page.tsx", import.meta.url),
  },
  {
    name: "/cart",
    url: new URL("../../src/app/cart/page.tsx", import.meta.url),
  },
  {
    name: "/checkout",
    url: new URL("../../src/app/checkout/page.tsx", import.meta.url),
  },
  {
    name: "/checkout/success",
    url: new URL("../../src/app/checkout/success/page.tsx", import.meta.url),
  },
  {
    name: "/track-order",
    url: new URL("../../src/app/track-order/page.tsx", import.meta.url),
  },
] as const;

const MAIN_OPENING_TAG = /<main(?:\s|>)/g;
const MAIN_CONTENT_ID = /\bid\s*=\s*["']main-content["']/g;
const SKIP_TARGET = /\bhref\s*=\s*["']#main-content["']/g;

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

test("root layout solely owns the main-content page landmark", async () => {
  const source = await readFile(ROOT_LAYOUT, "utf8");

  assert.equal(countMatches(source, MAIN_OPENING_TAG), 1);
  assert.equal(countMatches(source, MAIN_CONTENT_ID), 1);
});

test("buyer route wrappers do not create page-level main landmarks", async () => {
  const offenders: Record<string, { main: number; mainContentId: number }> = {};

  for (const route of BUYER_ROUTE_WRAPPERS) {
    const source = await readFile(route.url, "utf8");
    const main = countMatches(source, MAIN_OPENING_TAG);
    const mainContentId = countMatches(source, MAIN_CONTENT_ID);

    if (main > 0 || mainContentId > 0) {
      offenders[route.name] = { main, mainContentId };
    }
  }

  assert.deepEqual(offenders, {});
});

test("shared skip link points once to the root-owned main-content target", async () => {
  const source = await readFile(SITE_HEADER, "utf8");

  assert.equal(countMatches(source, SKIP_TARGET), 1);
});
