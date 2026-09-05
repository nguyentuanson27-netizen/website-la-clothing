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
const MEDIUM_IMAGE_URL = "https://content.pancake.vn/catalog/11/22/33/u27-medium.jpg";
const LARGE_IMAGE_URL = "https://content.pancake.vn/catalog/11/22/33/u27-large.jpg";
const nextDevDirectory = new URL("../.next/dev/", import.meta.url);
const require = createRequire(import.meta.url);
const nextCliPath = resolve(dirname(require.resolve("next/package.json")), "dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const productId = `p14-http-product-${runId}`;
const slug = `p14-structured-product-${runId}`;
const unknownSlug = `p14-unknown-${runId}`;
const productName = "P14 Structured Product";
const editorialDescription = "P14 published editorial description for structured-data verification.";

/** U27 — the variant family published as `ProductGroup` / `Product` / `Offer`. */
const MEDIUM_VARIATION = `u27-http-medium-${runId}`;
const LARGE_VARIATION = `u27-http-large-${runId}`;
const UNPRICED_VARIATION = `u27-http-unpriced-${runId}`;
const INACTIVE_VARIATION = `u27-http-inactive-${runId}`;
const MEDIUM_MPN = `U27-M-${runId}`;
const LARGE_MPN = `U27-L-${runId}`;
const UNPRICED_MPN = `U27-XL-${runId}`;
const INACTIVE_MPN = `U27-S-${runId}`;
const MEDIUM_PRICE = 590_000;
const LARGE_PRICE = 690_000;

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

  async function seedVariant(
    pancakeVariationId: string,
    size: string,
    retailPrice: number | null,
    options: Readonly<{ stock: number; mpn: string; isActive?: boolean; imageUrl?: string }>,
  ): Promise<string> {
    const variant = await prisma.variantMirror.create({
      data: {
        pancakeVariationId,
        pancakeDisplayId: options.mpn,
        productId: product.id,
        color: "Đen",
        size,
        isPresent: true,
        isActive: options.isActive ?? true,
        pancakeRetailPrice: retailPrice,
        pancakeRetailPriceAfterDiscount: retailPrice,
        pancakeImageUrls: options.imageUrl ? [options.imageUrl] : undefined,
        syncedAt: new Date(),
      },
    });
    await prisma.warehouseStock.create({
      data: {
        variantId: variant.id,
        pancakeWarehouseId: `p14-http-warehouse-${runId}`,
        quantity: options.stock,
        syncedAt: new Date(),
      },
    });
    return variant.id;
  }

  // Two publishable siblings priced differently, so a range or an aggregate cannot pass as exact.
  const mediumVariantMirrorId = await seedVariant(MEDIUM_VARIATION, "M", MEDIUM_PRICE, {
    stock: 3,
    mpn: MEDIUM_MPN,
    imageUrl: MEDIUM_IMAGE_URL,
  });
  await seedVariant(LARGE_VARIATION, "L", LARGE_PRICE, {
    stock: 0,
    mpn: LARGE_MPN,
    imageUrl: LARGE_IMAGE_URL,
  });
  // Two that must stay out of the published family: an unpriceable one and an inactive one.
  await seedVariant(UNPRICED_VARIATION, "XL", null, { stock: 4, mpn: UNPRICED_MPN });
  await seedVariant(INACTIVE_VARIATION, "S", MEDIUM_PRICE, {
    stock: 4,
    mpn: INACTIVE_MPN,
    isActive: false,
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

  // U27 — the PDP publishes one ProductGroup whose variants each carry their own exact Offer and
  // the owner-confirmed manufacturer MPN from mirrored Pancake `display_id` (ADR 0008).
  const productDocument = findDocumentWithType(documents, "ProductGroup");
  const productNodes = graphNodes(productDocument);
  const mediumUrl = `${PUBLIC_ORIGIN}/shop/${slug}?variant=${MEDIUM_VARIATION}`;
  const largeUrl = `${PUBLIC_ORIGIN}/shop/${slug}?variant=${LARGE_VARIATION}`;

  assert.deepEqual(productNodes[0], {
    "@type": "ProductGroup",
    "@id": `${PUBLIC_ORIGIN}/shop/${slug}#product`,
    name: productName,
    url: `${PUBLIC_ORIGIN}/shop/${slug}`,
    brand: {
      "@id": `${PUBLIC_ORIGIN}/#organization`,
    },
    productGroupID: productId,
    // Only the dimension these two variants actually differ on: both are the same colour.
    variesBy: ["https://schema.org/size"],
    description: editorialDescription,
    image: [TRUSTED_IMAGE_URL, LARGE_IMAGE_URL, MEDIUM_IMAGE_URL],
    hasVariant: [
      {
        "@type": "Product",
        "@id": `${largeUrl}#product`,
        name: productName,
        url: largeUrl,
        mpn: LARGE_MPN,
        color: "Đen",
        size: "L",
        image: [LARGE_IMAGE_URL],
        offers: {
          "@type": "Offer",
          url: largeUrl,
          priceCurrency: "VND",
          price: LARGE_PRICE,
          availability: "https://schema.org/OutOfStock",
        },
      },
      {
        "@type": "Product",
        "@id": `${mediumUrl}#product`,
        name: productName,
        url: mediumUrl,
        mpn: MEDIUM_MPN,
        color: "Đen",
        size: "M",
        image: [MEDIUM_IMAGE_URL],
        offers: {
          "@type": "Offer",
          url: mediumUrl,
          priceCurrency: "VND",
          price: MEDIUM_PRICE,
          availability: "https://schema.org/InStock",
        },
      },
    ],
  }, serverOutput);

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

  // One product-schema authority for the page, so an old product-level offer cannot contradict the
  // exact variant offers published above.
  const productSchemaNodes = documents.flatMap((candidate) =>
    graphNodes(candidate).filter(
      (node) => node["@type"] === "Product" || node["@type"] === "ProductGroup",
    ),
  );
  assert.equal(productSchemaNodes.length, 1, "the PDP must publish exactly one product schema node");

  const productJson = JSON.stringify(productDocument);
  assert.ok(productJson.includes(MEDIUM_MPN), "published medium variant must carry its reviewed MPN");
  assert.ok(productJson.includes(LARGE_MPN), "published large variant must carry its reviewed MPN");
  for (const forbidden of [
    "AggregateOffer",
    "lowPrice",
    "highPrice",
    "offerCount",
    "aggregateRating",
    "review",
    "gtin",
    "sku",
    "material",
    "shippingDetails",
    "hasMerchantReturnPolicy",
    // Variants the catalog cannot state exactly, their MPNs, and identities that are not public.
    UNPRICED_VARIATION,
    INACTIVE_VARIATION,
    UNPRICED_MPN,
    INACTIVE_MPN,
    mediumVariantMirrorId,
  ]) {
    assert.equal(productJson.includes(forbidden), false, `U27 must not publish ${forbidden}`);
  }

  // URL parity, over real HTTP: the URL published in each variant Offer must open that same
  // variant, with that same price and option, on the served page.
  for (const [variantUrl, size, renderedPrice] of [
    [mediumUrl, "M", "590.000"],
    [largeUrl, "L", "690.000"],
  ] as const) {
    const variantPage = await requestPath(new URL(variantUrl).pathname + new URL(variantUrl).search);
    assert.equal(variantPage.status, 200, `${variantUrl} must render\n${serverOutput}`);

    const checked = (variantPage.body.match(/<input\b[^>]*>/g) ?? []).filter(
      (tag) => tag.includes('name="storefront-size"') && tag.includes('checked=""'),
    );
    assert.equal(checked.length, 1, `${variantUrl} must preselect exactly one size`);
    assert.ok(
      checked[0]!.includes(`value="${size}"`),
      `${variantUrl} must preselect size ${size}, got ${checked[0]}`,
    );
    assert.ok(
      variantPage.body.includes(renderedPrice),
      `${variantUrl} must render the same exact price its Offer publishes`,
    );
  }

  const unknown = await requestPath(`/shop/${unknownSlug}`);
  assert.equal(unknown.status, 404, "unknown PDP must remain exact 404");
  const unknownDocuments = extractJsonLd(unknown.body);
  assert.equal(
    unknownDocuments.some((document) =>
      graphNodes(document).some(
        (node) => node["@type"] === "Product" || node["@type"] === "ProductGroup",
      ),
    ),
    false,
    "unknown PDP must not emit product structured data",
  );

  console.log(
    "P14/P16/U27 structured-data HTTP smoke passed: initial HTML contains one shared LA Clothing Organization used by WebSite publisher and ProductGroup brand, one ProductGroup carrying unique manufacturer MPNs plus exact per-variant Product/Offer facts whose published URLs reopen the same variants at the same prices, no AggregateOffer or unsupported merchant claim, no unpriceable or inactive variant, and unknown PDPs emit no product graph.",
  );
} finally {
  await stopServer();
  await rm(nextDevDirectory, { recursive: true, force: true });
  await cleanupDatabase();
  await prisma.$disconnect();
}
