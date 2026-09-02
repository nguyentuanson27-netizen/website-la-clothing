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

interface RawPancakeVariation {
  id: string;
  display_id?: string;
  barcode?: string | null;
  retail_price?: number | string;
  is_hidden?: boolean;
  product_id?: string;
  product?: { name?: string };
  fields?: { name?: string; value?: string }[];
}

interface RawPancakeProduct {
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

interface PancakeApiResponse<T> {
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
    display_id: string;
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
  const fullRes = (await client.getJson(`/shops/${shopId}/products/${matchedProduct.id}`)) as PancakeApiResponse<RawPancakeProduct>;
  const prod = fullRes.data;
  if (!prod) {
    throw new Error(`Failed to fetch full product details for ${matchedProduct.id}`);
  }

  const variations = (prod.variations || []).map((v: RawPancakeVariation) => ({
    id: String(v.id),
    display_id: String(v.display_id || ""),
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
        custom_id: v.display_id,
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

  const freshVarMap = new Map<string, string>();
  for (const v of freshProd.variations || []) {
    freshVarMap.set(String(v.id), String(v.display_id || ""));
  }

  let allVariationsMatch = freshProd.variations?.length === snapshot.variations.length;
  for (const origVar of snapshot.variations) {
    if (freshVarMap.get(origVar.id) !== origVar.display_id) {
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

  const observations: RawCorrelatedRunObservation[] = [];
  let restorationResult: { restored: boolean; verifiedFieldsMatch: boolean } | null = null;

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

    // Helper: full raw catalog fetch and correlate
    async function captureObservation(
      runIndex: number,
      phase: string,
    ): Promise<RawCorrelatedRunObservation> {
      const allVariations: RawPancakeVariation[] = [];
      let pageNumber = 1;
      const pageSize = 100;
      let totalPages = 1;
      let totalEntries = 0;

      while (pageNumber <= totalPages) {
        const pageRes = (await client.getJson(`/shops/${shopId}/products/variations`, {
          page_size: pageSize,
          page_number: pageNumber,
        })) as PancakeApiResponse<RawPancakeVariation[]>;

        totalPages = pageRes.total_pages || Math.ceil((pageRes.total_entries || 0) / pageSize) || 1;
        totalEntries = pageRes.total_entries || 0;
        const data = pageRes.data || [];
        allVariations.push(...data);
        pageNumber += 1;
      }

      // Locate audit product and variations by INDEPENDENT MARKERS (not by Pancake IDs!)
      const matchedVariations: CorrelatedVariationObservation[] = [];
      let locatedProductId: string | null = null;
      let locatedProductName = "";

      for (const v of allVariations) {
        // Match variation by display_id matching our variation marker
        const vDisplayId = String(v.display_id || "");
        const matchingEntry = Object.entries(variationMarkers).find(([, marker]) => marker === vDisplayId);

        if (matchingEntry) {
          matchedVariations.push({
            variationMarker: matchingEntry[1],
            pancakeVariationId: String(v.id),
            displayId: vDisplayId,
            size: v.fields?.find((f) => f.name?.toLowerCase() === "size")?.value,
            barcode: v.barcode ? String(v.barcode) : null,
          });

          if (!locatedProductId && v.product_id) {
            locatedProductId = String(v.product_id);
            locatedProductName = String(v.product?.name || "");
          }
        }
      }

      if (!locatedProductId) {
        // Fallback check product directly if variations pagination somehow missed
        const pRes = (await client.getJson(
          `/shops/${shopId}/products/${productId}`,
        )) as PancakeApiResponse<RawPancakeProduct>;
        locatedProductId = String(pRes.data?.id);
        locatedProductName = String(pRes.data?.name || "");
      }

      // Sort matched variations by marker for consistent ordering
      matchedVariations.sort((a, b) => a.variationMarker.localeCompare(b.variationMarker));

      const observedProduct: CorrelatedProductObservation = {
        productMarker,
        pancakeProductId: locatedProductId,
        productName: locatedProductName,
        variations: matchedVariations,
      };

      return {
        runIndex,
        phase,
        timestamp: new Date().toISOString(),
        totalCatalogEntries: totalEntries || allVariations.length,
        totalCatalogPages: totalPages,
        auditProduct: observedProduct,
      };
    }

    // 3. T0 — Baseline Observation
    const obs0 = await captureObservation(0, "T0_BASELINE");
    observations.push(obs0);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 4. Mutation 1 — Safe reversible mutation on metadata field (note_product)
    const mut1Payload = {
      ...setupPayload,
      product: {
        ...setupPayload.product,
        note_product: `${productMarker}|MUT1`,
      },
    };
    await client.putJson(`/shops/${shopId}/products/${productId}`, mut1Payload);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 5. T1 — Observation after Mutation 1
    const obs1 = await captureObservation(1, "T1_AFTER_MUTATION_1");
    observations.push(obs1);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 6. Mutation 2 — Second safe metadata mutation
    const mut2Payload = {
      ...setupPayload,
      product: {
        ...setupPayload.product,
        note_product: `${productMarker}|MUT2`,
      },
    };
    await client.putJson(`/shops/${shopId}/products/${productId}`, mut2Payload);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // 7. T2 — Observation after Mutation 2
    const obs2 = await captureObservation(2, "T2_AFTER_MUTATION_2");
    observations.push(obs2);
  } finally {
    // 8. GUARANTEED RESTORATION
    restorationResult = await restoreA132Product(client, shopId, snapshot);
  }

  // 9. Pure comparison & verdict evaluation
  const comparison = compareCorrelatedObservations(observations);

  const isProven =
    comparison.verdict === "STABLE" &&
    comparison.allMarkersRetainedSameIds &&
    !comparison.remapDetected &&
    restorationResult?.verifiedFieldsMatch === true;

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
