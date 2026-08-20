import { requireAdminSession } from "../auth/authorization.ts";
import {
  COLLECTION_DEFINITION_LIMITS,
  CollectionDefinitionError,
  parseCollectionDefinition,
  type CollectionDefinition,
} from "./collection-definition.ts";

const MAX_INTEGER_ID = 2_147_483_647;
const CATEGORY_ID_PATTERN = /^[0-9]+$/;
const MAX_CATEGORY_CSV_LENGTH = COLLECTION_DEFINITION_LIMITS.pancakeCategoryCount * 12;

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

type CollectionDefinitionAdminDependencies = {
  saveDefinition(definition: CollectionDefinition): Promise<CollectionDefinition>;
};

function parsePublicationCheckbox(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return false;
  return value === "on" ? true : null;
}

function parseCategoryIdsCsv(value: unknown): number[] | null {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > MAX_CATEGORY_CSV_LENGTH) return null;

  const entries = value.split(",").map((entry) => entry.trim());
  if (
    entries.length === 0 ||
    entries.length > COLLECTION_DEFINITION_LIMITS.pancakeCategoryCount ||
    entries.some((entry) => entry.length === 0 || !CATEGORY_ID_PATTERN.test(entry))
  ) {
    return null;
  }

  const ids = entries.map((entry) => Number(entry));
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > MAX_INTEGER_ID)) {
    return null;
  }

  return new Set(ids).size === ids.length ? ids : null;
}

function parseAdminInput(input: unknown): CollectionDefinition | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  const isPublished = parsePublicationCheckbox(record.isPublished);
  const pancakeCategoryIds = parseCategoryIdsCsv(record.pancakeCategoryIds);
  if (isPublished === null || pancakeCategoryIds === null) return null;

  try {
    return parseCollectionDefinition({
      slug: record.slug,
      title: record.title,
      description: record.description,
      seoTitle: record.seoTitle,
      seoDescription: record.seoDescription,
      isPublished,
      pancakeCategoryIds,
    });
  } catch (error) {
    if (error instanceof CollectionDefinitionError) return null;
    throw error;
  }
}

export function createCollectionDefinitionAdminService({
  saveDefinition,
}: CollectionDefinitionAdminDependencies) {
  async function save(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const definition = parseAdminInput(input);
    if (!definition) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    try {
      return {
        ok: true,
        definition: await saveDefinition(definition),
      } as const;
    } catch (error) {
      if (error instanceof CollectionDefinitionError) {
        return { ok: false, reason: "INVALID_INPUT" } as const;
      }
      throw error;
    }
  }

  return { save };
}
