import { createHash } from "node:crypto";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_CATALOG_PAGES = 500;
const MAX_CATALOG_ENTRIES = 50_000;
const MAX_CATEGORIES = 10_000;
const MAX_CATEGORY_DEPTH = 32;
const MAX_CATEGORY_NAME_LENGTH = 256;
const MAX_IMAGE_REFERENCES = 100_000;
const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const SAFE_PATH_SEGMENTS = new Set([
  "asset",
  "assets",
  "catalog",
  "file",
  "files",
  "image",
  "images",
  "media",
  "original",
  "originals",
  "pos",
  "product",
  "products",
  "public",
  "shop",
  "shops",
  "static",
  "storage",
  "upload",
  "uploads",
  "web",
]);

type QueryValue = string | number | boolean;
type JsonRecord = Record<string, unknown>;
type AuditClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

type ImageOriginAccumulator = {
  referenceCount: number;
  pathShapes: Set<string>;
};

type ProductSnapshot = {
  noteFingerprint: string;
  primaryImageFingerprint: string | null;
  categoryFingerprints: readonly string[];
};

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
  variations: {
    total: number;
  };
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
    classification: "usable" | "partial" | "empty" | "unusable";
  };
};

export class PancakeCatalogAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PancakeCatalogAuditError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) {
    throw new PancakeCatalogAuditError(message);
  }
  return value;
}

function requireArray(record: JsonRecord, key: string, message: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new PancakeCatalogAuditError(message);
  }
  return value;
}

function requireSafeInteger(record: JsonRecord, key: string, message: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PancakeCatalogAuditError(message);
  }
  return value;
}

function requireNonEmptyString(record: JsonRecord, key: string, message: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PancakeCatalogAuditError(message);
  }
  return value;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeIdentifier(value: unknown, message: string): string {
  if (typeof value === "string" && value.length > 0) {
    return fingerprint(`s:${value}`);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return fingerprint(`n:${String(value)}`);
  }
  throw new PancakeCatalogAuditError(message);
}

function noteFingerprint(value: unknown): string {
  if (value === undefined || value === null) {
    return "missing";
  }
  if (typeof value !== "string") {
    return `malformed:${Array.isArray(value) ? "array" : typeof value}`;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? "missing" : `present:${fingerprint(trimmed)}`;
}

function optionalImageFingerprint(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new PancakeCatalogAuditError("Pancake product image payload is malformed");
  }
  return fingerprint(value);
}

function productCategoryFingerprints(value: unknown): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new PancakeCatalogAuditError("Pancake product categories payload is malformed");
  }

  const ids = value.map((entry) => {
    if (isRecord(entry)) {
      return normalizeIdentifier(entry.id, "Pancake product category id is malformed");
    }
    return normalizeIdentifier(entry, "Pancake product category id is malformed");
  });
  ids.sort();
  return ids;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshotMatches(left: ProductSnapshot, right: ProductSnapshot): boolean {
  return (
    left.noteFingerprint === right.noteFingerprint &&
    left.primaryImageFingerprint === right.primaryImageFingerprint &&
    sameStrings(left.categoryFingerprints, right.categoryFingerprints)
  );
}

function isDynamicPathSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return true;
  if (/^[0-9a-f]{20,}$/i.test(segment)) return true;
  if (/^[A-Za-z0-9_-]{28,}$/.test(segment)) return true;
  return false;
}

function imagePathShape(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";

  const shaped = segments.slice(0, 5).map((segment, index) => {
    const lower = segment.toLowerCase();
    const extensionMatch = lower.match(/\.([a-z0-9]+)$/);
    const isLastVisible = index === Math.min(segments.length, 5) - 1;
    if (isLastVisible && extensionMatch?.[1] && IMAGE_EXTENSIONS.has(extensionMatch[1])) {
      return `:file.${extensionMatch[1]}`;
    }
    if (isDynamicPathSegment(segment)) return ":id";
    if (!/^[A-Za-z0-9._-]{1,24}$/.test(segment)) return ":segment";
    return SAFE_PATH_SEGMENTS.has(lower) ? lower : ":segment";
  });

  return `/${shaped.join("/")}${segments.length > 5 ? "/**" : ""}`;
}

function recordImageReference(
  value: unknown,
  state: {
    totalReferences: number;
    malformedCount: number;
    credentialBearingCount: number;
    nonDefaultPortCount: number;
    origins: Map<string, ImageOriginAccumulator>;
  },
): void {
  state.totalReferences += 1;
  if (state.totalReferences > MAX_IMAGE_REFERENCES) {
    throw new PancakeCatalogAuditError("Pancake catalog image-reference limit exceeded");
  }

  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
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
  current.pathShapes.add(imagePathShape(url.pathname));
  state.origins.set(key, current);
}

function requirePage(payload: unknown, requestedPage: number): {
  totalEntries: number;
  totalPages: number;
  data: unknown[];
} {
  const root = requireRecord(payload, "Pancake product-variation payload is malformed");
  if (root.success !== true) {
    throw new PancakeCatalogAuditError("Pancake product-variation response is unsuccessful");
  }

  const pageNumber = requireSafeInteger(root, "page_number", "Pancake catalog page_number is malformed");
  if (pageNumber !== requestedPage) {
    throw new PancakeCatalogAuditError("Pancake catalog response does not match the requested page");
  }
  const totalEntries = requireSafeInteger(root, "total_entries", "Pancake catalog total_entries is malformed");
  const totalPages = requireSafeInteger(root, "total_pages", "Pancake catalog total_pages is malformed");
  if (totalEntries > MAX_CATALOG_ENTRIES || totalPages > MAX_CATALOG_PAGES) {
    throw new PancakeCatalogAuditError("Pancake catalog traversal limit exceeded");
  }

  return {
    totalEntries,
    totalPages,
    data: requireArray(root, "data", "Pancake product-variation payload is missing data array"),
  };
}

function categoryClassification(input: {
  count: number;
  maxDepth: number;
  duplicateNormalizedNameCount: number;
  duplicateIdCount: number;
  assignedProductCount: number;
  totalProducts: number;
  unknownAssignmentReferenceCount: number;
}): "usable" | "partial" | "empty" | "unusable" {
  if (input.count === 0) return "empty";
  if (input.duplicateIdCount > 0 || input.unknownAssignmentReferenceCount > 0) return "unusable";
  if (
    input.maxDepth <= 1 ||
    input.duplicateNormalizedNameCount > 0 ||
    input.assignedProductCount < input.totalProducts
  ) {
    return "partial";
  }
  return "usable";
}

function inspectCategories(
  payload: unknown,
  productSnapshots: ReadonlyMap<string, ProductSnapshot>,
): PancakeCatalogAuditReport["categories"] {
  const root = requireRecord(payload, "Pancake categories payload is malformed");
  if (root.success !== true) {
    throw new PancakeCatalogAuditError("Pancake categories response is unsuccessful");
  }
  const roots = requireArray(root, "data", "Pancake categories payload is missing data array");

  let count = 0;
  let maxDepth = 0;
  let duplicateNormalizedNameCount = 0;
  let duplicateIdCount = 0;
  const categoryIds = new Set<string>();
  const normalizedNames = new Set<string>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_CATEGORY_DEPTH) {
      throw new PancakeCatalogAuditError("Pancake category depth limit exceeded");
    }
    count += 1;
    if (count > MAX_CATEGORIES) {
      throw new PancakeCatalogAuditError("Pancake category count limit exceeded");
    }
    maxDepth = Math.max(maxDepth, depth);

    const record = requireRecord(value, "Pancake category item is malformed");
    const categoryId = normalizeIdentifier(record.id, "Pancake category id is malformed");
    if (categoryIds.has(categoryId)) duplicateIdCount += 1;
    categoryIds.add(categoryId);

    const name = record.name;
    if (typeof name !== "string" || name.length === 0 || name.length > MAX_CATEGORY_NAME_LENGTH) {
      throw new PancakeCatalogAuditError("Pancake category name is malformed");
    }
    const normalizedName = name.normalize("NFKC").trim().toLowerCase();
    if (normalizedNames.has(normalizedName)) duplicateNormalizedNameCount += 1;
    normalizedNames.add(normalizedName);

    const nodes = record.nodes;
    if (nodes === undefined || nodes === null) return;
    if (!Array.isArray(nodes)) {
      throw new PancakeCatalogAuditError("Pancake category nodes payload is malformed");
    }
    for (const node of nodes) visit(node, depth + 1);
  };

  for (const rootCategory of roots) visit(rootCategory, 1);

  let assignedProductCount = 0;
  let knownAssignmentReferenceCount = 0;
  let unknownAssignmentReferenceCount = 0;
  for (const snapshot of productSnapshots.values()) {
    if (snapshot.categoryFingerprints.length > 0) assignedProductCount += 1;
    for (const categoryId of snapshot.categoryFingerprints) {
      if (categoryIds.has(categoryId)) knownAssignmentReferenceCount += 1;
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
    classification: categoryClassification({
      count,
      maxDepth,
      duplicateNormalizedNameCount,
      duplicateIdCount,
      assignedProductCount,
      totalProducts: productSnapshots.size,
      unknownAssignmentReferenceCount,
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
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  client: AuditClient;
  shopId: number;
  pageSize?: number;
}): Promise<PancakeCatalogAuditReport> {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > MAX_PAGE_SIZE) {
    throw new TypeError(`Pancake catalog audit page size must be between 1 and ${MAX_PAGE_SIZE}`);
  }

  const endpoint = `/shops/${shopId}/products/variations`;
  const productSnapshots = new Map<string, ProductSnapshot>();
  const imageState = {
    totalReferences: 0,
    malformedCount: 0,
    credentialBearingCount: 0,
    nonDefaultPortCount: 0,
    origins: new Map<string, ImageOriginAccumulator>(),
  };

  let expectedTotalEntries: number | undefined;
  let expectedTotalPages: number | undefined;
  let variationCount = 0;

  for (let pageNumber = 1; ; pageNumber += 1) {
    if (pageNumber > MAX_CATALOG_PAGES) {
      throw new PancakeCatalogAuditError("Pancake catalog traversal limit exceeded");
    }
    const page = requirePage(
      await client.getJson(endpoint, { page_number: pageNumber, page_size: pageSize }),
      pageNumber,
    );

    if (expectedTotalEntries === undefined) {
      expectedTotalEntries = page.totalEntries;
      expectedTotalPages = Math.max(1, page.totalPages);
    } else if (
      page.totalEntries !== expectedTotalEntries ||
      Math.max(1, page.totalPages) !== expectedTotalPages
    ) {
      throw new PancakeCatalogAuditError("Pancake catalog pagination changed during audit traversal");
    }

    for (const value of page.data) {
      variationCount += 1;
      if (variationCount > MAX_CATALOG_ENTRIES) {
        throw new PancakeCatalogAuditError("Pancake catalog entry limit exceeded");
      }

      const variation = requireRecord(value, "Pancake product-variation item is malformed");
      requireNonEmptyString(variation, "id", "Pancake variation id is malformed");
      const productId = requireNonEmptyString(
        variation,
        "product_id",
        "Pancake variation product_id is malformed",
      );
      const product = requireRecord(variation.product, "Pancake variation product payload is malformed");
      if (requireNonEmptyString(product, "id", "Pancake product id is malformed") !== productId) {
        throw new PancakeCatalogAuditError("Pancake product identity is inconsistent");
      }

      const productKey = fingerprint(productId);
      const snapshot: ProductSnapshot = {
        noteFingerprint: noteFingerprint(product.note_product),
        primaryImageFingerprint: optionalImageFingerprint(product.image),
        categoryFingerprints: productCategoryFingerprints(product.categories),
      };
      const existing = productSnapshots.get(productKey);
      if (existing && !snapshotMatches(existing, snapshot)) {
        throw new PancakeCatalogAuditError("Pancake catalog contains inconsistent repeated product source facts");
      }
      if (!existing) {
        productSnapshots.set(productKey, snapshot);
        if (typeof product.image === "string" && product.image.length > 0) {
          recordImageReference(product.image, imageState);
        }
      }

      const variationImages = requireArray(
        variation,
        "images",
        "Pancake variation images payload is malformed",
      );
      for (const image of variationImages) recordImageReference(image, imageState);
    }

    if (pageNumber >= (expectedTotalPages ?? 1)) break;
  }

  if (variationCount !== expectedTotalEntries) {
    throw new PancakeCatalogAuditError("Pancake catalog entry count does not match completed audit traversal");
  }

  const categories = inspectCategories(
    await client.getJson(`/shops/${shopId}/categories`),
    productSnapshots,
  );
  let withNoteProduct = 0;
  let malformedNoteProductCount = 0;
  let withCategoryAssignments = 0;
  for (const snapshot of productSnapshots.values()) {
    if (snapshot.noteFingerprint.startsWith("present:")) withNoteProduct += 1;
    if (snapshot.noteFingerprint.startsWith("malformed:")) malformedNoteProductCount += 1;
    if (snapshot.categoryFingerprints.length > 0) withCategoryAssignments += 1;
  }

  const origins = [...imageState.origins.entries()]
    .map(([key, value]) => {
      const [scheme = "", hostname = ""] = key.split("\n", 2);
      return {
        scheme,
        hostname,
        referenceCount: value.referenceCount,
        pathShapes: [...value.pathShapes].sort(),
      };
    })
    .sort((left, right) =>
      left.scheme === right.scheme
        ? left.hostname.localeCompare(right.hostname)
        : left.scheme.localeCompare(right.scheme),
    );

  return {
    products: {
      total: productSnapshots.size,
      withNoteProduct,
      withoutNoteProduct: productSnapshots.size - withNoteProduct - malformedNoteProductCount,
      noteProductCoveragePercent: percent(withNoteProduct, productSnapshots.size),
      malformedNoteProductCount,
      withCategoryAssignments,
      categoryAssignmentCoveragePercent: percent(withCategoryAssignments, productSnapshots.size),
    },
    variations: { total: variationCount },
    images: {
      totalReferences: imageState.totalReferences,
      malformedCount: imageState.malformedCount,
      credentialBearingCount: imageState.credentialBearingCount,
      nonDefaultPortCount: imageState.nonDefaultPortCount,
      origins,
    },
    categories,
  };
}
