import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { resolveStorefrontProductMedia } from "../../src/commerce/product-media.ts";

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };
type NextConfigLike = {
  headers?: () => Promise<HeaderRule[]>;
  images?: {
    remotePatterns?: {
      protocol?: string;
      hostname?: string;
      port?: string;
      pathname?: string;
    }[];
  };
};

async function loadNextConfig(): Promise<NextConfigLike> {
  const configUrl = pathToFileURL(resolve("next.config.mjs")).href;
  const { default: nextConfig } = (await import(configUrl)) as { default: NextConfigLike };
  return nextConfig;
}

test("next.config.mjs includes content.pancake.vn in CSP img-src", async () => {
  const nextConfig = await loadNextConfig();
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  const globalRule = rules.find(({ source }) => source === "/(.*)");
  assert.ok(globalRule);

  const headers = new Map(globalRule.headers.map(({ key, value }) => [key, value]));
  const csp = headers.get("Content-Security-Policy");
  assert.ok(csp);
  assert.match(csp, /img-src\s+[^;]*https:\/\/content\.pancake\.vn/);
});

test("next.config.mjs configures minimal images.remotePatterns for content.pancake.vn", async () => {
  const nextConfig = await loadNextConfig();
  assert.ok(nextConfig.images);
  assert.ok(Array.isArray(nextConfig.images.remotePatterns));

  const pattern = nextConfig.images.remotePatterns.find(
    (p) => p.hostname === "content.pancake.vn",
  );
  assert.ok(pattern, "Remote pattern for content.pancake.vn must be configured");
  assert.equal(pattern.protocol, "https");
  assert.equal(pattern.port, "");
  assert.equal(pattern.pathname, "/*/*/*/*/*.jpg");
});

test("resolveStorefrontProductMedia provides trusted primary image and gallery for cards and PDP", () => {
  const media = resolveStorefrontProductMedia({
    productName: "Classic Linen Shirt",
    primaryImageUrl: "https://content.pancake.vn/images/1/2/3/shirt.jpg",
    variantImageUrls: [
      ["https://content.pancake.vn/images/1/2/3/shirt.jpg", "https://content.pancake.vn/images/1/2/3/detail.jpg"],
    ],
  });

  assert.ok(media.primary);
  assert.equal(media.primary.url, "https://content.pancake.vn/images/1/2/3/shirt.jpg");
  assert.equal(media.primary.alt, "Classic Linen Shirt");
  assert.equal(media.gallery.length, 2);
  assert.equal(media.gallery[0]?.url, "https://content.pancake.vn/images/1/2/3/shirt.jpg");
  assert.equal(media.gallery[0]?.alt, "Classic Linen Shirt - Ảnh 1");
  assert.equal(media.gallery[1]?.url, "https://content.pancake.vn/images/1/2/3/detail.jpg");
  assert.equal(media.gallery[1]?.alt, "Classic Linen Shirt - Ảnh 2");
});

test("resolveStorefrontProductMedia gracefully provides empty media for missing or untrusted sources", () => {
  const media = resolveStorefrontProductMedia({
    productName: "Unreleased Pants",
    primaryImageUrl: "http://insecure.test/img.jpg",
    variantImageUrls: [["https://evil.com/bad.png"]],
  });

  assert.equal(media.primary, null);
  assert.deepEqual(media.gallery, []);
});

test("P3 parseTrustedProductImageUrl and P4 images.remotePatterns maintain identical trust contracts", async () => {
  const { parseTrustedProductImageUrl } = await import("../../src/commerce/product-media.ts");
  const nextConfig = await loadNextConfig();
  const pattern = nextConfig.images?.remotePatterns?.find(
    (p) => p.hostname === "content.pancake.vn",
  );
  assert.ok(pattern);

  // Lowercase .jpg is accepted by P3 and matches P4 remotePattern
  const validUrl = "https://content.pancake.vn/images/1/2/3/photo.jpg";
  assert.notEqual(parseTrustedProductImageUrl(validUrl), null);
  assert.equal(pattern.pathname, "/*/*/*/*/*.jpg");

  // Uppercase .JPG is rejected by both P3 and P4 case-sensitive pattern
  const uppercaseUrl = "https://content.pancake.vn/images/1/2/3/photo.JPG";
  assert.equal(parseTrustedProductImageUrl(uppercaseUrl), null);

  // Custom ports and unreviewed paths are rejected by both P3 and P4
  assert.equal(parseTrustedProductImageUrl("https://content.pancake.vn:8443/images/1/2/3/photo.jpg"), null);
  assert.equal(parseTrustedProductImageUrl("https://content.pancake.vn/arbitrary/photo.jpg"), null);
});

