import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { prisma } from "../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3213;
const BASE_URL = `http://${HOST}:${PORT}`;
const SHOP_ID = 920_007;
const HOSTILE_HOST = "attacker.example";
const nextDevDirectory = new URL("../.next/dev/", import.meta.url);
const require = createRequire(import.meta.url);
const nextCliPath = resolve(dirname(require.resolve("next/package.json")), "dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const pancakeProductId = `slug-http-product-${runId}`;
const pancakeVariationId = `slug-http-variation-${runId}`;
const pancakeWarehouseId = `slug-http-warehouse-${runId}`;
const currentSlug = `ao-so-mi-http-${runId}`;
const historicalSlug = `ao-so-mi-cu-${runId}`;
const unknownSlug = `khong-ton-tai-${runId}`;
const productName = `Áo sơ mi HTTP ${runId}`;

let server: ChildProcess | undefined;
let serverOutput = "";

type HttpResponse = {
  status: number;
  location: string | null;
  xContentTypeOptions: string | null;
  xFrameOptions: string | null;
  body: string;
};

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-16_000);
}

async function requestPath(path: string): Promise<HttpResponse> {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return {
    status: response.status,
    location: response.headers.get("location"),
    xContentTypeOptions: response.headers.get("x-content-type-options"),
    xFrameOptions: response.headers.get("x-frame-options"),
    body: await response.text(),
  };
}

async function requestPathWithHost(path: string, hostHeader: string): Promise<HttpResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method: "GET",
        headers: { Host: hostHeader },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolveRequest({
            status: response.statusCode ?? 0,
            location: typeof response.headers.location === "string" ? response.headers.location : null,
            xContentTypeOptions:
              typeof response.headers["x-content-type-options"] === "string"
                ? response.headers["x-content-type-options"]
                : null,
            xFrameOptions:
              typeof response.headers["x-frame-options"] === "string"
                ? response.headers["x-frame-options"]
                : null,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    request.on("error", rejectRequest);
    request.end();
  });
}

function assertSecurityHeaders(response: HttpResponse, label: string) {
  assert.equal(response.xContentTypeOptions, "nosniff", `${label} must preserve X-Content-Type-Options`);
  assert.equal(response.xFrameOptions, "DENY", `${label} must preserve X-Frame-Options`);
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js slug smoke server exited early with code ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The development server may still be starting or compiling the route.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js slug smoke server\n${serverOutput}`);
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

async function cleanupDatabase() {
  await prisma.productMirror.deleteMany({ where: { pancakeProductId } });
}

try {
  await cleanupDatabase();

  await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId,
      slug: currentSlug,
      name: productName,
      syncedAt: new Date(),
      slugHistory: {
        create: { slug: historicalSlug },
      },
      variants: {
        create: {
          pancakeVariationId,
          color: "Black",
          size: "M",
          pancakeRetailPrice: 500_000,
          pancakeRetailPriceAfterDiscount: 500_000,
          syncedAt: new Date(),
          warehouseStocks: {
            create: {
              pancakeWarehouseId,
              quantity: 1,
              syncedAt: new Date(),
            },
          },
        },
      },
    },
  });

  const spawnedServer = spawn(
    process.execPath,
    [nextCliPath, "dev", "--hostname", HOST, "--port", String(PORT)],
    {
      env: {
        ...process.env,
        APP_DOMAIN: `${HOST}:${PORT}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server = spawnedServer;
  spawnedServer.stdout?.on("data", captureServerOutput);
  spawnedServer.stderr?.on("data", captureServerOutput);

  await waitForServer();

  const historicalResponse = await requestPathWithHost(`/shop/${historicalSlug}`, HOSTILE_HOST);
  assert.equal(
    historicalResponse.status,
    301,
    `historical slug must return exact 301, received ${historicalResponse.status}\n${serverOutput}`,
  );
  assert.equal(
    historicalResponse.location,
    `${BASE_URL}/shop/${currentSlug}`,
    "historical redirect must use the server-owned storefront origin even when the request Host is hostile",
  );
  assertSecurityHeaders(historicalResponse, "historical slug 301");

  const currentResponse = await requestPath(`/shop/${currentSlug}`);
  assert.equal(currentResponse.status, 200, `current slug must render 200, received ${currentResponse.status}`);
  assert.ok(currentResponse.body.includes(productName), "current slug must render the current product");

  const unknownResponse = await requestPath(`/shop/${unknownSlug}`);
  assert.equal(unknownResponse.status, 404, `unknown slug must return 404, received ${unknownResponse.status}`);
  assertSecurityHeaders(unknownResponse, "unknown slug 404");

  console.log(
    "Product slug HTTP smoke passed: hostile Host cannot influence the historical 301 destination, current slug is 200, unknown slug is 404, and direct responses retain security headers.",
  );
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
  await cleanupDatabase();
  await prisma.$disconnect();
}
