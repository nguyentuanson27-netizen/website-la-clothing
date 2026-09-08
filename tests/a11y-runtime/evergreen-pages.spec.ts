import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { BUYER_AXE_TAGS } from "./axe-tags";
import {
  describePublicAddress,
  describePublicSupportHours,
  PUBLIC_BRAND_POSITIONING,
  PUBLIC_CONTACT_FACTS,
  PUBLIC_LEGAL_FACTS,
} from "../../src/content/public-brand-facts.ts";

const HOST = "127.0.0.1";
const PORT = 3229;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`U33a evergreen page server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/search`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for U33a evergreen page server\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) server.kill("SIGKILL");
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      APP_DOMAIN: `${HOST}:${PORT}`,
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
});

test("U33a the Contact page publishes the approved channels and claims no other support route", async ({
  page,
}) => {
  const response = await page.goto(`${BASE_URL}/contact`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const main = page.locator("main");
  await expect(page.getByRole("heading", { level: 1, name: "Liên hệ" })).toBeVisible();

  // Asserted against the fact authority, never literals: the footer, the Organization markup and
  // this page all render the same constant, and a literal here would let one of them drift.
  await expect(main).toContainText(PUBLIC_CONTACT_FACTS.telephone);
  await expect(main).toContainText(PUBLIC_CONTACT_FACTS.email);
  await expect(main).toContainText(describePublicAddress());
  await expect(main).toContainText(describePublicSupportHours());
  await expect(
    main.locator(`a[href="tel:${PUBLIC_CONTACT_FACTS.telephoneInternational}"]`),
  ).toBeVisible();
  await expect(main.locator(`a[href="mailto:${PUBLIC_CONTACT_FACTS.email}"]`)).toBeVisible();
  await expect(main.locator(`a[href="${PUBLIC_CONTACT_FACTS.fanpageUrl}"]`)).toBeVisible();

  // No support channel or promise the owner has not approved. A contact form or a stated response
  // time would be a policy this repository invented.
  await expect(main.locator("form")).toHaveCount(0);
  for (const invented of [/phản hồi trong \d/i, /24\/7/, /live chat/i, /hotline miễn phí/i]) {
    await expect(main).not.toContainText(invented);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibilityScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("U33a the About page publishes the approved minimum and invents no brand history", async ({
  page,
}) => {
  const response = await page.goto(`${BASE_URL}/about`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const main = page.locator("main");
  await expect(page.getByRole("heading", { level: 1, name: "Về LA Clothing" })).toBeVisible();
  await expect(main).toContainText(PUBLIC_BRAND_POSITIONING);
  await expect(main).toContainText(PUBLIC_LEGAL_FACTS.legalEntityName);
  await expect(main).toContainText(PUBLIC_LEGAL_FACTS.taxCode);
  await expect(main).toContainText(describePublicAddress());

  // B6 withholds the founding year, the founder and any brand story or values. This is the
  // assertion that fails if a later edit writes an origin story into the page.
  for (const withheld of [
    /thành lập (?:năm|vào)/i,
    /founder/i,
    /nhà sáng lập/i,
    /sứ mệnh/i,
    /giá trị cốt lõi/i,
    /câu chuyện thương hiệu/i,
    /\b(?:19|20)\d{2}\b/,
  ]) {
    await expect(main).not.toContainText(withheld);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibilityScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("U33a each evergreen page is reachable from the site footer", async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

  const footer = page.locator("footer");
  await footer.locator('a[href="/about"]').click();
  await page.waitForURL((url) => url.pathname === "/about");

  await page.locator("footer").locator('a[href="/contact"]').click();
  await page.waitForURL((url) => url.pathname === "/contact");
});
