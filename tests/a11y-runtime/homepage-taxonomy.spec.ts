import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3220;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const TEST_PREFIX = "u2-homepage-";

let server: ChildProcess | undefined;
let serverOutput = "";
let originallyPublishedSlugs: string[] = [];

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js U2 server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for U2 server\n${serverOutput}`);
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
  if (!exited) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
  server = undefined;
}

async function prepareCollectionState() {
  originallyPublishedSlugs = (
    await prisma.collectionDefinition.findMany({
      where: { isPublished: true },
      select: { slug: true },
    })
  ).map(({ slug }) => slug);

  await prisma.collectionDefinition.updateMany({
    where: { isPublished: true },
    data: { isPublished: false },
  });
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });
}

async function restoreCollectionState() {
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });
  if (originallyPublishedSlugs.length > 0) {
    await prisma.collectionDefinition.updateMany({
      where: { slug: { in: originallyPublishedSlugs } },
      data: { isPublished: true },
    });
  }
}

async function addCollection(slug: string, title: string, isPublished: boolean) {
  await prisma.collectionDefinition.create({
    data: {
      slug,
      title,
      description: `${title} homepage taxonomy fixture.`,
      isPublished,
      pancakeCategoryIds: [],
    },
  });
}

test.beforeAll(async () => {
  await prepareCollectionState();
  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      PANCAKE_SHOP_ID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", captureServerOutput);
  server.stderr?.on("data", captureServerOutput);
  await waitForServer();
});

test.afterAll(async () => {
  await stopServer();
  await restoreCollectionState();
  await prisma.$disconnect();
});

test("U2 homepage collection rail renders only truthful published mappings across 0, partial and full states", async ({
  page,
}) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await expect(page.locator('a[href*="category="]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Bộ sưu tập nổi bật" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Mua bộ sưu tập/ })).toHaveAttribute("href", "/shop");

  await addCollection(`${TEST_PREFIX}02`, "U2 Published Two", true);
  await addCollection(`${TEST_PREFIX}01`, "U2 Published One", true);
  await addCollection(`${TEST_PREFIX}draft`, "U2 Draft Hidden", false);

  await page.reload({ waitUntil: "networkidle" });
  const partialRail = page.getByRole("navigation", { name: "Bộ sưu tập nổi bật" });
  await expect(partialRail).toBeVisible();
  await expect(partialRail.getByRole("link")).toHaveCount(2);
  await expect(partialRail.getByRole("link", { name: "U2 Published One" })).toHaveAttribute(
    "href",
    `/collections/${TEST_PREFIX}01`,
  );
  await expect(partialRail.getByRole("link", { name: "U2 Published Two" })).toHaveAttribute(
    "href",
    `/collections/${TEST_PREFIX}02`,
  );
  await expect(page.getByText("U2 Draft Hidden")).toHaveCount(0);
  await expect(page.locator('a[href*="category="]')).toHaveCount(0);

  await addCollection(`${TEST_PREFIX}03`, "U2 Published Three", true);
  await addCollection(`${TEST_PREFIX}04`, "U2 Published Four", true);

  await page.reload({ waitUntil: "networkidle" });
  const fullRail = page.getByRole("navigation", { name: "Bộ sưu tập nổi bật" });
  await expect(fullRail.getByRole("link")).toHaveCount(4);
  await expect(fullRail.getByRole("link").nth(0)).toHaveText("U2 Published One");
  await expect(fullRail.getByRole("link").nth(1)).toHaveText("U2 Published Two");
  await expect(fullRail.getByRole("link").nth(2)).toHaveText("U2 Published Three");
  await expect(fullRail.getByRole("link").nth(3)).toHaveText("U2 Published Four");
  await expect(page.getByText("U2 Draft Hidden")).toHaveCount(0);
  await expect(page.locator('a[href*="category="]')).toHaveCount(0);
});
