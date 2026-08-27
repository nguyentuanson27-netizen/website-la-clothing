import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { voiceOverTest as test } from "@guidepup/playwright";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags.ts";

const HOST = "127.0.0.1";
const PORT = 3212;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-commerce-v3-${runId}@example.invalid`;
const password = "admin-commerce-v3-runtime-password-123";
const ordinaryExternalId = `admin-commerce-v3-ordinary-${runId}`;
const ordinarySlug = `admin-commerce-v3-ordinary-${runId}`;
const ordinaryName = `Admin Commerce Ordinary ${runId}`;
const staleExternalId = `admin-commerce-v3-stale-${runId}`;
const staleSlug = `admin-commerce-v3-stale-${runId}`;
const staleName = `Admin Commerce Stale ${runId}`;
const parentExternalId = `admin-commerce-v3-parent-${runId}`;

let server: ChildProcess | undefined;
let serverOutput = "";
let ordinaryProductId = "";
let staleProductId = "";
let staleVariantId = "";
let parentVariantId = "";
let stockedVariantIds: string[] = [];
let adminCookies: Array<{ name: string; value: string; url: string }> = [];

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

function cookiesFrom(headers: Headers) {
  return headers.getSetCookie().map((header) => {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("Better Auth returned a malformed Set-Cookie header");
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: BASE_URL,
    };
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js a11y server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Next.js a11y server\n${serverOutput}`);
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
  await prisma.user.deleteMany({ where: { email: adminEmail } });
  await prisma.productMirror.deleteMany({
    where: {
      pancakeProductId: { in: [ordinaryExternalId, staleExternalId, parentExternalId] },
    },
  });
}

function expectSpokenPhrase(spokenPhrase: string, expected: string, label: string) {
  expect(
    spokenPhrase.includes(expected),
    `${label}; captured VoiceOver output: ${JSON.stringify(spokenPhrase)}`,
  ).toBe(true);
}

test.beforeAll(async () => {
  await cleanupDatabase();
  const syncedAt = new Date();

  const ordinary = await prisma.productMirror.create({
    data: {
      pancakeProductId: ordinaryExternalId,
      slug: ordinarySlug,
      name: ordinaryName,
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  ordinaryProductId = ordinary.id;

  await prisma.variantMirror.createMany({
    data: Array.from({ length: 245 }, (_, index) => ({
      pancakeVariationId: `admin-commerce-v3-ordinary-${runId}-${index + 1}`,
      productId: ordinary.id,
      sku: `ORD-${String(index + 1).padStart(3, "0")}`,
      size: String(index + 1).padStart(3, "0"),
      isPresent: true,
      isActive: false,
      syncedAt,
    })),
  });
  const ordinaryVariants = await prisma.variantMirror.findMany({
    where: { productId: ordinary.id },
    orderBy: [{ color: "asc" }, { size: "asc" }, { id: "asc" }],
    select: { id: true, sku: true },
  });
  stockedVariantIds = ordinaryVariants.slice(240, 243).map((variant) => variant.id);
  await prisma.warehouseStock.createMany({
    data: stockedVariantIds.map((variantId, index) => ({
      variantId,
      pancakeWarehouseId: `admin-commerce-v3-wh-${index + 1}`,
      quantity: index + 1,
      syncedAt,
    })),
  });

  const stale = await prisma.productMirror.create({
    data: {
      pancakeProductId: staleExternalId,
      slug: staleSlug,
      name: staleName,
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  staleProductId = stale.id;
  const staleVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `admin-commerce-v3-stale-variant-${runId}`,
      productId: stale.id,
      sku: "STALE-M",
      size: "M",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  staleVariantId = staleVariant.id;

  const parent = await prisma.productMirror.create({
    data: {
      pancakeProductId: parentExternalId,
      slug: `admin-commerce-v3-parent-${runId}`,
      name: `Admin Commerce Parent ${runId}`,
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `admin-commerce-v3-parent-variant-${runId}`,
      productId: parent.id,
      sku: "PARENT-M",
      size: "M",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  parentVariantId = parentVariant.id;

  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.31" }),
    body: {
      name: "Admin Commerce V3 Runtime",
      email: adminEmail,
      password,
    },
  });
  adminCookies = cookiesFrom(headers);
  await prisma.user.update({ where: { email: adminEmail }, data: { role: "ADMIN" } });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
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

test("A4/A5 manages bounded ordinary variants and fresh catalog confirmation accessibly", async ({
  page,
  context,
  voiceOver,
}) => {
  await context.addCookies(adminCookies);
  const editorPath = `/admin/products/${encodeURIComponent(ordinaryProductId)}`;
  await page.goto(`${BASE_URL}${editorPath}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 2, name: "Biến thể website" })).toBeVisible();
  await expect(page.getByText("1–100 / 245", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bật sản phẩm + kích hoạt biến thể có hàng" })).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(accessibilityScan.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByRole("checkbox", { name: "Chọn tất cả biến thể trên trang này" }).check();
  await expect(page.getByText("Đã chọn 100 biến thể", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kích hoạt đã chọn" }).click();
  await page.waitForURL(
    (url) => url.pathname === editorPath && url.searchParams.get("variantSaved") === "1",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Đã cập nhật trạng thái biến thể website." }),
  ).toBeFocused();
  expect(
    await prisma.variantMirror.count({ where: { productId: ordinaryProductId, isActive: true } }),
  ).toBe(100);

  await page.getByRole("button", { name: "Trang biến thể tiếp theo" }).click();
  await expect(page.getByText("101–200 / 245", { exact: true })).toBeVisible();
  await expect(page.getByText(/Đã chọn \d+ biến thể/)).toHaveCount(0);
  await page.getByRole("button", { name: "Trang biến thể tiếp theo" }).click();
  await expect(page.getByText("201–245 / 245", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kích hoạt biến thể ORD-245" }).click();
  await page.waitForURL(
    (url) => url.pathname === editorPath && url.searchParams.get("variantSaved") === "1",
  );
  expect(
    (
      await prisma.variantMirror.findFirstOrThrow({
        where: { productId: ordinaryProductId, sku: "ORD-245" },
        select: { isActive: true },
      })
    ).isActive,
  ).toBe(true);

  await page.getByRole("button", { name: "Bật sản phẩm + kích hoạt biến thể có hàng" }).click();
  await expect(page.getByText(/3 biến thể có hàng/)).toBeVisible();
  await voiceOver.navigateToWebContent({ capture: false });
  const quickCapture = await voiceOver.capture(
    async () => {
      await page.getByRole("button", { name: "Xác nhận bật sản phẩm và biến thể có hàng" }).click();
      const success = page
        .getByRole("status")
        .filter({ hasText: "Đã bật sản phẩm và kích hoạt 3 biến thể có hàng." });
      await expect(success).toBeVisible();
      await expect(success).toBeFocused();
      await delay(500);
    },
    { capture: true },
  );
  expectSpokenPhrase(
    quickCapture.spokenPhrase,
    "Đã bật sản phẩm và kích hoạt 3 biến thể có hàng",
    "VoiceOver must announce the combined quick-action result",
  );
  expect(
    (
      await prisma.productMirror.findUniqueOrThrow({
        where: { id: ordinaryProductId },
        select: { isActive: true },
      })
    ).isActive,
  ).toBe(true);
  expect(
    await prisma.variantMirror.count({
      where: { id: { in: stockedVariantIds }, isActive: true },
    }),
  ).toBe(3);

  await page.getByRole("button", { name: "Tắt catalog" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã tắt catalog." })).toBeFocused();
  await page.getByRole("button", { name: "Bật catalog" }).click();
  await expect(page.getByText("Bật catalog không tự kích hoạt biến thể.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận bật catalog" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã bật catalog." })).toBeFocused();
});

test("A5 stale catalog confirmation reconfirms current composite publication risk with zero writes", async ({
  page,
  context,
}) => {
  await context.addCookies(adminCookies);
  const editorPath = `/admin/products/${encodeURIComponent(staleProductId)}`;
  await page.goto(`${BASE_URL}${editorPath}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: "Bật sản phẩm + kích hoạt biến thể có hàng" })).toBeVisible();
  await page.getByRole("button", { name: "Bật catalog" }).click();
  await expect(page.getByText("Bật catalog không tự kích hoạt biến thể.", { exact: true })).toBeVisible();
  await expect(page.getByText(/thành phần của set\/composite/)).toHaveCount(0);

  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId,
      componentVariantId: staleVariantId,
      quantity: 1,
      syncedAt: new Date(),
    },
  });

  await page.getByRole("button", { name: "Xác nhận bật catalog" }).click();
  const reconfirm = page
    .getByRole("status")
    .filter({ hasText: "Trạng thái cảnh báo đã thay đổi. Vui lòng xác nhận lại." });
  await expect(reconfirm).toBeVisible();
  await expect(reconfirm).toBeFocused();
  await expect(page.getByText(/thành phần của set\/composite/)).toBeVisible();
  expect(
    (
      await prisma.productMirror.findUniqueOrThrow({
        where: { id: staleProductId },
        select: { isActive: true },
      })
    ).isActive,
  ).toBe(false);

  await page.getByRole("button", { name: "Xác nhận bật catalog" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã bật catalog." })).toBeFocused();
  expect(
    (
      await prisma.productMirror.findUniqueOrThrow({
        where: { id: staleProductId },
        select: { isActive: true },
      })
    ).isActive,
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Bật sản phẩm + kích hoạt biến thể có hàng" }),
  ).toHaveCount(0);
});
