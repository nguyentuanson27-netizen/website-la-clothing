import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3216;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_008;
const runId = `${Date.now()}-${process.pid}`;
const productExternalId = `editorial-runtime-product-${runId}`;
const productSlug = `editorial-runtime-product-${runId}`;
const productName = `AAA Editorial Runtime Coat ${runId}`;
const variantExternalId = `editorial-runtime-variant-${runId}`;
const warehouseExternalId = `editorial-runtime-warehouse-${runId}`;
const syncedAt = new Date("2026-08-13T00:00:00.000Z");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js editorial server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for editorial server\n${serverOutput}`);
}

async function waitForServerExit(timeoutMs: number) {
  if (!server || server.exitCode !== null) return true;
  return Promise.race([
    once(server, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    server = undefined;
    return;
  }
  server.kill("SIGTERM");
  if (!(await waitForServerExit(5_000))) {
    server.kill("SIGKILL");
    await waitForServerExit(5_000);
  }
  server = undefined;
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
}

async function expectRuntimePageClean(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  const accessibilityScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);
}

async function expectVisualFoundationTokens(page: import("@playwright/test").Page) {
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      shellGutter: style.getPropertyValue("--shell-gutter").trim(),
      shellMax: style.getPropertyValue("--shell-max").trim(),
      space4: style.getPropertyValue("--space-4").trim(),
      mediaProductRatio: style.getPropertyValue("--media-product-ratio").trim(),
      focusRingColor: style.getPropertyValue("--focus-ring-color").trim(),
    };
  });

  for (const value of Object.values(tokens)) {
    expect(value).not.toBe("");
  }
}

test.beforeAll(async () => {
  await cleanup();
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: productExternalId,
      slug: productSlug,
      name: productName,
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          editorialDescription: "Runtime editorial layer for the city uniform.",
        },
      },
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: variantExternalId,
      productId: product.id,
      color: "Ink",
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 1_290_000,
      pancakeRetailPriceAfterDiscount: 1_290_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: {
      variantId: variant.id,
      pancakeWarehouseId: warehouseExternalId,
      quantity: 2,
      syncedAt,
    },
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      LA_SHIPPING_FEE_VND: "25000",
      LA_FREE_SHIPPING_SUBTOTAL_VND: "750000",
      LA_FREE_SHIPPING_MIN_QUANTITY: "4",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", captureServerOutput);
  server.stderr?.on("data", captureServerOutput);
  await waitForServer();
});

test.afterAll(async () => {
  await stopServer();
  await cleanup();
  await prisma.$disconnect();
});

test("P8 storefront shell exposes responsive navigation, shared tokens, focus treatment and semantic footer", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  const shippingPromotion = page.getByRole("complementary", { name: "Miễn phí vận chuyển" });
  await expect(shippingPromotion).toBeVisible();
  await expect(shippingPromotion).toHaveClass(/promotion-shell/);
  await expect(shippingPromotion).toContainText(/Đơn trên 750\.000.*hoặc từ 4 sản phẩm\./);
  await expect(page.getByText("FALL / WINTER — NEW COLLECTION", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "LA Clothing — Trang chủ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bag", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Liên kết cuối trang" })).toBeVisible();
  await expectVisualFoundationTokens(page);

  const mobileMenu = page.locator("summary", { hasText: "Menu" });
  await expect(mobileMenu).toBeVisible();
  await mobileMenu.click();
  const mobileNavigation = page.getByRole("navigation", { name: "Điều hướng chính trên di động" });
  await expect(mobileNavigation.getByRole("link", { name: "Shop", exact: true })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Bỏ qua đến nội dung chính" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).not.toBe("0px");
  await expectRuntimePageClean(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
  await expect(page.locator(".mobile-nav")).toBeHidden();
  await expectRuntimePageClean(page);

  expect(browserErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test("homepage uses the configured local catalog and lookbook renders a complete mobile editorial story", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "QUIET FORM." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Shop edit" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: productName })).toBeVisible();
  await expect(page.getByRole("link", { name: `Xem ${productName}` })).toHaveAttribute(
    "href",
    `/shop/${productSlug}`,
  );
  await expect(page.getByText("Runtime editorial layer for the city uniform.")).toBeVisible();
  await expect(page.getByText("Relaxed Oxford Shirt")).toHaveCount(0);
  await expectRuntimePageClean(page);

  await page.goto(`${BASE_URL}/lookbook`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "CITY UNIFORM" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "MORNING / TRANSIT" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "LATE / RETURN" })).toBeVisible();
  await expect(page.getByText("A study in quiet utility.")).toBeVisible();
  await expectRuntimePageClean(page);
});

test("P8 homepage empty state uses the shared semantic state pattern", async ({ page }) => {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  const emptyState = page.locator('[data-ui-state="empty"]');
  await expect(emptyState).toBeVisible();
  await expect(
    emptyState.getByRole("heading", { level: 2, name: "The current edit is being prepared." }),
  ).toBeVisible();
  await expectRuntimePageClean(page);
});
