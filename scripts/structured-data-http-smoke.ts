import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { prisma } from "../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3216;
const BASE_URL = `http://${HOST}:${PORT}`;
const SHOP_ID = 920_010;
const PUBLIC_ORIGIN = "https://shop.example.com";
const TRUSTED_IMAGE_URL = "https://content.pancake.vn/catalog/11/22/33/p14-structured.jpg";
const nextDevDirectory = new URL("../.next/dev/", import.meta.url);
const require = createRequire(import.meta.url);
const nextCliPath = resolve(dirname(require.resolve("next/package.json")), "dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const productId = `p14-http-product-${runId}`;
const slug = `p14-structured-product-${runId}`;
const unknownSlug = `p14-unknown-${runId}`;
const productName = "P14 Structured Product";
const editorialDescription = "P14 published editorial description for structured-data verification.";

let server: ChildProcess | undefined;
let serverOutput = "";

type JsonRecord = Record<string, unknown>;

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function requestPath(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js P14 structured-data server exited early with code ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/lookbook`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The development server may still be starting or compiling the route.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js P14 structured-data server\n${serverOutput}`);
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

async function startServer() {
  serverOutput = "";
  const spawnedServer = spawn(
    process.execPath,
    [nextCliPath, "dev", "--hostname", HOST, "--port", String(PORT)],
    {
      env: {
        ...process.env,
        APP_DOMAIN: "shop.example.com",
        SEARCH_INDEXING_ENABLED: "true",
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

async function cleanupDatabase() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: productId },
  });
}

function extractJsonLd(body: string): JsonRecord[] {
  return [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    ([, source]) => JSON.parse(source!) as JsonRecord,
  );
}

function graphNodes(document: JsonRecord): JsonRecord[] {
  const graph = document["@graph"];
  assert.ok(Array.isArray(graph), `JSON-LD document must contain @graph\n${serverOutput}`);
  return graph as JsonRecord[];
}

function findDocumentWithType(documents: JsonRecord[], type: string): JsonRecord {
  const document = documents.find((candidate) =>
    graphNodes(candidate).some((node) => node["@type"] === type),
  );
  assert.ok(document, `initial HTML must contain JSON-LD graph type ${type}\n${serverOutput}`);
  return document;
}

try {
  await cleanupDatabase();

  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: productId,
      slug,
      name: productName,
      primaryImageUrl: TRUSTED_IMAGE_URL,
      isPresent: true,
      isActive: true,
      syncedAt: new Date(),
      content: {
        create: {
          status: "PUBLISHED",
          editorialDescription,
        },
      },
    },
  });

  const availableVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `p14-http-available-${runId}`,
      productId: product.id,
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 590_000,
      pancakeRetailPriceAfterDiscount: 590_000,
      syncedAt: new Date(),
    },
  });
  await prisma.warehouseStock.create({
    data: {
      variantId: availableVariant.id,
      pancakeWarehouseId: `p14-http-warehouse-${runId}`,
      quantity: 3,
      syncedAt: new Date(),
    },
  });

  await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `p14-http-sold-out-${runId}`,
      productId: product.id,
      size: "L",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 590_000,
      pancakeRetailPriceAfterDiscount: 590_000,
      syncedAt: new Date(),
    },
  });

  await startServer();

  const page = await requestPath(`/shop/${slug}`);
  assert.equal(page.status, 200, `P14 PDP must return 200\n${serverOutput}`);
  const documents = extractJsonLd(page.body);
  assert.ok(documents.length >= 2, "PDP initial HTML must contain site and product JSON-LD documents");

  const siteDocument = findDocumentWithType(documents, "Organization");
  assert.deepEqual(graphNodes(siteDocument), [
    {
      "@type": "Organization",
      "@id": `${PUBLIC_ORIGIN}/#organization`,
      name: "LA Clothing",
      url: `${PUBLIC_ORIGIN}/`,
    },
    {
      "@type": "WebSite",
      "@id": `${PUBLIC_ORIGIN}/#website`,
      name: "LA Clothing",
      url: `${PUBLIC_ORIGIN}/`,
      publisher: {
        "@id": `${PUBLIC_ORIGIN}/#organization`,
      },
    },
  ]);

  const productDocument = findDocumentWithType(documents, "Product");
  const productNodes = graphNodes(productDocument);
  assert.deepEqual(productNodes[0], {
    "@type": "Product",
    "@id": `${PUBLIC_ORIGIN}/shop/${slug}#product`,
    name: productName,
    url: `${PUBLIC_ORIGIN}/shop/${slug}`,
    brand: {
      "@type": "Brand",
      name: "LA Clothing",
    },
    description: editorialDescription,
    image: [TRUSTED_IMAGE_URL],
    offers: {
      "@type": "Offer",
      url: `${PUBLIC_ORIGIN}/shop/${slug}`,
      priceCurrency: "VND",
      price: 590_000,
      availability: "https://schema.org/InStock",
    },
  });
  assert.deepEqual(productNodes[1], {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Trang chủ",
        item: `${PUBLIC_ORIGIN}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Shop",
        item: `${PUBLIC_ORIGIN}/shop`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: productName,
      },
    ],
  });

  const productJson = JSON.stringify(productDocument);
  for (const forbidden of [
    "ProductGroup",
    "AggregateOffer",
    "aggregateRating",
    "review",
    "gtin",
    "material",
    "shippingDetails",
    "hasMerchantReturnPolicy",
  ]) {
    assert.equal(productJson.includes(forbidden), false, `P14 must not emit ${forbidden}`);
  }

  const unknown = await requestPath(`/shop/${unknownSlug}`);
  assert.equal(unknown.status, 404, "unknown PDP must remain exact 404");
  const unknownDocuments = extractJsonLd(unknown.body);
  assert.equal(
    unknownDocuments.some((document) =>
      graphNodes(document).some((node) => node["@type"] === "Product"),
    ),
    false,
    "unknown PDP must not emit Product structured data",
  );

  console.log(
    "P14 structured-data HTTP smoke passed: initial HTML contains server-owned Organization/WebSite plus factual Product/Offer/Breadcrumb JSON-LD without unsupported variant or merchant claims, and unknown PDPs emit no Product graph.",
  );
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
  await cleanupDatabase();
  await prisma.$disconnect();
}
