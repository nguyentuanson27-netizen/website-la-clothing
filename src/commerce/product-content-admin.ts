import { requireAdminSession } from "../auth/authorization.ts";

const MAX_PRODUCT_ID_LENGTH = 128;
const MAX_EDITORIAL_FIELD_LENGTH = 50_000;
const MAX_SEO_TITLE_LENGTH = 500;
const MAX_SEO_DESCRIPTION_LENGTH = 2_000;

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
  editorialDescription: string | null;
  careInstructions: string | null;
  sizeGuide: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

type ProductContentAdminDependencies = {
  productExists(productId: string): Promise<boolean>;
  saveContent(content: ProductContentSnapshot): Promise<ProductContentSnapshot>;
};

type ParsedTextField = { ok: true; value: string | null } | { ok: false };

function parseTextField(value: unknown, maxLength: number): ParsedTextField {
  if (typeof value !== "string" || value.length > maxLength) {
    return { ok: false };
  }

  const normalized = value.trim();
  return { ok: true, value: normalized.length > 0 ? normalized : null };
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
    productId.length > MAX_PRODUCT_ID_LENGTH ||
    productId !== productId.trim()
  ) {
    return null;
  }

  const editorialDescription = parseTextField(
    record.editorialDescription,
    MAX_EDITORIAL_FIELD_LENGTH,
  );
  const careInstructions = parseTextField(record.careInstructions, MAX_EDITORIAL_FIELD_LENGTH);
  const sizeGuide = parseTextField(record.sizeGuide, MAX_EDITORIAL_FIELD_LENGTH);
  const seoTitle = parseTextField(record.seoTitle, MAX_SEO_TITLE_LENGTH);
  const seoDescription = parseTextField(record.seoDescription, MAX_SEO_DESCRIPTION_LENGTH);

  if (
    !editorialDescription.ok ||
    !careInstructions.ok ||
    !sizeGuide.ok ||
    !seoTitle.ok ||
    !seoDescription.ok
  ) {
    return null;
  }

  return {
    productId,
    editorialDescription: editorialDescription.value,
    careInstructions: careInstructions.value,
    sizeGuide: sizeGuide.value,
    seoTitle: seoTitle.value,
    seoDescription: seoDescription.value,
  };
}

export function createProductContentAdminService({
  productExists,
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

    return {
      ok: true,
      content: await saveContent(content),
    } as const;
  }

  return { update };
}
