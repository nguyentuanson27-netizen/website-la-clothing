const MAX_RELATED_PRODUCTS = 4;
const MAX_RELATED_COLLECTIONS = 8;
const CANDIDATES_PER_COLLECTION = MAX_RELATED_PRODUCTS + 1;

type RelatedProductSeed = Readonly<{
  id: string;
  collections: readonly Readonly<{ slug: string }>[];
}>;

type RelatedProductCandidate = Readonly<{ id: string }>;

type ListRelatedStorefrontProductsInput<T extends RelatedProductCandidate> = Readonly<{
  currentProduct: RelatedProductSeed;
  listCollectionProducts: (
    collectionSlug: string,
    limit: number,
  ) => Promise<readonly T[]>;
}>;

function projectedCollectionSlugs(
  collections: RelatedProductSeed["collections"],
): string[] {
  const seen = new Set<string>();
  const slugs: string[] = [];

  for (const collection of collections) {
    if (seen.has(collection.slug)) continue;
    seen.add(collection.slug);
    slugs.push(collection.slug);
    if (slugs.length === MAX_RELATED_COLLECTIONS) break;
  }

  return slugs;
}

export async function listRelatedStorefrontProducts<T extends RelatedProductCandidate>({
  currentProduct,
  listCollectionProducts,
}: ListRelatedStorefrontProductsInput<T>): Promise<T[]> {
  const slugs = projectedCollectionSlugs(currentProduct.collections);
  if (slugs.length === 0) return [];

  const candidateGroups = await Promise.all(
    slugs.map((slug) => listCollectionProducts(slug, CANDIDATES_PER_COLLECTION)),
  );

  const seenProductIds = new Set<string>([currentProduct.id]);
  const related: T[] = [];

  for (const candidates of candidateGroups) {
    for (const candidate of candidates) {
      if (seenProductIds.has(candidate.id)) continue;
      seenProductIds.add(candidate.id);
      related.push(candidate);
      if (related.length === MAX_RELATED_PRODUCTS) return related;
    }
  }

  return related;
}
