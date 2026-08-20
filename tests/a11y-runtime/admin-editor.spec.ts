import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { voiceOverTest as test } from "@guidepup/playwright";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3212;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-a11y-${runId}@example.invalid`;
const password = "admin-a11y-runtime-password-123";
const productExternalId = `admin-a11y-product-${runId}`;
const productSlug = `admin-a11y-product-${runId}`;
const editedProductSlug = `ao-so-mi-admin-${runId}`;
const productName = `Admin A11y Product ${runId}`;
const sourceDescription = "Read-only Pancake source context for editorial decisions.";

let server: ChildProcess | undefined;
let serverOutput = "";
let productId = "";
let adminCookies: Array<{ name: string; value: string; url: string }> = [];

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

function cookiesFrom(headers: Headers) {
  return headers.getSetCookie().map((header) => {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) {
      throw new Error("Better Auth returned a malformed Set-Cookie header");
    }
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
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: productExternalId } });
}

function expectSpokenPhrase(spokenPhrase: string, expected: string, label: string) {
  expect(
    spokenPhrase.includes(expected),
    `${label}; captured VoiceOver output: ${JSON.stringify(spokenPhrase)}`,
  ).toBe(true);
}

// Runtime-only test: it intentionally drives a real browser and macOS VoiceOver.
test.beforeAll(async () => {
  await cleanupDatabase();

  const product = await prisma.productMirror.create({
    data: {
      pancakeProductId: productExternalId,
      slug: productSlug,
      name: productName,
      sourceDescription,
      syncedAt: new Date(),
    },
  });
  productId = product.id;

  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.21" }),
    body: {
      name: "Admin A11y Runtime",
      email: adminEmail,
      password,
    },
  });
  adminCookies = cookiesFrom(headers);
  expect(adminCookies.length).toBeGreaterThan(0);

  await prisma.user.update({
    where: { email: adminEmail },
    data: { role: "ADMIN" },
  });

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

test("admin editor keeps Pancake source read-only and announces publication save/error with VoiceOver", async ({
  page,
  context,
  voiceOver,
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

  await context.addCookies(adminCookies);
  const editorPath = `/admin/products/${encodeURIComponent(productId)}`;
  await page.goto(`${BASE_URL}${editorPath}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Nguồn mô tả từ Pancake" })).toBeVisible();
  await expect(page.getByText(sourceDescription, { exact: true })).toBeVisible();
  await expect(page.locator('[name="sourceDescription"]')).toHaveCount(0);
  const slugTextbox = page.getByRole("textbox", { name: "Slug sản phẩm", exact: true });
  await expect(slugTextbox).toHaveValue(productSlug);
  await expect(page.getByRole("button", { name: "Lưu slug" })).toBeVisible();
  await expect(page.getByLabel("Trạng thái xuất bản")).toHaveValue("DRAFT");
  await expect(page.getByRole("button", { name: "Lưu nội dung" })).toBeVisible();
  await expect(page.getByLabel("Mô tả biên tập")).toBeVisible();
  await expect(page.getByLabel("SEO title")).toBeVisible();
  await voiceOver.navigateToWebContent({ capture: false });

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");

  const accessibilityScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);

  await slugTextbox.fill(`  Áo Sơ Mi Admin ${runId}  `);
  await page.getByRole("button", { name: "Lưu slug" }).click();
  await page.waitForURL(
    (url) => url.pathname === editorPath && url.searchParams.get("slugSaved") === "1",
  );
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu slug sản phẩm." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Slug sản phẩm", exact: true })).toHaveValue(
    editedProductSlug,
  );

  const persistedSlug = await prisma.productMirror.findUniqueOrThrow({
    where: { id: productId },
    select: { slug: true },
  });
  expect(persistedSlug.slug).toBe(editedProductSlug);
  const slugHistory = await prisma.productSlugHistory.findUniqueOrThrow({
    where: { slug: productSlug },
    select: { productId: true },
  });
  expect(slugHistory.productId).toBe(productId);

  await page.getByLabel("Trạng thái xuất bản").selectOption("PUBLISHED");
  await page.getByLabel("Mô tả biên tập").fill("Editorial content verified in a real browser.");
  await page.getByLabel("Hướng dẫn bảo quản").fill("Cold wash. Dry in shade.");
  await page.getByLabel("Size guide").fill("Relaxed fit. Choose your normal size.");
  await page.getByLabel("SEO title").fill("Accessible admin editor");
  await page.getByLabel("SEO description").fill("Browser and VoiceOver runtime verification.");

  const saveButton = page.getByRole("button", { name: "Lưu nội dung" });
  const successCapture = await voiceOver.capture(
    async () => {
      await saveButton.click();
      await page.waitForURL(
        (url) => url.pathname === editorPath && url.searchParams.get("saved") === "1",
      );
      const successStatus = page.getByRole("status");
      await expect(successStatus).toContainText("Đã lưu nội dung biên tập.");
      await expect(successStatus).toBeFocused();
      await delay(500);
    },
    { capture: true },
  );
  expectSpokenPhrase(
    successCapture.spokenPhrase,
    "Đã lưu nội dung biên tập",
    "VoiceOver must announce the persisted success status after redirect",
  );

  const persisted = await prisma.productContent.findUnique({
    where: { productId },
    select: { status: true, editorialDescription: true, seoTitle: true },
  });
  expect(persisted).toEqual({
    status: "PUBLISHED",
    editorialDescription: "Editorial content verified in a real browser.",
    seoTitle: "Accessible admin editor",
  });
  const sourceAfterSave = await prisma.productMirror.findUnique({
    where: { id: productId },
    select: { sourceDescription: true, slug: true },
  });
  expect(sourceAfterSave).toEqual({ sourceDescription, slug: editedProductSlug });

  const seoTitle = page.getByLabel("SEO title");
  await seoTitle.evaluate((element) => {
    element.removeAttribute("maxlength");
    const input = element as HTMLInputElement;
    input.value = "x".repeat(501);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await voiceOver.navigateToWebContent({ capture: false });
  const errorText = "Không thể lưu. Kiểm tra độ dài và định dạng các trường rồi thử lại.";
  const errorCapture = await voiceOver.capture(
    async () => {
      await page.getByRole("button", { name: "Lưu nội dung" }).click();
      await page.waitForURL(
        (url) => url.pathname === editorPath && url.searchParams.get("error") === "invalid",
      );
      const errorStatus = page.getByRole("alert").filter({ hasText: errorText });
      await expect(errorStatus).toContainText(errorText);
      await expect(errorStatus).toBeFocused();
    },
    { capture: true },
  );
  expectSpokenPhrase(
    errorCapture.spokenPhrase,
    "Không thể lưu",
    "VoiceOver must announce the server validation error after redirect",
  );
  expect(
    browserErrors,
    `browser console errors; failed responses: ${JSON.stringify(failedResponses)}`,
  ).toEqual([]);
  expect(failedResponses).toEqual([]);
});
