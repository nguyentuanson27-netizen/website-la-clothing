/** U17 / P7b — real-browser refresh loop, resume hooks and buyer accessibility. */

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3227;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_027;
const runId = `${Date.now()}-${process.pid}`;
const campaignId = `u17-browser-campaign-${runId}`;

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js Flash Sale server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/flash-sale`, { redirect: "manual" });
      if (response.status === 200 && (await response.text()).includes("Flash Sale")) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Flash Sale server\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    server = undefined;
    return;
  }
  server.kill("SIGTERM");
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) server.kill("SIGKILL");
  server = undefined;
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" = ${campaignId}`;
}

test.beforeAll(async () => {
  await cleanup();
  const now = new Date();
  const startsAt = new Date(now.getTime() + 60 * 60_000);
  const endsAt = new Date(now.getTime() + 2 * 60 * 60_000);

  // A far scheduled boundary makes the server repeatedly return the same capped 60s duration.
  // No target is needed: this fixture exercises route freshness rather than sale membership.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","startsAt","endsAt",
        "isEnabled","enabledAt","createdAt","updatedAt")
     VALUES ($1,'FLASH_SALE'::"PromotionCampaignKind",$2,
       'PERCENTAGE'::"PromotionDiscountType",10,$3,$4,true,$5,$5,$5)`,
    campaignId,
    `U17 browser freshness ${runId}`,
    startsAt,
    endsAt,
    now,
  );

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
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

test("U17 self-rearms for the same server duration and resumes on visibility/BFCache", async ({ page }) => {
  // Install before navigation, as required by Playwright's Clock contract. Advancing the browser
  // clock cannot advance the server's request clock; that is intentional evidence that browser
  // wall time is presentation/test machinery, never promotion authority.
  await page.clock.install();

  let refreshRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/flash-sale" &&
      (url.searchParams.has("_rsc") || request.headers()["rsc"] === "1")
    ) {
      refreshRequests += 1;
    }
  });

  await page.goto(`${BASE_URL}/flash-sale`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Flash Sale" })).toBeVisible();
  // Let React hydrate and arm the first server-supplied 60s timer using real runner time.
  await delay(500);

  const beforeFirstTimer = refreshRequests;
  await page.clock.fastForward(60_000);
  await expect
    .poll(() => refreshRequests, { timeout: 3_000, message: "first timer refresh" })
    .toBeGreaterThan(beforeFirstTimer);

  const beforeSecondTimer = refreshRequests;
  await page.clock.fastForward(60_000);
  await expect
    .poll(() => refreshRequests, { timeout: 3_000, message: "second self-rearmed timer refresh" })
    .toBeGreaterThan(beforeSecondTimer);

  const beforeVisible = refreshRequests;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect
    .poll(() => refreshRequests, { timeout: 3_000, message: "visibility resume refresh" })
    .toBeGreaterThan(beforeVisible);

  const beforePageShow = refreshRequests;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await expect
    .poll(() => refreshRequests, { timeout: 3_000, message: "BFCache resume refresh" })
    .toBeGreaterThan(beforePageShow);

  const accessibility = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(accessibility.violations).toEqual([]);
});
