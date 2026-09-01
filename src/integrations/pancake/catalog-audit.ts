import { createHash } from "node:crypto";

const LIMITS = {
  pageSize: 100,
  pages: 500,
  entries: 50_000,
  categories: 10_000,
  categoryDepth: 32,
  idLength: 512,
  categoryNameLength: 256,
  noteLength: 100_000,
  imageUrlLength: 4_096,
  imageReferences: 100_000,
  pricingExamples: 10,
} as const;

const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const SAFE_PATH_SEGMENTS = new Set([
  "asset", "assets", "catalog", "file", "files", "image", "images", "media",
  "original", "originals", "pos", "product", "products", "public", "shop", "shops",
  "static", "storage", "upload", "uploads", "web",
]);

type QueryValue = string | number | boolean;
type JsonRecord = Record<string, unknown>;
type AuditClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};
type SourceState = "missing" | `present:${string}` | `malformed:${string}`;
type ProductSnapshot = {
  noteState: SourceState;
  imageState: SourceState;
  categoryIds: readonly string[];
};
type ImageState = {
  totalReferences: number;
  malformedCount: number;
  credentialBearingCount: number;
  nonDefaultPortCount: number;
  origins: Map<string, { referenceCount: number; pathShapes: Set<string> }>;
};

export type PricingExample = Readonly<{
  variationId: string;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
}>;

export type PancakeCatalogAuditReport = {
  products: {
    total: number;
    withNoteProduct: number;
    withoutNoteProduct: number;
    noteProductCoveragePercent: number;
    malformedNoteProductCount: number;
    withCategoryAssignments: number;
    categoryAssignmentCoveragePercent: number;
  };
  source: { rawVariationEntries: number };
  images: {
    totalReferences: number;
    malformedCount: number;
    credentialBearingCount: number;
    nonDefaultPortCount: number;
    origins: Array<{
      scheme: string;
      hostname: string;
      referenceCount: number;
      pathShapes: string[];
    }>;
  };
  categories: {
    count: number;
    rootCount: number;
    maxDepth: number;
    duplicateNormalizedNameCount: number;
    duplicateIdCount: number;
    assignedProductCount: number;
    knownAssignmentReferenceCount: number;
    unknownAssignmentReferenceCount: number;
    assignmentSourceLocations: string[];
    classification: "usable" | "partial" | "empty" | "unusable";
  };
  pricing: {
    totalVariations: number;
    equalRetailAndDiscount: number;
    discountLowerThanRetail: number;
    discountHigherThanRetail: number;
    retailNullOrMalformed: number;
    discountNullOrMalformed: number;
    bothUnusable: number;
    lowerExamples: readonly PricingExample[];
    higherExamples: readonly PricingExample[];
  };
};

export class PancakeCatalogAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PancakeCatalogAuditError";
  }
}

function fail(message: string): never {
  throw new PancakeCatalogAuditError(message);
}

function record(value: unknown, message: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(message);
  return value as JsonRecord;
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) fail(message);
  return value;
}

function safeInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(message);
  return value;
}

function boundedString(value: unknown, maxLength: number, message: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) fail(message);
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashedCategoryId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return hash(`i:${String(value)}`);
  if (typeof value !== "string") fail("Pancake product category id is malformed");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > LIMITS.idLength) {
    fail("Pancake product category id is malformed");
  }
  if (/^-?\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isSafeInteger(parsed)) return hash(`i:${String(parsed)}`);
  }
  return hash(`s:${normalized}`);
}

function noteState(value: unknown): SourceState {
  if (value === undefined || value === null) return "missing";
  if (typeof value !== "string") return `malformed:${Array.isArray(value) ? "array" : typeof value}`;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "missing";
  if (trimmed.length > LIMITS.noteLength) return "malformed:oversize";
  return `present:${hash(trimmed)}`;
}

function imageEqualityState(value: unknown): SourceState {
  if (value === undefined || value === null || value === "") return "missing";
  if (typeof value !== "string") return `malformed:${Array.isArray(value) ? "array" : typeof value}`;
  if (value.length > LIMITS.imageUrlLength) return "malformed:oversize";
  return `present:${hash(value)}`;
}

function categoryIds(value: unknown, location: string): string[] {
  if (value === undefined || value === null) return [];
  const ids = array(value, `Pancake ${location} payload is malformed`).map((entry) => {
    return hashedCategoryId(record(entry, `Pancake ${location} item is malformed`).id);
  });
  ids.sort();
  return ids;
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readAssignments(product: JsonRecord, variation: JsonRecord): {
  ids: string[];
  locations: string[];
} {
  const locations: string[] = [];
  let productIds: string[] | undefined;
  let variationIds: string[] | undefined;

  if (Object.hasOwn(product, "categories")) {
    locations.push("product.categories");
    productIds = categoryIds(product.categories, "product categories");
  }
  if (Object.hasOwn(variation, "categories")) {
    locations.push("variation.categories");
    variationIds = categoryIds(variation.categories, "variation categories");
  }
  if (productIds && variationIds && !same(productIds, variationIds)) {
    fail("Pancake product category assignments disagree across observed source locations");
  }

  return { ids: productIds ?? variationIds ?? [], locations };
}

function sameProduct(left: ProductSnapshot, right: ProductSnapshot): boolean {
  return (
    left.noteState === right.noteState &&
    left.imageState === right.imageState &&
    same(left.categoryIds, right.categoryIds)
  );
}

function isDynamicSegment(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
    /^[0-9a-f]{20,}$/i.test(segment) ||
    /^[A-Za-z0-9_-]{28,}$/.test(segment)
  );
}

function pathShape(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const visible = segments.slice(0, 5);
  const shaped = visible.map((segment, index) => {
    const lower = segment.toLowerCase();
    const extension = lower.match(/\.([a-z0-9]+)$/)?.[1];
    if (index === visible.length - 1 && extension && IMAGE_EXTENSIONS.has(extension)) {
      return `:file.${extension}`;
    }
    if (isDynamicSegment(segment)) return ":id";
    if (!/^[A-Za-z0-9._-]{1,24}$/.test(segment)) return ":segment";
    return SAFE_PATH_SEGMENTS.has(lower) ? lower : ":segment";
  });
  return `/${shaped.join("/")}${segments.length > visible.length ? "/**" : ""}`;
}

function addImage(value: unknown, state: ImageState): void {
  state.totalReferences += 1;
  if (state.totalReferences > LIMITS.imageReferences) fail("Pancake catalog image-reference limit exceeded");
  if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.imageUrlLength) {
    state.malformedCount += 1;
    return;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    state.malformedCount += 1;
    return;
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (!scheme || !hostname) {
    state.malformedCount += 1;
    return;
  }
  if (url.username || url.password) {
    state.credentialBearingCount += 1;
    return;
  }
  if (url.port) {
    state.nonDefaultPortCount += 1;
    return;
  }

  const key = `${scheme}\n${hostname}`;
  const current = state.origins.get(key) ?? { referenceCount: 0, pathShapes: new Set<string>() };
  current.referenceCount += 1;
  current.pathShapes.add(pathShape(url.pathname));
  state.origins.set(key, current);
}

function readPage(payload: unknown, requestedPage: number): {
  totalEntries: number;
  totalPages: number;
  data: unknown[];
} {
  const root = record(payload, "Pancake product-variation payload is malformed");
  if (root.success !== true) fail("Pancake product-variation response is unsuccessful");
  if (safeInteger(root.page_number, "Pancake catalog page_number is malformed") !== requestedPage) {
    fail("Pancake catalog response does not match the requested page");
  }
  const totalEntries = safeInteger(root.total_entries, "Pancake catalog total_entries is malformed");
  const totalPages = safeInteger(root.total_pages, "Pancake catalog total_pages is malformed");
  if (totalEntries > LIMITS.entries || totalPages > LIMITS.pages) {
    fail("Pancake catalog traversal limit exceeded");
  }
  return {
    totalEntries,
    totalPages,
    data: array(root.data, "Pancake product-variation payload is missing data array"),
  };
}

function classifyCategories(input: {
  count: number;
  duplicateNames: number;
  duplicateIds: number;
  assignedProducts: number;
  totalProducts: number;
  unknownReferences: number;
}): PancakeCatalogAuditReport["categories"]["classification"] {
  if (input.count === 0) return "empty";
  if (input.duplicateIds > 0 || input.unknownReferences > 0) return "unusable";
  if (input.duplicateNames > 0 || input.assignedProducts < input.totalProducts) return "partial";
  return "usable";
}

function inspectCategories(
  payload: unknown,
  products: ReadonlyMap<string, ProductSnapshot>,
  assignmentSourceLocations: ReadonlySet<string>,
): PancakeCatalogAuditReport["categories"] {
  const root = record(payload, "Pancake categories payload is malformed");
  if (root.success !== true) fail("Pancake categories response is unsuccessful");
  const roots = array(root.data, "Pancake categories payload is missing data array");

  let count = 0;
  let maxDepth = 0;
  let duplicateNormalizedNameCount = 0;
  let duplicateIdCount = 0;
  const knownIds = new Set<string>();
  const normalizedNames = new Set<string>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > LIMITS.categoryDepth) fail("Pancake category depth limit exceeded");
    count += 1;
    if (count > LIMITS.categories) fail("Pancake category count limit exceeded");
    maxDepth = Math.max(maxDepth, depth);

    const item = record(value, "Pancake category item is malformed");
    const id = hashedCategoryId(item.id);
    if (knownIds.has(id)) duplicateIdCount += 1;
    knownIds.add(id);

    const text = boundedString(item.text, LIMITS.categoryNameLength, "Pancake category text is malformed");
    const normalizedName = text.normalize("NFKC").trim().toLowerCase();
    if (!normalizedName) fail("Pancake category text is malformed");
    if (normalizedNames.has(normalizedName)) duplicateNormalizedNameCount += 1;
    normalizedNames.add(normalizedName);

    if (item.nodes === undefined || item.nodes === null) return;
    for (const child of array(item.nodes, "Pancake category nodes payload is malformed")) {
      visit(child, depth + 1);
    }
  };
  for (const item of roots) visit(item, 1);

  let assignedProductCount = 0;
  let knownAssignmentReferenceCount = 0;
  let unknownAssignmentReferenceCount = 0;
  for (const product of products.values()) {
    if (product.categoryIds.length > 0) assignedProductCount += 1;
    for (const categoryId of product.categoryIds) {
      if (knownIds.has(categoryId)) knownAssignmentReferenceCount += 1;
      else unknownAssignmentReferenceCount += 1;
    }
  }

  return {
    count,
    rootCount: roots.length,
    maxDepth,
    duplicateNormalizedNameCount,
    duplicateIdCount,
    assignedProductCount,
    knownAssignmentReferenceCount,
    unknownAssignmentReferenceCount,
    assignmentSourceLocations: [...assignmentSourceLocations].sort(),
    classification: classifyCategories({
      count,
      duplicateNames: duplicateNormalizedNameCount,
      duplicateIds: duplicateIdCount,
      assignedProducts: assignedProductCount,
      totalProducts: products.size,
      unknownReferences: unknownAssignmentReferenceCount,
    }),
  };
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export async function runPancakeCatalogAudit({
  client,
  shopId,
  pageSize = LIMITS.pageSize,
}: {
  client: AuditClient;
  shopId: number;
  pageSize?: number;
}): Promise<PancakeCatalogAuditReport> {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new TypeError("Pancake shop id must be a positive safe integer");
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > LIMITS.pageSize) {
    throw new TypeError(`Pancake catalog audit page size must be between 1 and ${LIMITS.pageSize}`);
  }

  const products = new Map<string, ProductSnapshot>();
  const assignmentSourceLocations = new Set<string>();
  const images: ImageState = {
    totalReferences: 0,
    malformedCount: 0,
    credentialBearingCount: 0,
    nonDefaultPortCount: 0,
    origins: new Map(),
  };
  let pricingTotalVariations = 0;
  let pricingEqual = 0;
  let pricingLower = 0;
  let pricingHigher = 0;
  let pricingRetailUnusable = 0;
  let pricingDiscountUnusable = 0;
  let pricingBothUnusable = 0;
  const pricingLowerExamples: PricingExample[] = [];
  const pricingHigherExamples: PricingExample[] = [];
  const endpoint = `/shops/${shopId}/products/variations`;
  let expectedEntries: number | undefined;
  let expectedPages: number | undefined;
  let rawVariationEntryCount = 0;

  for (let pageNumber = 1; ; pageNumber += 1) {
    if (pageNumber > LIMITS.pages) fail("Pancake catalog traversal limit exceeded");
    const page = readPage(
      await client.getJson(endpoint, { page_number: pageNumber, page_size: pageSize }),
      pageNumber,
    );
    const totalPages = Math.max(1, page.totalPages);
    if (expectedEntries === undefined) {
      expectedEntries = page.totalEntries;
      expectedPages = totalPages;
    } else if (page.totalEntries !== expectedEntries || totalPages !== expectedPages) {
      fail("Pancake catalog pagination changed during audit traversal");
    }

    for (const rawVariation of page.data) {
      rawVariationEntryCount += 1;
      if (rawVariationEntryCount > LIMITS.entries) fail("Pancake catalog entry limit exceeded");
      const variation = record(rawVariation, "Pancake product-variation item is malformed");
      boundedString(variation.id, LIMITS.idLength, "Pancake variation id is malformed");
      const productId = boundedString(variation.product_id, LIMITS.idLength, "Pancake variation product_id is malformed");
      const product = record(variation.product, "Pancake variation product payload is malformed");

      const assignments = readAssignments(product, variation);
      for (const location of assignments.locations) assignmentSourceLocations.add(location);
      const snapshot: ProductSnapshot = {
        noteState: noteState(product.note_product),
        imageState: imageEqualityState(product.image),
        categoryIds: assignments.ids,
      };
      const key = hash(productId);
      const existing = products.get(key);
      if (existing && !sameProduct(existing, snapshot)) {
        fail("Pancake catalog contains inconsistent repeated product source facts");
      }
      if (!existing) {
        products.set(key, snapshot);
        if (product.image !== undefined && product.image !== null && product.image !== "") addImage(product.image, images);
      }

      for (const image of array(variation.images, "Pancake variation images payload is malformed")) {
        addImage(image, images);
      }

      // Pricing evidence: classify raw API price fields without asserting a shape contract.
      // The audit reads whatever the API sends and counts what it finds; it does not fail on
      // absent or non-numeric fields because the catalog-contract parser (which does) is not
      // in scope here — the audit must work with the same raw payload the contract parser
      // would reject, precisely to measure how often that happens.
      pricingTotalVariations += 1;
      const rawRetail = variation.retail_price;
      const rawDiscount = variation.retail_price_after_discount;
      const retailUsable = typeof rawRetail === "number" && Number.isFinite(rawRetail);
      const discountUsable = typeof rawDiscount === "number" && Number.isFinite(rawDiscount);
      const variationId = String(variation.id);

      if (!retailUsable && !discountUsable) {
        pricingBothUnusable += 1;
      } else if (!retailUsable) {
        pricingRetailUnusable += 1;
      } else if (!discountUsable) {
        pricingDiscountUnusable += 1;
      } else if (rawDiscount === rawRetail) {
        pricingEqual += 1;
      } else if (rawDiscount < rawRetail) {
        pricingLower += 1;
        if (pricingLowerExamples.length < LIMITS.pricingExamples) {
          pricingLowerExamples.push(Object.freeze({
            variationId,
            retailPrice: rawRetail,
            retailPriceAfterDiscount: rawDiscount,
          }));
        }
      } else {
        pricingHigher += 1;
        if (pricingHigherExamples.length < LIMITS.pricingExamples) {
          pricingHigherExamples.push(Object.freeze({
            variationId,
            retailPrice: rawRetail,
            retailPriceAfterDiscount: rawDiscount,
          }));
        }
      }
    }
    if (pageNumber >= (expectedPages ?? 1)) break;
  }

  if (rawVariationEntryCount !== expectedEntries) fail("Pancake catalog entry count does not match completed audit traversal");

  const categories = inspectCategories(
    await client.getJson(`/shops/${shopId}/categories`),
    products,
    assignmentSourceLocations,
  );
  let withNoteProduct = 0;
  let malformedNoteProductCount = 0;
  let withCategoryAssignments = 0;
  for (const product of products.values()) {
    if (product.noteState.startsWith("present:")) withNoteProduct += 1;
    if (product.noteState.startsWith("malformed:")) malformedNoteProductCount += 1;
    if (product.categoryIds.length > 0) withCategoryAssignments += 1;
  }

  return {
    products: {
      total: products.size,
      withNoteProduct,
      withoutNoteProduct: products.size - withNoteProduct - malformedNoteProductCount,
      noteProductCoveragePercent: percent(withNoteProduct, products.size),
      malformedNoteProductCount,
      withCategoryAssignments,
      categoryAssignmentCoveragePercent: percent(withCategoryAssignments, products.size),
    },
    source: { rawVariationEntries: rawVariationEntryCount },
    images: {
      totalReferences: images.totalReferences,
      malformedCount: images.malformedCount,
      credentialBearingCount: images.credentialBearingCount,
      nonDefaultPortCount: images.nonDefaultPortCount,
      origins: [...images.origins.entries()]
        .map(([key, value]) => {
          const [scheme = "", hostname = ""] = key.split("\n", 2);
          return { scheme, hostname, referenceCount: value.referenceCount, pathShapes: [...value.pathShapes].sort() };
        })
        .sort((left, right) => left.scheme === right.scheme
          ? left.hostname.localeCompare(right.hostname)
          : left.scheme.localeCompare(right.scheme)),
    },
    categories,
    pricing: {
      totalVariations: pricingTotalVariations,
      equalRetailAndDiscount: pricingEqual,
      discountLowerThanRetail: pricingLower,
      discountHigherThanRetail: pricingHigher,
      retailNullOrMalformed: pricingRetailUnusable,
      discountNullOrMalformed: pricingDiscountUnusable,
      bothUnusable: pricingBothUnusable,
      lowerExamples: Object.freeze(pricingLowerExamples),
      higherExamples: Object.freeze(pricingHigherExamples),
    },
  };
}
