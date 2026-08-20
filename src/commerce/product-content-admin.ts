import { requireAdminSession } from "../auth/authorization.ts";

export const PRODUCT_CONTENT_LIMITS = {
  productId: 128,
  editorialField: 50_000,
  seoTitle: 500,
  seoDescription: 2_000,
  collectionCount: 8,
  collectionSlug: 48,
} as const;

export const PRODUCT_CONTENT_STATUSES = ["DRAFT", "REVIEWED", "PUBLISHED"] as const;
export type ProductContentStatus = (typeof PRODUCT_CONTENT_STATUSES)[number];

const COLLECTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type AdminSessionCandidate =
  | {
      user: {
        id: string;
        role?: string | null;
      };
      session: {
        id: string;
      };
    }
  | null
  | undefined;

export type ProductContentSnapshot = {
  productId: string;
  status: ProductContentStatus;
  editorialDescription: string | null;
  careInstructions: string | null;
  sizeGuide: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  collectionSlugs: string[];
};

type ProductContentAdminDependencies = {
  productExists(productId: string): Promise<boolean>;
  resolveCollectionSlugs(collectionSlugs: string[]): Promise<string[] | null>;
  saveContent(content: ProductContentSnapshot): Promise<ProductContentSnapshot>;
};

type ParsedTextField = { ok: true; value: string | null } | { ok: false };
type ParsedCollectionSlugs = { ok: true; value: string[] } | { ok: false };

function parseTextField(value: unknown, maxLength: number): ParsedTextField {
  if (typeof value !== "string" || value.length > maxLength) {
    return { ok: false };
  }

  const normalized = value.trim();
  return { ok: true, value: normalized.length > 0 ? normalized : null };
}

function parseCollectionSlugs(value: unknown): ParsedCollectionSlugs {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: [] };
  }
  if (typeof value !== "string") return { ok: false };

  const rawSlugs = value.split(",").map((entry) => entry.trim());
  if (
    rawSlugs.length > PRODUCT_CONTENT_LIMITS.collectionCount ||
    rawSlugs.some(
      (slug) =>
        slug.length === 0 ||
        slug.length > PRODUCT_CONTENT_LIMITS.collectionSlug ||
        !COLLECTION_SLUG_PATTERN.test(slug),
    )
  ) {
    return { ok: false };
  }

  const unique = new Set(rawSlugs);
  if (unique.size !== rawSlugs.length) return { ok: false };
  return { ok: true, value: rawSlugs };
}

function parseStatus(value: unknown): ProductContentStatus | null {
  if (value === undefined || value === null) return "DRAFT";
  if (typeof value !== "string") return null;
  return PRODUCT_CONTENT_STATUSES.find((status) => status === value) ?? null;
}

function parseProductContentInput(input: unknown): ProductContentSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const productId = record.productId;
  if (
    typeof productId !== "string" ||
    productId.length === 0 ||
    productId.length > PRODUCT_CONTENT_LIMITS.productId ||
    productId !== productId.trim()
  ) {
    return null;
  }

  const status = parseStatus(record.status);
  const editorialDescription = parseTextField(
    record.editorialDescription,
    PRODUCT_CONTENT_LIMITS.editorialField,
  );
  const careInstructions = parseTextField(
    record.careInstructions,
    PRODUCT_CONTENT_LIMITS.editorialField,
  );
  const sizeGuide = parseTextField(record.sizeGuide, PRODUCT_CONTENT_LIMITS.editorialField);
  const seoTitle = parseTextField(record.seoTitle, PRODUCT_CONTENT_LIMITS.seoTitle);
  const seoDescription = parseTextField(
    record.seoDescription,
    PRODUCT_CONTENT_LIMITS.seoDescription,
  );
  const collectionSlugs = parseCollectionSlugs(record.collectionSlugs);

  if (
    status === null ||
    !editorialDescription.ok ||
    !careInstructions.ok ||
    !sizeGuide.ok ||
    !seoTitle.ok ||
    !seoDescription.ok ||
    !collectionSlugs.ok
  ) {
    return null;
  }

  return {
    productId,
    status,
    editorialDescription: editorialDescription.value,
    careInstructions: careInstructions.value,
    sizeGuide: sizeGuide.value,
    seoTitle: seoTitle.value,
    seoDescription: seoDescription.value,
    collectionSlugs: collectionSlugs.value,
  };
}

export function createProductContentAdminService({
  productExists,
  resolveCollectionSlugs,
  saveContent,
}: ProductContentAdminDependencies) {
  async function update(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const content = parseProductContentInput(input);
    if (!content) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    if (!(await productExists(content.productId))) {
      return { ok: false, reason: "PRODUCT_NOT_FOUND" } as const;
    }

    const resolvedCollectionSlugs =
      content.collectionSlugs.length === 0
        ? []
        : await resolveCollectionSlugs(content.collectionSlugs);
    if (resolvedCollectionSlugs === null) {
      return { ok: false, reason: "COLLECTION_NOT_FOUND" } as const;
    }

    return {
      ok: true,
      content: await saveContent({
        ...content,
        collectionSlugs: resolvedCollectionSlugs,
      }),
    } as const;
  }

  return { update };
}
