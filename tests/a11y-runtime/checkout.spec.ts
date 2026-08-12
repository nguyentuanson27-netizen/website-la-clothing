import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3214;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_007;

const runId = `${Date.now()}-${process.pid}`;
const productExternalId = `checkout-a11y-product-${runId}`;
const variationExternalId = `checkout-a11y-variation-${runId}`;
const warehouseExternalId = `checkout-a11y-warehouse-${runId}`;
const productSlug = `checkout-a11y-product-${runId}`;

let server: ChildProcess | undefined;
let serverOutput = "";
let cartId = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js checkout a11y server exited with ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js checkout a11y server\n${serverOutput}`);
}

async function waitForServerExit(timeoutMs: number) {
  if (!server || server.exitCode !== null) return true;
  return Promise.race([
    once(server, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  if (await waitForServerExit(5_000)) return;
  server.kill("SIGKILL");
  await waitForServerExit(5_000);
}

async function cleanupDatabase() {
  if (cartId) {
    await prisma.cart.deleteMany({ where: { id: cartId } });
  }
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: productExternalId },
  });
  await prisma.rateLimit.deleteMany({
    where: { id: { startsWith: "checkout-geo-client:" } },
  });
}

test.beforeAll(async () => {
  await cleanupDatabase();

  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: productExternalId,
      slug: productSlug,
      name: "Checkout A11y Product",
      syncedAt: new Date(),
      variants: {
        create: {
          pancakeVariationId: variationExternalId,
          pancakeRetailPrice: 500_000,
          color: "Đen",
          size: "M",
          syncedAt: new Date(),
          warehouseStocks: {
            create: {
              pancakeWarehouseId: warehouseExternalId,
              quantity: 5,
              syncedAt: new Date(),
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const variantId = product.variants[0]?.id;
  expect(variantId).toBeTruthy();

  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(Date.now() + 10 * 60_000),
      items: {
        create: {
          variantId: variantId!,
          quantity: 1,
        },
      },
    },
  });
  cartId = cart.id;

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      PANCAKE_API_KEY: "",
      PANCAKE_SHOP_ID: String(SHOP_ID),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", captureServerOutput);
  server.stderr?.on("data", captureServerOutput);
  await waitForServer();
});

test.afterAll(async () => {
  await stopServer();
  await cleanupDatabase();
  await prisma.$disconnect();
});

test("guest checkout is mobile-accessible and safely handles unavailable geo reads", async ({
  page,
  context,
}) => {
  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      browserErrors.push(`console: ${message.text()} @ ${location.url || "unknown"}`);
    }
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await context.addCookies([{ name: "la_cart", value: cartId, url: BASE_URL }]);
  await page.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1, name: "CHECKOUT" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Giao hàng COD" })).toBeVisible();
  await expect(page.getByLabel("Họ và tên")).toBeVisible();
  await expect(page.getByLabel("Số điện thoại")).toBeVisible();
  await expect(page.getByLabel("Tỉnh / Thành phố")).toBeVisible();
  await expect(page.getByLabel("Quận / Huyện")).toBeVisible();
  await expect(page.getByLabel("Phường / Xã")).toBeVisible();
  await expect(page.getByLabel("Số nhà, tên đường")).toBeVisible();
  await expect(
    page.getByText("Danh sách tỉnh/thành gồm cả dữ liệu địa giới cũ và mới từ Pancake."),
  ).toBeVisible();

  const geoStatus = page.getByRole("status").filter({
    hasText: "Chưa tải được danh sách tỉnh/thành. Vui lòng thử lại.",
  });
  await expect(geoStatus).toBeVisible();
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đặt hàng COD" })).toBeDisabled();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");

  const accessibilityScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);

  expect(
    browserErrors,
    `browser console errors; failed responses: ${JSON.stringify(failedResponses)}`,
  ).toEqual([]);
  expect(failedResponses).toEqual([]);
});
