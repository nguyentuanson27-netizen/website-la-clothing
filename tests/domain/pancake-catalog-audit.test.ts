import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import * as catalogAuditCli from "../../scripts/pancake-catalog-audit.ts";
import { runPancakeCatalogAudit } from "../../src/integrations/pancake/catalog-audit.ts";

test("catalog audit emits aggregate source coverage from live-shaped Pancake fields without raw product content", async () => {
  const pages: Record<number, unknown> = {
    1: { success: true, page_number: 1, page_size: 2, total_entries: 3, total_pages: 2, data: [
      { id: "variation-a", product_id: "product-a", images: ["https://cdn.example.test/catalog/123456/photo-a.jpg?token=IMAGE_QUERY_SECRET"], product: { name: "RAW_PRODUCT_NAME_SECRET", note: "PRIVATE_NOTE_SECRET", note_product: "APPROVED_DESCRIPTION_SECRET", image: "https://cdn.example.test/catalog/123456/hero-a.webp", categories: [{ id: 10, name: "RAW_CATEGORY_NAME_SECRET" }] }, variations_warehouses: [{ remain_quantity: 999999 }] },
      { id: "variation-b", product_id: "product-a", images: ["http://legacy.example.test/images/photo-b.png"], product: { name: "RAW_PRODUCT_NAME_SECRET", note: "PRIVATE_NOTE_SECRET", note_product: "APPROVED_DESCRIPTION_SECRET", image: "https://cdn.example.test/catalog/123456/hero-a.webp", categories: [{ id: 10, name: "RAW_CATEGORY_NAME_SECRET" }] } },
    ] },
    2: { success: true, page_number: 2, page_size: 2, total_entries: 3, total_pages: 2, data: [
      { id: "variation-c", product_id: "product-b", images: ["not a url"], product: { name: "SECOND_RAW_PRODUCT_NAME_SECRET", note: "SECOND_PRIVATE_NOTE_SECRET", note_product: "   ", image: null, categories: [] } },
    ] },
  };
  const requested: string[] = [];
  const client = { async getJson(endpoint: string, query?: Readonly<Record<string, string | number | boolean>>) {
    requested.push(endpoint);
    if (endpoint.endsWith("/categories")) return { success: true, data: [{ id: 10, text: "Shirts", nodes: [] }, { id: 11, text: "shirts", nodes: [] }] };
    return pages[Number(query?.page_number)];
  } };
  const report = await runPancakeCatalogAudit({ client, shopId: 4741464, pageSize: 2 });
  assert.deepEqual(report.products, { total: 2, withNoteProduct: 1, withoutNoteProduct: 1, noteProductCoveragePercent: 50, malformedNoteProductCount: 0, withCategoryAssignments: 1, categoryAssignmentCoveragePercent: 50 });
  assert.deepEqual(report.source, { rawVariationEntries: 3 });
  assert.deepEqual(report.images.origins, [
    { scheme: "http", hostname: "legacy.example.test", referenceCount: 1, pathShapes: ["/images/:file.png"] },
    { scheme: "https", hostname: "cdn.example.test", referenceCount: 2, pathShapes: ["/catalog/:id/:file.jpg", "/catalog/:id/:file.webp"] },
  ]);
  assert.equal(report.images.malformedCount, 1);
  assert.deepEqual(report.categories, { count: 2, rootCount: 2, maxDepth: 1, duplicateNormalizedNameCount: 1, duplicateIdCount: 0, assignedProductCount: 1, knownAssignmentReferenceCount: 1, unknownAssignmentReferenceCount: 0, assignmentSourceLocations: ["product.categories"], classification: "partial" });
  assert.deepEqual(requested, ["/shops/4741464/products/variations", "/shops/4741464/products/variations", "/shops/4741464/categories"]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("https://"), false);
  for (const forbidden of ["RAW_PRODUCT_NAME_SECRET", "PRIVATE_NOTE_SECRET", "APPROVED_DESCRIPTION_SECRET", "RAW_CATEGORY_NAME_SECRET", "IMAGE_QUERY_SECRET", "999999"]) assert.equal(serialized.includes(forbidden), false);
});

test("catalog audit never fetches image URLs and rejects credential-bearing URLs from origin evidence", async () => {
  const endpoints: string[] = [];
  const client = { async getJson(endpoint: string) {
    endpoints.push(endpoint);
    if (endpoint.endsWith("/categories")) return { success: true, data: [] };
    return { success: true, page_number: 1, page_size: 100, total_entries: 1, total_pages: 1, data: [{ id: "variation-a", product_id: "product-a", images: ["https://user:password@cdn.example.test/catalog/a.jpg"], product: { note_product: null, image: "https://cdn.example.test/catalog/a.jpg", categories: [] } }] };
  } };
  const report = await runPancakeCatalogAudit({ client, shopId: 4741464 });
  assert.equal(report.images.credentialBearingCount, 1);
  assert.deepEqual(report.images.origins, [{ scheme: "https", hostname: "cdn.example.test", referenceCount: 1, pathShapes: ["/catalog/:file.jpg"] }]);
  assert.equal(endpoints.some((endpoint) => endpoint.startsWith("http")), false);
});

test("catalog audit fails on inconsistent repeated product source facts", async () => {
  const client = { async getJson(endpoint: string) {
    if (endpoint.endsWith("/categories")) return { success: true, data: [] };
    return { success: true, page_number: 1, page_size: 100, total_entries: 2, total_pages: 1, data: [
      { id: "variation-a", product_id: "product-a", images: [], product: { note_product: "A", image: null, categories: [] } },
      { id: "variation-b", product_id: "product-a", images: [], product: { note_product: "B", image: null, categories: [] } },
    ] };
  } };
  await assert.rejects(() => runPancakeCatalogAudit({ client, shopId: 4741464 }), /inconsistent repeated product source facts/i);
});

test("trusted-local catalog audit refuses CI before reading Pancake credentials", () => {
  const apiKey = "P0_API_KEY_SECRET";
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/pancake-catalog-audit.ts"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", PANCAKE_API_KEY: apiKey, PANCAKE_SHOP_ID: "4741464" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /catalog audit refuses CI execution/i);
  assert.equal(result.stderr.includes(apiKey), false);
});

test("catalog audit failure formatter never echoes external error values", () => {
  const formatter = Reflect.get(catalogAuditCli, "catalogAuditFailureMessage");
  assert.equal(typeof formatter, "function");
  const secret = "RAW_EXTERNAL_ERROR_SECRET";
  const message = (formatter as (error: unknown) => string)(new Error(secret));
  assert.match(message, /failed without logging credentials or raw Pancake payload values/i);
  assert.equal(message.includes(secret), false);
});

test("catalog audit counts malformed source values without echoing them", async () => {
  const oversizedNote = "N".repeat(100_001);
  const client = { async getJson(endpoint: string) {
    if (endpoint.endsWith("/categories")) return { success: true, data: [] };
    return { success: true, page_number: 1, page_size: 100, total_entries: 1, total_pages: 1, data: [{ id: "variation-a", product_id: "product-a", images: [], product: { note_product: oversizedNote, image: { raw: "PRODUCT_IMAGE_SECRET" }, categories: [] } }] };
  } };
  const report = await runPancakeCatalogAudit({ client, shopId: 4741464 });
  assert.equal(report.products.malformedNoteProductCount, 1);
  assert.equal(report.images.malformedCount, 1);
  assert.equal(JSON.stringify(report).includes("PRODUCT_IMAGE_SECRET"), false);
});

test("catalog audit fails closed when pagination exceeds bounded traversal", async () => {
  const client = { async getJson() { return { success: true, page_number: 1, page_size: 100, total_entries: 1, total_pages: 501, data: [] }; } };
  await assert.rejects(() => runPancakeCatalogAudit({ client, shopId: 4741464 }), /traversal limit exceeded/i);
});

test("catalog audit discovers variation-level category assignment source without promoting it to production contract", async () => {
  const client = { async getJson(endpoint: string) {
    if (endpoint.endsWith("/categories")) return { success: true, data: [{ id: 20, text: "Outerwear", nodes: [] }] };
    return { success: true, page_number: 1, page_size: 100, total_entries: 1, total_pages: 1, data: [{ id: "variation-a", product_id: "product-a", images: [], categories: [{ id: "20" }], product: { note_product: null, image: null } }] };
  } };
  const report = await runPancakeCatalogAudit({ client, shopId: 4741464 });
  assert.deepEqual(report.categories.assignmentSourceLocations, ["variation.categories"]);
  assert.equal(report.categories.knownAssignmentReferenceCount, 1);
  assert.equal(report.categories.unknownAssignmentReferenceCount, 0);
  assert.equal(report.products.withCategoryAssignments, 1);
});

test("flat unique source taxonomy can be usable when assignment coverage is complete", async () => {
  const client = { async getJson(endpoint: string) {
    if (endpoint.endsWith("/categories")) return { success: true, data: [{ id: 1, text: "Shirts", nodes: [] }] };
    return { success: true, page_number: 1, page_size: 100, total_entries: 1, total_pages: 1, data: [{ id: "variation-a", product_id: "product-a", images: [], product: { note_product: null, image: null, categories: [{ id: 1 }] } }] };
  } };
  const report = await runPancakeCatalogAudit({ client, shopId: 4741464 });
  assert.equal(report.categories.maxDepth, 1);
  assert.equal(report.categories.classification, "usable");
});

test("category assignments fail closed when product and variation source locations disagree", async () => {
  const client = { async getJson() { return { success: true, page_number: 1, page_size: 100, total_entries: 1, total_pages: 1, data: [{ id: "variation-a", product_id: "product-a", images: [], categories: [{ id: 2 }], product: { note_product: null, image: null, categories: [{ id: 1 }] } }] }; } };
  await assert.rejects(() => runPancakeCatalogAudit({ client, shopId: 4741464 }), /category assignments disagree/i);
});
