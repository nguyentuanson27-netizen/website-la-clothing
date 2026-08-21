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
