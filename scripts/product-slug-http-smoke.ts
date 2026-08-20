import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { prisma } from "../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3213;
const BASE_URL = `http://${HOST}:${PORT}`;
const SHOP_ID = 920_007;
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

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-16_000);
}

function requestPath(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method: "GET",
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolveRequest({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", rejectRequest);
    request.end();
  });
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
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server = spawnedServer;
  spawnedServer.stdout?.on("data", captureServerOutput);
  spawnedServer.stderr?.on("data", captureServerOutput);

  await waitForServer();

  const historicalResponse = await requestPath(`/shop/${historicalSlug}`, {
    host: "attacker.example",
  });
  assert.equal(
    historicalResponse.status,
    301,
    `historical slug must return exact 301, received ${historicalResponse.status}\n${serverOutput}`,
  );
  assert.equal(
    historicalResponse.headers.location,
    `/shop/${currentSlug}`,
    "historical slug redirect must use a relative site-owned Location and never trust request Host",
  );

  const currentResponse = await requestPath(`/shop/${currentSlug}`);
  assert.equal(currentResponse.status, 200, `current slug must render 200, received ${currentResponse.status}`);
  assert.ok(currentResponse.body.includes(productName), "current slug must render the current product");

  const unknownResponse = await requestPath(`/shop/${unknownSlug}`);
  assert.equal(unknownResponse.status, 404, `unknown slug must return 404, received ${unknownResponse.status}`);

  console.log(
    "Product slug HTTP smoke passed: historical slug 301s to relative canonical path, current slug is 200, unknown slug is 404.",
  );
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
  await cleanupDatabase();
  await prisma.$disconnect();
}
