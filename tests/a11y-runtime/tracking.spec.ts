import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3215;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const TRUSTED_CLIENT_IP = "203.0.113.55";
const runId = `${Date.now()}-${process.pid}`;
const publicCode = `LA-tracking-${runId}`;
const guestPhone = "0901234567";

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js tracking server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/track-order`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for tracking server\n${serverOutput}`);
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
  await prisma.orderMirror.deleteMany({ where: { publicCode } });
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "order-track-client:" } },
        { id: { startsWith: "order-track-code:" } },
      ],
    },
  });
}

test.beforeAll(async () => {
  await cleanup();
  await prisma.orderMirror.create({
    data: {
      publicCode,
      state: "CONFIRMED",
      guestName: "Tracking Sensitive Name",
      guestPhone,
      provinceRef: "tracking-province",
      districtRef: "tracking-district",
      communeRef: "tracking-commune",
      addressDetail: "99 Tracking Sensitive Street",
      note: "tracking-sensitive-note",
      pancakeShopId: 920_007,
      pancakeOrderId: `tracking-pancake-${runId}`,
      pancakeSystemId: "123456",
      pancakeStatus: 6,
      pancakeStatusUpdatedAt: "2026-08-13T00:00:00Z",
      checkoutSnapshottedAt: new Date("2026-08-13T00:00:00Z"),
      merchandiseSubtotalVnd: 500_000n,
      shippingFeeVnd: 30_000n,
      totalVnd: 530_000n,
    },
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
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

test("guest tracking hides order existence on wrong proof and exposes only safe confirmed summary", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-ci-client-ip": TRUSTED_CLIENT_IP });
  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${BASE_URL}/track-order`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "TRA CỨU ĐƠN HÀNG" })).toBeVisible();

  await page.getByLabel("Mã đơn hàng").fill(publicCode);
  await page.getByLabel("Số điện thoại").fill("0900000000");
  await page.getByRole("button", { name: "Tra cứu đơn hàng" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Không tìm thấy đơn hàng khớp với thông tin đã nhập.",
  );

  await page.getByLabel("Số điện thoại").fill(guestPhone);
  await page.getByRole("button", { name: "Tra cứu đơn hàng" }).click();
  const status = page.getByRole("status").filter({ hasText: "Đã tiếp nhận" });
  await expect(status).toContainText(publicCode);
  await expect(status).toContainText("530.000 ₫");

  const pageText = await page.locator("body").innerText();
  for (const sensitive of [
    "Tracking Sensitive Name",
    "Tracking Sensitive Street",
    "tracking-sensitive-note",
    "tracking-pancake-",
    "123456",
  ]) {
    expect(pageText.includes(sensitive)).toBe(false);
  }

  const rateLimitRows = await prisma.rateLimit.findMany({
    where: {
      OR: [
        { id: { startsWith: "order-track-client:" } },
        { id: { startsWith: "order-track-code:" } },
      ],
    },
    select: { id: true },
  });
  expect(rateLimitRows.length).toBe(2);
  for (const { id } of rateLimitRows) {
    expect(id.includes(publicCode)).toBe(false);
    expect(id.includes(guestPhone)).toBe(false);
    expect(id.includes(TRUSTED_CLIENT_IP)).toBe(false);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  const accessibilityScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);
  expect(browserErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
