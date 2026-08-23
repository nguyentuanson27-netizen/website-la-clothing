import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3220;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_012;
const runId = `${Date.now()}-${process.pid}`;
const parentExternalId = `composite-browser-parent-${runId}`;
const parentSlug = `composite-browser-set-${runId}`;
const parentName = `Composite Browser Set ${runId}`;
const parentVariantExternalId = `composite-browser-parent-variant-${runId}`;
const componentExternalId = `composite-browser-component-${runId}`;
const componentSlug = `composite-browser-shirt-${runId}`;
const componentName = `Áo lẻ Browser ${runId}`;
const componentVariantExternalId = `composite-browser-component-variant-${runId}`;
const syncedAt = new Date("2026-08-23T00:00:00.000Z");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js composite storefront server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/shop/${parentSlug}`, { redirect: "manual" });
      if (response.status === 200) {
        const text = await response.text();
        if (text.includes(parentName)) return;
      }
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for composite storefront server\n${serverOutput}`);
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
  await prisma.cartItem.deleteMany({
    where: { variant: { product: { pancakeShopId: SHOP_ID } } },
  });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
}

async function assertPageQuality(page: import("@playwright/test").Page) {
  const overflowReport = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(overflowReport.documentWidth).toBeLessThanOrEqual(overflowReport.viewportWidth);

  const accessibilityScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);
}

test.beforeAll(async () => {
  await cleanup();

  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: parentExternalId,
      slug: parentSlug,
      name: parentName,
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          status: "PUBLISHED",
          editorialDescription: "Composite browser regression parent product.",
        },
      },
    },
  });
  const component = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: componentExternalId,
      slug: componentSlug,
      name: componentName,
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: parentVariantExternalId,
      productId: parent.id,
      color: null,
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 790_000,
      pancakeRetailPriceAfterDiscount: 790_000,
      syncedAt,
    },
  });
  const componentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: componentVariantExternalId,
      productId: component.id,
      color: null,
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 390_000,
      pancakeRetailPriceAfterDiscount: 390_000,
      syncedAt,
    },
  });

  await prisma.warehouseStock.createMany({
    data: [
      {
        variantId: parentVariant.id,
        pancakeWarehouseId: `composite-browser-parent-warehouse-${runId}`,
        quantity: 0,
        syncedAt,
      },
      {
        variantId: componentVariant.id,
        pancakeWarehouseId: `composite-browser-component-warehouse-${runId}`,
        quantity: 2,
        syncedAt,
      },
    ],
  });
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: componentVariant.id,
      quantity: 1,
      syncedAt,
    },
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      APP_DOMAIN: `${HOST}:${PORT}`,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
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

test("composite parent keeps parent-only schema while inactive component can be bought through the parent PDP", async ({
  page,
}) => {
  const directComponent = await page.request.get(`${BASE_URL}/shop/${componentSlug}`);
  expect(directComponent.status()).toBe(404);

  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${BASE_URL}/shop/${parentSlug}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: parentName })).toBeVisible();
  await expect(page.getByRole("group", { name: "Loại" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Set" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: componentName })).toBeEnabled();

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(jsonLd).not.toBeNull();
  const structured = JSON.parse(jsonLd!);
  expect(structured["@graph"][0].offers).toEqual({
    "@type": "Offer",
    url: `${BASE_URL}/shop/${parentSlug}`,
    priceCurrency: "VND",
    price: 790_000,
    availability: "https://schema.org/OutOfStock",
  });

  const addToBag = page.getByRole("button", { name: "Add to Bag" });
  await expect(addToBag).toBeDisabled();
  await page.getByRole("radio", { name: componentName }).check();
  await expect(page.getByRole("group", { name: "Màu" })).toHaveCount(0);
  await page.getByRole("radio", { name: "M" }).check();
  await expect(addToBag).toBeEnabled();
  await assertPageQuality(page);

  await addToBag.click();
  await expect(page.getByRole("status")).toContainText("Đã thêm sản phẩm vào túi.");

  await page.goto(`${BASE_URL}/cart`, { waitUntil: "networkidle" });
  const cartLine = page.getByRole("article");
  await expect(cartLine.getByRole("heading", { name: componentName })).toBeVisible();
  await expect(page.getByRole("link", { name: componentName })).toHaveCount(0);
  await expect(cartLine.getByText("M", { exact: true })).toBeVisible();
  await expect(cartLine.getByText(/390\.000.*₫/)).toBeVisible();
  await assertPageQuality(page);

  const checkoutLink = page.getByRole("link", { name: "Tiến hành đặt hàng" });
  await expect(checkoutLink).toBeVisible();
  await checkoutLink.click();
  await expect(page).toHaveURL(`${BASE_URL}/checkout`);
  await expect(page.getByRole("heading", { level: 1, name: "CHECKOUT" })).toBeVisible();
  await assertPageQuality(page);

  expect(browserErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
