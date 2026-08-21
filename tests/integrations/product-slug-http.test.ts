import test from "node:test";

const SHOP_ID = "920007";

test("historical product slug returns exact 301 while current/unknown remain 200/404", async () => {
  const previousShopId = process.env.PANCAKE_SHOP_ID;
  process.env.PANCAKE_SHOP_ID = SHOP_ID;

  try {
    await import("../../scripts/product-slug-http-smoke.ts");
  } finally {
    if (previousShopId === undefined) {
      delete process.env.PANCAKE_SHOP_ID;
    } else {
      process.env.PANCAKE_SHOP_ID = previousShopId;
    }
  }
});

test("search exposure HTTP policy is fail-closed on staging and canonical when explicitly enabled", async () => {
  await import("../../scripts/search-exposure-http-smoke.ts");
});

test("P13 PDP metadata renders canonical social head tags with a working branded fallback image", async () => {
  await import("../../scripts/product-metadata-http-smoke.ts");
});

test("P14 PDP renders factual site, product, offer, and breadcrumb JSON-LD", async () => {
  await import("../../scripts/structured-data-http-smoke.ts");
});
