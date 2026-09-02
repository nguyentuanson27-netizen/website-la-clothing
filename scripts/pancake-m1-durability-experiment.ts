import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  compareCorrelatedObservations,
  type CorrelatedProductObservation,
  type CorrelatedVariationObservation,
  type RawCorrelatedRunObservation,
} from "../src/commerce/merchant-identity-durability.ts";
import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

export const EXPECTED_A132_PRODUCT_ID = "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d";
export const EXPECTED_SHOP_ID = 1635185058;
export const CI_REFUSAL_MESSAGE = "Pancake M1 durability experiment must not run in CI environments";
export const APPROVAL_REQUIRED_MESSAGE =
  "Pancake M1 durability experiment requires explicit operator approval via M1_EXPERIMENT_APPROVED=a132 or --product=a132 --allow-production-mutation";

function isEnvironmentFlagEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function assertM1ExperimentEnvironment(
  env: Record<string, string | undefined> = process.env,
  args: readonly string[] = process.argv.slice(2),
): { shopId: number; approvedTarget: string } {
  if (isEnvironmentFlagEnabled(env.CI) || isEnvironmentFlagEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }

  const envApproval = env.M1_EXPERIMENT_APPROVED?.trim().toLowerCase();
  const hasCliApproval =
    args.includes("--allow-production-mutation") &&
    (args.includes("--product=a132") || (args.includes("-p") && args.includes("a132")));

  if (envApproval !== "a132" && !hasCliApproval) {
    throw new Error(APPROVAL_REQUIRED_MESSAGE);
  }

  const shopIdRaw = env.PANCAKE_SHOP_ID ?? "";
  const shopId = Number.parseInt(shopIdRaw, 10);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError("PANCAKE_SHOP_ID must be a positive safe integer");
  }

  if (shopId !== EXPECTED_SHOP_ID) {
    throw new Error(
      `Pancake M1 durability experiment is scoped exclusively to shop ${EXPECTED_SHOP_ID}, got ${shopId}`,
    );
  }

  return { shopId, approvedTarget: "a132" };
}

export interface RawPancakeVariation {
  id: string;
  custom_id?: string | null;
  display_id?: string | number | null;
  barcode?: string | null;
  retail_price?: number | string;
  is_hidden?: boolean;
  product_id?: string;
  product?: { name?: string; note_product?: string };
  fields?: { name?: string; value?: string }[];
}

export interface RawPancakeProduct {
  id: string;
  name?: string;
  custom_id?: string;
  display_id?: string;
  note_product?: string;
  categories?: { id: number | string }[];
  tags?: { id: number | string }[];
  product_attributes?: unknown[];
  variations?: RawPancakeVariation[];
}

export interface PancakeApiResponse<T> {
  success?: boolean;
  data?: T;
  total_pages?: number;
  total_entries?: number;
  message?: string;
}

export type ProductA132Snapshot = Readonly<{
  id: string;
  name: string;
  custom_id: string;
  display_id: string;
  note_product: string;
  categoryIds: readonly number[];
  tags: readonly number[];
  productAttributes: readonly unknown[];
  variations: readonly Readonly<{
    id: string;
    custom_id: string | null;
    display_id: string | null;
    barcode: string | null;
    retail_price: number;
    is_hidden: boolean;
    fields: readonly Readonly<{ name: string; value: string }>[];
  }>[];
}>;

export async function resolveA132Target(
  client: PancakeClient,
  shopId: number,
): Promise<{ productId: string; snapshot: ProductA132Snapshot }> {
  const searchRes = (await client.getJson(`/shops/${shopId}/products`, {
    page_size: 50,
    page_number: 1,
    search: "a132",
  })) as PancakeApiResponse<RawPancakeProduct[]>;

  const matches = (searchRes.data || []).filter(
    (p: RawPancakeProduct) =>
      p.id === EXPECTED_A132_PRODUCT_ID ||
      p.custom_id?.toLowerCase() === "a132" ||
      p.name?.toLowerCase().includes("a132"),
  );

  if (matches.length === 0) {
    throw new Error("Target product a132 could not be resolved in shop catalog");
  }
  if (matches.length > 1) {
    throw new Error(`Target product a132 resolution is ambiguous: found ${matches.length} matching products`);
  }

  const matchedProduct = matches[0]!;
  if (matchedProduct.id !== EXPECTED_A132_PRODUCT_ID) {
    throw new Error(
      `Resolved product ID ${matchedProduct.id} does not match expected A132 ID ${EXPECTED_A132_PRODUCT_ID}`,
    );
  }

  // Fetch full product details
  const fullRes = (await client.getJson(
    `/shops/${shopId}/products/${matchedProduct.id}`,
  )) as PancakeApiResponse<RawPancakeProduct>;
  const prod = fullRes.data;
  if (!prod) {
    throw new Error(`Failed to fetch full product details for ${matchedProduct.id}`);
  }

  const variations = (prod.variations || []).map((v: RawPancakeVariation) => ({
    id: String(v.id),
    custom_id: v.custom_id !== undefined && v.custom_id !== null ? String(v.custom_id) : null,
    display_id: v.display_id !== undefined && v.display_id !== null ? String(v.display_id) : null,
    barcode: v.barcode ? String(v.barcode) : null,
    retail_price: Number(v.retail_price) || 0,
    is_hidden: Boolean(v.is_hidden),
    fields: (v.fields || []).map((f) => ({
      name: String(f.name || ""),
      value: String(f.value || ""),
    })),
  }));

  if (variations.length === 0) {
    throw new Error(`Product a132 has no variations in shop ${shopId}`);
  }

  const snapshot: ProductA132Snapshot = Object.freeze({
    id: String(prod.id),
    name: String(prod.name || ""),
    custom_id: String(prod.custom_id || ""),
    display_id: String(prod.display_id || ""),
    note_product: String(prod.note_product || ""),
    categoryIds: Object.freeze((prod.categories || []).map((c) => Number(c.id))),
    tags: Object.freeze((prod.tags || []).map((t) => Number(t.id))),
    productAttributes: Object.freeze(prod.product_attributes || []),
    variations: Object.freeze(variations.map((v) => Object.freeze(v))),
  });

  return { productId: matchedProduct.id, snapshot };
}

export async function restoreA132Product(
  client: PancakeClient,
  shopId: number,
  snapshot: ProductA132Snapshot,
): Promise<{ restored: true; verifiedFieldsMatch: boolean }> {
  const restorePayload = {
    product: {
      name: snapshot.name,
      custom_id: snapshot.custom_id,
      note_product: snapshot.note_product,
      category_ids: [...snapshot.categoryIds],
      tags: [...snapshot.tags],
      product_attributes: [...snapshot.productAttributes],
      variations: snapshot.variations.map((v) => ({
        id: v.id,
        fields: v.fields.map((f) => ({ name: f.name, value: f.value })),
        retail_price: v.retail_price,
        custom_id: v.custom_id ?? v.display_id,
        is_hidden: v.is_hidden,
      })),
    },
  };

  const putRes = (await client.putJson(
    `/shops/${shopId}/products/${snapshot.id}`,
    restorePayload,
  )) as PancakeApiResponse<RawPancakeProduct>;
  if (!putRes?.success) {
    throw new Error(`Restoration PUT failed for product ${snapshot.id}`);
  }

  // Verification GET
  const freshRes = (await client.getJson(
    `/shops/${shopId}/products/${snapshot.id}`,
  )) as PancakeApiResponse<RawPancakeProduct>;
  const freshProd = freshRes.data;
  if (!freshProd) {
    throw new Error(`Verification GET failed after restoration for ${snapshot.id}`);
  }

  const nameMatches = freshProd.name === snapshot.name;
  const customIdMatches = freshProd.custom_id === snapshot.custom_id;
  const noteProductMatches = (freshProd.note_product || "") === snapshot.note_product;

  const freshVarMap = new Map<string, RawPancakeVariation>();
  for (const v of freshProd.variations || []) {
    freshVarMap.set(String(v.id), v);
  }

  let allVariationsMatch = freshProd.variations?.length === snapshot.variations.length;
  for (const origVar of snapshot.variations) {
    const freshVar = freshVarMap.get(origVar.id);
    if (!freshVar) {
      allVariationsMatch = false;
      break;
    }

    const freshCustomId =
      freshVar.custom_id !== undefined && freshVar.custom_id !== null
        ? String(freshVar.custom_id)
        : null;
    const freshDisplayId =
      freshVar.display_id !== undefined && freshVar.display_id !== null
        ? String(freshVar.display_id)
        : null;

    if (origVar.custom_id !== null && freshCustomId !== origVar.custom_id) {
      allVariationsMatch = false;
    }
    if (origVar.display_id !== null && freshDisplayId !== origVar.display_id) {
      allVariationsMatch = false;
    }
  }

  const verifiedFieldsMatch = nameMatches && customIdMatches && noteProductMatches && allVariationsMatch;
  if (!verifiedFieldsMatch) {
    throw new Error(
      `FATAL: Restoration verification failed for product ${snapshot.id}. Expected original values were not fully restored!`,
    );
  }

  return { restored: true, verifiedFieldsMatch: true };
}

export async function fetchFullPancakeCatalog(
  client: PancakeClient,
  shopId: number,
  options: { pageSize?: number } = {},
): Promise<{
  allVariations: RawPancakeVariation[];
  totalPages: number;
  totalEntries: number;
  pagesTraversed: number;
}> {
  const pageSize = options.pageSize ?? 100;
  let pageNumber = 1;
  let totalPages = 1;
  let expectedTotalEntries: number | null = null;
  const allVariations: RawPancakeVariation[] = [];
  const requestedPages = new Set<number>();

  while (pageNumber <= totalPages) {
    if (requestedPages.has(pageNumber)) {
      throw new Error(`Pagination error: page ${pageNumber} already requested`);
    }
    requestedPages.add(pageNumber);

    const pageRes = (await client.getJson(`/shops/${shopId}/products/variations`, {
      page_size: pageSize,
      page_number: pageNumber,
    })) as PancakeApiResponse<RawPancakeVariation[]>;

    if (!pageRes || !Array.isArray(pageRes.data)) {
      throw new Error(`Pagination error: invalid page payload on page ${pageNumber}`);
    }

    const pageTotalPages = pageRes.total_pages ?? Math.ceil((pageRes.total_entries || 0) / pageSize) ?? 1;
    if (typeof pageTotalPages !== "number" || pageTotalPages <= 0) {
      throw new Error(`Pagination error: total_pages must be > 0, got ${pageTotalPages}`);
    }

    if (pageNumber === 1) {
      totalPages = pageTotalPages;
      expectedTotalEntries = typeof pageRes.total_entries === "number" ? pageRes.total_entries : null;
    } else if (pageTotalPages !== totalPages) {
      throw new Error(
        `Pagination drift detected: total_pages changed from ${totalPages} to ${pageTotalPages} on page ${pageNumber}`,
      );
    }

    allVariations.push(...pageRes.data);
    pageNumber += 1;
  }

  // Completeness checks
  if (requestedPages.size !== totalPages) {
    throw new Error(
      `Pagination incomplete: requested ${requestedPages.size} pages but expected ${totalPages}`,
    );
  }

  for (let p = 1; p <= totalPages; p += 1) {
    if (!requestedPages.has(p)) {
      throw new Error(`Pagination incomplete: missing page ${p} of ${totalPages}`);
    }
  }

  if (expectedTotalEntries !== null && allVariations.length !== expectedTotalEntries) {
    throw new Error(
      `Pagination count mismatch: collected ${allVariations.length} variations but API declared ${expectedTotalEntries} total_entries`,
    );
  }

  return {
    allVariations,
    totalPages,
    totalEntries: expectedTotalEntries ?? allVariations.length,
    pagesTraversed: requestedPages.size,
  };
}

export type M1DurabilityExperimentReport = Readonly<{
  target: Readonly<{
    productId: string;
    productName: string;
    customId: string;
    displayId: string;
    variationCount: number;
  }>;
  safety: Readonly<{
    fieldsMutated: readonly string[];
    originalSnapshotCaptured: boolean;
    restorationVerified: boolean;
  }>;
  markers: Readonly<{
    runId: string;
    productMarker: string;
    variationMarkers: Readonly<Record<string, string>>;
  }>;
  customIdEvidence: Readonly<{
    originalVariations: readonly Readonly<{ id: string; customId: string | null; displayId: string | null }>[];
    temporaryMarkers: Readonly<Record<string, string>>;
    restoredVariations: readonly Readonly<{ id: string; customId: string | null; displayId: string | null }>[];
  }>;
  observations: readonly RawCorrelatedRunObservation[];
  comparison: ReturnType<typeof compareCorrelatedObservations>;
  productionProductRestored: boolean;
  verdict: "M1 DURABILITY: PROVEN via §3.3 Option B" | "M1 DURABILITY: BLOCKED";
}>;

export async function runM1DurabilityExperiment(options: {
  delayMs?: number;
} = {}): Promise<M1DurabilityExperimentReport> {
  const { shopId } = assertM1ExperimentEnvironment();
  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const delayMs = options.delayMs ?? 1000;

  // 1. Target resolution & baseline snapshot
  const { productId, snapshot } = await resolveA132Target(client, shopId);

  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const productMarker = `M1-A132-P-${runId}`;

  // Variation markers keyed by Size field
  const variationMarkers: Record<string, string> = {};
  for (const v of snapshot.variations) {
    const sizeField = v.fields.find((f) => f.name.toLowerCase() === "size")?.value ?? v.id.slice(0, 4);
    variationMarkers[v.id] = `M1-A132-V-${sizeField}-${runId}`;
  }
  const expectedVariationMarkers = Object.values(variationMarkers);

  const observations: RawCorrelatedRunObservation[] = [];
  let restorationResult: { restored: boolean; verifiedFieldsMatch: boolean } | null = null;
  let finalVerifiedProd: RawPancakeProduct | null = null;

  try {
    // 2. Setup: Apply independent markers to a132
    const setupPayload = {
      product: {
        name: snapshot.name,
        custom_id: snapshot.custom_id,
        note_product: productMarker,
        category_ids: [...snapshot.categoryIds],
        tags: [...snapshot.tags],
        product_attributes: [...snapshot.productAttributes],
        variations: snapshot.variations.map((v) => ({
          id: v.id,
          fields: v.fields.map((f) => ({ name: f.name, value: f.value })),
          retail_price: v.retail_price,
          custom_id: variationMarkers[v.id],
          is_hidden: v.is_hidden,
        })),
      },
    };

    await client.putJson(`/shops/${shopId}/products/${productId}`, setupPayload);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // Helper: full raw catalog fetch and correlate strictly without tested ID fallback
    async function captureObservation(
      runIndex: number,
      phase: string,
      expectedPhaseProductMarker: string,
    ): Promise<RawCorrelatedRunObservation> {
      const { allVariations, totalPages, totalEntries } = await fetchFullPancakeCatalog(
        client,
        shopId,
      );

      // Locate audit variations by INDEPENDENT MARKERS (not by Pancake IDs!)
      const matchedVariations: CorrelatedVariationObservation[] = [];
      const parentProductIds = new Set<string>();
      let locatedProductName = "";

      for (const marker of expectedVariationMarkers) {
        const matches = allVariations.filter(
          (v) => String(v.display_id || "") === marker || String(v.custom_id || "") === marker,
        );

        if (matches.length === 0) {
          throw new Error(
            `Independent correlation failed in phase ${phase}: expected variation marker ${marker} was not found in raw catalog`,
          );
        }
        if (matches.length > 1) {
          throw new Error(
            `Independent correlation failed in phase ${phase}: duplicate matches found for variation marker ${marker}`,
          );
        }

        const v = matches[0]!;
        matchedVariations.push({
          variationMarker: marker,
          pancakeVariationId: String(v.id),
          displayId: String(v.display_id || ""),
          size: v.fields?.find((f) => f.name?.toLowerCase() === "size")?.value,
          barcode: v.barcode ? String(v.barcode) : null,
        });

        if (v.product_id) {
          parentProductIds.add(String(v.product_id));
        }
        if (v.product?.name) {
          locatedProductName = String(v.product.name);
        }
      }

      // Check Option B: All marked variations must share exactly one product_id
      if (parentProductIds.size === 0) {
        throw new Error(
          `Independent correlation failed in phase ${phase}: marked variations have no associated product_id`,
        );
      }
      if (parentProductIds.size > 1) {
        throw new Error(
          `Independent correlation failed in phase ${phase}: marked variations span multiple parent product IDs: ${[...parentProductIds].join(", ")}`,
        );
      }

      const locatedProductId = [...parentProductIds][0]!;

      // Check Option A: The parent product note_product must match expectedPhaseProductMarker
      const firstMatched = allVariations.find((v) => String(v.product_id) === locatedProductId);
      const observedNote = firstMatched?.product?.note_product ?? "";
      if (observedNote !== expectedPhaseProductMarker) {
        // Double-check via raw products search endpoint without using productId in path
        const pSearchRes = (await client.getJson(`/shops/${shopId}/products`, {
          page_size: 50,
          page_number: 1,
          search: "a132",
        })) as PancakeApiResponse<RawPancakeProduct[]>;
        const pMatch = (pSearchRes.data || []).find((p) => p.note_product === expectedPhaseProductMarker);
        if (!pMatch || pMatch.id !== locatedProductId) {
          throw new Error(
            `Independent correlation failed in phase ${phase}: upstream product note_product does not match expected marker ${expectedPhaseProductMarker}`,
          );
        }
      }

      // Sort matched variations by marker for consistent ordering
      matchedVariations.sort((a, b) => a.variationMarker.localeCompare(b.variationMarker));

      const observedProduct: CorrelatedProductObservation = {
        productMarker: expectedPhaseProductMarker,
        pancakeProductId: locatedProductId,
        productName: locatedProductName,
        variations: matchedVariations,
      };

      return {
        runIndex,
        phase,
        timestamp: new Date().toISOString(),
        totalCatalogEntries: totalEntries,
        totalCatalogPages: totalPages,
        auditProduct: observedProduct,
      };
    }

    // 3. T0 — Baseline Observation
    const obs0 = await captureObservation(0, "T0_BASELINE", productMarker);
    observations.push(obs0);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 4. Mutation 1 — Safe reversible mutation on metadata field (note_product)
    const mut1ProductMarker = `${productMarker}|MUT1`;
    const mut1Payload = {
      ...setupPayload,
      product: {
        ...setupPayload.product,
        note_product: mut1ProductMarker,
      },
    };
    await client.putJson(`/shops/${shopId}/products/${productId}`, mut1Payload);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 5. T1 — Observation after Mutation 1
    const obs1 = await captureObservation(1, "T1_AFTER_MUTATION_1", mut1ProductMarker);
    observations.push(obs1);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 6. Mutation 2 — Second safe metadata mutation
    const mut2ProductMarker = `${productMarker}|MUT2`;
    const mut2Payload = {
      ...setupPayload,
      product: {
        ...setupPayload.product,
        note_product: mut2ProductMarker,
      },
    };
    await client.putJson(`/shops/${shopId}/products/${productId}`, mut2Payload);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 7. T2 — Observation after Mutation 2
    const obs2 = await captureObservation(2, "T2_AFTER_MUTATION_2", mut2ProductMarker);
    observations.push(obs2);
  } finally {
    // 8. GUARANTEED RESTORATION
    restorationResult = await restoreA132Product(client, shopId, snapshot);

    // Fresh verification read of final product state
    const verifyRes = (await client.getJson(
      `/shops/${shopId}/products/${productId}`,
    )) as PancakeApiResponse<RawPancakeProduct>;
    finalVerifiedProd = verifyRes.data ?? null;
  }

  // 9. Pure comparison & verdict evaluation with explicit expected markers from T0 onward
  const comparison = compareCorrelatedObservations({
    expectedProductMarker: productMarker,
    expectedVariationMarkers,
    runs: observations,
  });

  const isProven =
    comparison.verdict === "STABLE" &&
    comparison.allMarkersRetainedSameIds &&
    !comparison.remapDetected &&
    restorationResult?.verifiedFieldsMatch === true;

  const originalVariations = snapshot.variations.map((v) => ({
    id: v.id,
    customId: v.custom_id,
    displayId: v.display_id,
  }));

  const restoredVariations = (finalVerifiedProd?.variations || []).map((v) => ({
    id: String(v.id),
    customId: v.custom_id !== undefined && v.custom_id !== null ? String(v.custom_id) : null,
    displayId: v.display_id !== undefined && v.display_id !== null ? String(v.display_id) : null,
  }));

  return Object.freeze({
    target: Object.freeze({
      productId: snapshot.id,
      productName: snapshot.name,
      customId: snapshot.custom_id,
      displayId: snapshot.display_id,
      variationCount: snapshot.variations.length,
    }),
    safety: Object.freeze({
      fieldsMutated: Object.freeze(["note_product", "variations[].custom_id"]),
      originalSnapshotCaptured: true,
      restorationVerified: restorationResult?.verifiedFieldsMatch ?? false,
    }),
    markers: Object.freeze({
      runId,
      productMarker,
      variationMarkers: Object.freeze({ ...variationMarkers }),
    }),
    customIdEvidence: Object.freeze({
      originalVariations: Object.freeze(originalVariations),
      temporaryMarkers: Object.freeze({ ...variationMarkers }),
      restoredVariations: Object.freeze(restoredVariations),
    }),
    observations: Object.freeze([...observations]),
    comparison,
    productionProductRestored: restorationResult?.verifiedFieldsMatch ?? false,
    verdict: isProven
      ? ("M1 DURABILITY: PROVEN via §3.3 Option B" as const)
      : ("M1 DURABILITY: BLOCKED" as const),
  });
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    assertM1ExperimentEnvironment();
    console.log("PANCAKE_M1_EXPERIMENT_BEGIN");
    const result = await runM1DurabilityExperiment();
    console.log(JSON.stringify(result, null, 2));
    console.log("PANCAKE_M1_EXPERIMENT_END");
  } catch (error) {
    console.error(`M1 durability experiment failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
