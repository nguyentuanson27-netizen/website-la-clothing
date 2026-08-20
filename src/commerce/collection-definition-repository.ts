import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  parseCollectionDefinition,
  parseCollectionSlug,
  type CollectionDefinition,
} from "./collection-definition.ts";

const MAX_COLLECTION_LIST = 100;

const collectionSelect = {
  slug: true,
  title: true,
  description: true,
  seoTitle: true,
  seoDescription: true,
  isPublished: true,
  pancakeCategoryIds: true,
} as const;

function parseCollectionListLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COLLECTION_LIST) {
    throw new RangeError(`Collection list limit must be between 1 and ${MAX_COLLECTION_LIST}`);
  }
  return limit;
}

export function createCollectionDefinitionRepository(client: PrismaClient) {
  async function saveDefinition(input: unknown): Promise<CollectionDefinition> {
    const definition = parseCollectionDefinition(input);
    const { slug, ...fields } = definition;

    return client.collectionDefinition.upsert({
      where: { slug },
      create: { slug, ...fields },
      update: fields,
      select: collectionSelect,
    });
  }

  async function listForAdmin(limit: number) {
    return client.collectionDefinition.findMany({
      take: parseCollectionListLimit(limit),
      orderBy: [{ title: "asc" }, { slug: "asc" }],
      select: collectionSelect,
    });
  }

  async function listPublished(limit: number) {
    return client.collectionDefinition.findMany({
      where: { isPublished: true },
      take: parseCollectionListLimit(limit),
      orderBy: { slug: "asc" },
      select: collectionSelect,
    });
  }

  async function findPublishedBySlug(slug: unknown) {
    const parsedSlug = parseCollectionSlug(slug);
    return client.collectionDefinition.findFirst({
      where: {
        slug: parsedSlug,
        isPublished: true,
      },
      select: collectionSelect,
    });
  }

  return {
    saveDefinition,
    listForAdmin,
    listPublished,
    findPublishedBySlug,
  };
}
