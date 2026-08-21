import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { prisma } from "../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3214;
const BASE_URL = `http://${HOST}:${PORT}`;
const SHOP_ID = 920_008;
const PUBLIC_ORIGIN = "https://shop.example.com";
const nextDevDirectory = new URL("../.next/dev/", import.meta.url);
const require = createRequire(import.meta.url);
const nextCliPath = resolve(dirname(require.resolve("next/package.json")), "dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const visibleProductId = `p12-http-visible-${runId}`;
const inactiveProductId = `p12-http-inactive-${runId}`;
const currentSlug = `p12-http-current-${runId}`;
const historicalSlug = `p12-http-old-${runId}`;
const inactiveSlug = `p12-http-inactive-${runId}`;
const publishedCollectionSlug = `p12-http-public-${runId}`;
const draftCollectionSlug = `p12-http-draft-${runId}`;

let server: ChildProcess | undefined;
let serverOutput = "";

type HttpResponse = Readonly<{
  status: number;
  xRobotsTag: string | null;
  body: string;
}>;

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function requestPath(path: string): Promise<HttpResponse> {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return {
    status: response.status,
    xRobotsTag: response.headers.get("x-robots-tag"),
    body: await response.text(),
  };
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js search exposure server exited early with code ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/lookbook`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The development server may still be starting or compiling the route.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js search exposure server\n${serverOutput}`);
}

async function waitForServerExit(timeoutMs: number): Promise<boolean> {
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

async function startServer(environment: Record<string, string>) {
  serverOutput = "";
  const spawnedServer = spawn(
    process.execPath,
    [nextCliPath, "dev", "--hostname", HOST, "--port", String(PORT)],
    {
      env: {
        ...process.env,
        ...environment,
        PANCAKE_SHOP_ID: String(SHOP_ID),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server = spawnedServer;
  spawnedServer.stdout?.on("data", captureServerOutput);
  spawnedServer.stderr?.on("data", captureServerOutput);
  await waitForServer();
}

async function restartServer(environment: Record<string, string>) {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
  server = undefined;
  await startServer(environment);
}

async function cleanupDatabase() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { in: [visibleProductId, inactiveProductId] } },
  });
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { in: [publishedCollectionSlug, draftCollectionSlug] } },
  });
}

function assertNoIndexHeader(response: HttpResponse, label: string) {
  assert.equal(response.xRobotsTag, "noindex, nofollow", `${label} must emit X-Robots-Tag noindex, nofollow`);
}

try {
  await cleanupDatabase();

  await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: visibleProductId,
      slug: currentSlug,
      name: "P12 HTTP visible product",
      isPresent: true,
      isActive: true,
      syncedAt: new Date(),
      slugHistory: { create: { slug: historicalSlug } },
    },
  });
  await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: inactiveProductId,
      slug: inactiveSlug,
      name: "P12 HTTP inactive product",
      isPresent: true,
      isActive: false,
      syncedAt: new Date(),
    },
  });
  await prisma.collectionDefinition.createMany({
    data: [
      {
        slug: publishedCollectionSlug,
        title: "P12 HTTP Published Collection",
        description: "Published P12 HTTP smoke collection.",
        isPublished: true,
      },
      {
        slug: draftCollectionSlug,
        title: "P12 HTTP Draft Collection",
        description: "Draft P12 HTTP smoke collection.",
        isPublished: false,
      },
    ],
  });

  await startServer({
    APP_DOMAIN: "la.lanadesign.vn",
    SEARCH_INDEXING_ENABLED: "false",
  });

  const disabledRobots = await requestPath("/robots.txt");
  assert.equal(disabledRobots.status, 200, `disabled robots.txt must return 200\n${serverOutput}`);
  assert.ok(disabledRobots.body.includes("Disallow: /"), "disabled robots.txt must disallow the whole site");
  assert.equal(disabledRobots.body.includes("Sitemap:"), false, "disabled robots.txt must not advertise a sitemap");

  const disabledSitemap = await requestPath("/sitemap.xml");
  assert.equal(disabledSitemap.status, 200, "disabled sitemap.xml must return 200");
  assert.equal(disabledSitemap.body.includes("<loc>"), false, "disabled sitemap must expose no canonical URLs");

  const disabledPage = await requestPath("/lookbook");
  assert.equal(disabledPage.status, 200, "disabled public page must remain browseable");
  assertNoIndexHeader(disabledPage, "disabled public page");
  assert.ok(
    disabledPage.body.includes('name="robots"') && disabledPage.body.includes("noindex"),
    "disabled HTML metadata must include robots noindex",
  );

  await restartServer({
    APP_DOMAIN: "shop.example.com",
    SEARCH_INDEXING_ENABLED: "true",
  });

  const enabledRobots = await requestPath("/robots.txt");
  assert.equal(enabledRobots.status, 200, "enabled robots.txt must return 200");
  assert.ok(enabledRobots.body.includes("Allow: /"), "enabled robots.txt must allow the public site");
  for (const privatePath of ["/admin", "/api", "/account", "/cart", "/checkout", "/search", "/track-order"]) {
    assert.ok(
      enabledRobots.body.includes(`Disallow: ${privatePath}`),
      `enabled robots.txt must disallow ${privatePath}`,
    );
  }
  assert.ok(
    enabledRobots.body.includes(`Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`),
    "enabled robots.txt must advertise the canonical sitemap origin",
  );

  const enabledSitemap = await requestPath("/sitemap.xml");
  assert.equal(enabledSitemap.status, 200, "enabled sitemap.xml must return 200");
  for (const canonicalUrl of [
    `${PUBLIC_ORIGIN}/`,
    `${PUBLIC_ORIGIN}/shop`,
    `${PUBLIC_ORIGIN}/collections`,
    `${PUBLIC_ORIGIN}/lookbook`,
    `${PUBLIC_ORIGIN}/shop/${currentSlug}`,
    `${PUBLIC_ORIGIN}/collections/${publishedCollectionSlug}`,
  ]) {
    assert.ok(enabledSitemap.body.includes(canonicalUrl), `enabled sitemap must include ${canonicalUrl}`);
  }
  for (const excludedValue of [historicalSlug, inactiveSlug, draftCollectionSlug, "/admin", "/search?"]) {
    assert.equal(enabledSitemap.body.includes(excludedValue), false, `enabled sitemap must exclude ${excludedValue}`);
  }

  const indexablePage = await requestPath("/lookbook");
  assert.equal(indexablePage.status, 200, "enabled indexable page must remain 200");
  assert.equal(indexablePage.xRobotsTag, null, "enabled canonical public page must not emit X-Robots-Tag noindex");
  assert.equal(
    indexablePage.body.includes('name="robots"') && indexablePage.body.includes("noindex"),
    false,
    "enabled HTML metadata must not emit global robots noindex",
  );

  const queryPage = await requestPath("/lookbook?utm_source=smoke");
  assert.equal(queryPage.status, 200, "query-state public page must remain browseable");
  assertNoIndexHeader(queryPage, "query-state public page");

  const utilityPage = await requestPath("/new-arrivals");
  assert.equal(utilityPage.status, 200, "non-launch editorial utility page must remain browseable");
  assertNoIndexHeader(utilityPage, "non-launch editorial utility page");

  console.log(
    "Search exposure HTTP smoke passed: staging is globally noindex, enabled robots/sitemap use server-owned canonical origin, sitemap excludes noncanonical state, and query/utility surfaces stay noindex.",
  );
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
  await cleanupDatabase();
  await prisma.$disconnect();
}
