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
const adminEmail = `admin-a11y-${runId}@example.invalid`;
const password = "admin-a11y-runtime-password-123";
const productExternalId = `admin-a11y-product-${runId}`;
const productSlug = `admin-a11y-product-${runId}`;
const editedProductSlug = `ao-so-mi-admin-${runId}`;
const productName = `Admin A11y Product ${runId}`;
const parentExternalId = `admin-a11y-parent-${runId}`;
const parentSlug = `admin-a11y-parent-${runId}`;
const parentName = `Admin Composite Parent ${runId}`;
const sourceDescription = "Read-only Pancake source context for editorial decisions.";

let server: ChildProcess | undefined;
let serverOutput = "";
let productId = "";
let parentProductId = "";
let parentVariantId = "";
let componentVariantId = "";
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
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { in: [productExternalId, parentExternalId] } },
  });
}

function expectSpokenPhrase(spokenPhrase: string, expected: string, label: string) {
  expect(
    spokenPhrase.includes(expected),
    `${label}; captured VoiceOver output: ${JSON.stringify(spokenPhrase)}`,
  ).toBe(true);
}

// Same assertion, but when it fails it reports everything VoiceOver actually said during the
// test rather than just the one captured phrase. The activation buttons sit inside the website
// variant scroll region, so a miss here needs the full transcript to tell "VoiceOver announced
// something else" apart from "VoiceOver announced nothing at all".
async function expectCapturedPhrase(
  voiceOver: { spokenPhraseLog: () => Promise<string[]> },
  capture: { itemText: string; spokenPhrase: string },
  expected: string,
  label: string,
) {
  if (capture.spokenPhrase.includes(expected)) return;

  const spokenPhraseLog = await voiceOver.spokenPhraseLog();
  expect(
    false,
    [
      label,
      `captured spoken phrase: ${JSON.stringify(capture.spokenPhrase)}`,
      `captured item text: ${JSON.stringify(capture.itemText)}`,
      `full spoken phrase log: ${JSON.stringify(spokenPhraseLog)}`,
    ].join("; "),
  ).toBe(true);
}

test.beforeAll(async () => {
  await cleanupDatabase();

  const syncedAt = new Date();
  const product = await prisma.productMirror.create({
    data: {
      pancakeProductId: productExternalId,
      slug: productSlug,
      name: productName,
      sourceDescription,
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  productId = product.id;

  const componentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `admin-a11y-component-m-${runId}`,
      productId,
      sku: "CHILD-M",
      size: "M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  componentVariantId = componentVariant.id;

  await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `admin-a11y-component-l-unlinked-${runId}`,
      productId,
      sku: "CHILD-L",
      size: "L",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  const parent = await prisma.productMirror.create({
    data: {
      pancakeProductId: parentExternalId,
      slug: parentSlug,
      name: parentName,
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  parentProductId = parent.id;

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `admin-a11y-parent-m-${runId}`,
      productId: parent.id,
      sku: "SET-PARENT-M",
      size: "M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  parentVariantId = parentVariant.id;

  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId,
      componentVariantId,
      quantity: 1,
      syncedAt,
    },
  });

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

test("admin editor keeps Pancake source read-only and manages unified ordinary/composite activation accessibly", async ({
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
  await expect(page.getByRole("heading", { level: 2, name: "Website commerce" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Biến thể website" })).toBeVisible();
  const sourceDisclosure = page.locator("details").filter({
    has: page.locator("summary", { hasText: "Nguồn Pancake" }),
  });
  await expect(sourceDisclosure).not.toHaveAttribute("open", "");
  await expect(sourceDisclosure.locator("summary")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Nguồn mô tả từ Pancake" })).toBeHidden();
  await expect(page.getByText(sourceDescription, { exact: true })).toBeHidden();
  await sourceDisclosure.locator("summary").click();
  await expect(page.getByRole("heading", { level: 2, name: "Nguồn mô tả từ Pancake" })).toBeVisible();
  await expect(page.getByText(sourceDescription, { exact: true })).toBeVisible();
  await expect(sourceDisclosure.getByRole("button", { name: /^(Kích hoạt|Tắt) biến thể/ })).toHaveCount(0);
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

  const componentRow = page.getByRole("row").filter({ hasText: "CHILD-M" }).first();
  await expect(componentRow.getByText("Thành phần set", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: parentName })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kích hoạt biến thể CHILD-L" }),
  ).toBeVisible();

  await voiceOver.navigateToWebContent({ capture: false });
  const activationCapture = await voiceOver.capture(
    async () => {
      await componentRow.getByRole("button", { name: "Kích hoạt biến thể CHILD-M" }).click();
      await page.waitForURL(
        (url) => url.pathname === editorPath && url.searchParams.get("variantSaved") === "1",
      );
      const successStatus = page
        .getByRole("status")
        .filter({ hasText: "Đã cập nhật trạng thái biến thể website." });
      await expect(successStatus).toBeVisible();
      await expect(successStatus).toBeFocused();
      await delay(500);
    },
    { capture: true },
  );
  await expectCapturedPhrase(
    voiceOver,
    activationCapture,
    "Đã cập nhật trạng thái biến thể website",
    "VoiceOver must announce generic child activation success",
  );

  const activated = await prisma.variantMirror.findUniqueOrThrow({
    where: { id: componentVariantId },
    select: {
      isActive: true,
      product: { select: { isActive: true } },
    },
  });
  expect(activated).toEqual({
    isActive: true,
    product: { isActive: false },
  });

  const parentEditorPath = `/admin/products/${encodeURIComponent(parentProductId)}`;
  await page.goto(`${BASE_URL}${parentEditorPath}`, { waitUntil: "networkidle" });
  const parentSourceDisclosure = page.locator("details").filter({
    has: page.locator("summary", { hasText: "Nguồn Pancake" }),
  });
  await expect(parentSourceDisclosure).not.toHaveAttribute("open", "");
  await parentSourceDisclosure.locator("summary").click();
  const childReferenceRow = page.getByRole("row").filter({ hasText: productName });
  await expect(childReferenceRow.getByText("Đã kích hoạt biến thể", { exact: true })).toBeVisible();
  await expect(childReferenceRow.getByText("Catalog riêng: tắt", { exact: true })).toBeVisible();
  await expect(childReferenceRow.getByRole("button")).toHaveCount(0);

  const parentVariantRow = page.getByRole("row").filter({ hasText: "SET-PARENT-M" }).first();
  await expect(parentVariantRow.getByText("Set cha", { exact: true })).toBeVisible();
  const parentActivationButton = parentVariantRow.getByRole("button", {
    name: "Kích hoạt biến thể SET-PARENT-M",
  });
  await expect(parentActivationButton).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  const parentAccessibilityScan = await new AxeBuilder({ page })
    .withTags(BUYER_AXE_TAGS)
    .analyze();
  expect(parentAccessibilityScan.violations).toEqual([]);

  await voiceOver.navigateToWebContent({ capture: false });
  const parentActivationCapture = await voiceOver.capture(
    async () => {
      await parentActivationButton.click();
      await page.waitForURL(
        (url) => url.pathname === parentEditorPath && url.searchParams.get("variantSaved") === "1",
      );
      const successStatus = page
        .getByRole("status")
        .filter({ hasText: "Đã cập nhật trạng thái biến thể website." });
      await expect(successStatus).toBeVisible();
      await expect(successStatus).toBeFocused();
      await delay(500);
    },
    { capture: true },
  );
  await expectCapturedPhrase(
    voiceOver,
    parentActivationCapture,
    "Đã cập nhật trạng thái biến thể website",
    "VoiceOver must announce generic parent activation success",
  );
  expect(
    (
      await prisma.variantMirror.findUniqueOrThrow({
        where: { id: parentVariantId },
        select: { isActive: true },
      })
    ).isActive,
  ).toBe(true);

  await page.goto(`${BASE_URL}${editorPath}`, { waitUntil: "networkidle" });
  await page.getByRole("row").filter({ hasText: "CHILD-M" }).first().getByRole("button", {
    name: "Tắt biến thể CHILD-M",
  }).click();
  await page.waitForURL(
    (url) => url.pathname === editorPath && url.searchParams.get("variantSaved") === "1",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Đã cập nhật trạng thái biến thể website." }),
  ).toBeFocused();
  expect(
    (
      await prisma.variantMirror.findUniqueOrThrow({
        where: { id: componentVariantId },
        select: { isActive: true },
      })
    ).isActive,
  ).toBe(false);

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
