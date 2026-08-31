/**
 * W2a: the metadata uniqueness replacement contract.
 *
 * PDP titles and descriptions currently append the canonical slug and the `/shop/<slug>` path. That
 * copy reads poorly in a SERP, but it is doing real work: it is the only thing that keeps two PDPs
 * distinguishable when their published SEO copy — or their fallback copy — is identical. Nothing in
 * the schema makes `ProductContent.seoTitle`/`seoDescription` or `ProductMirror.name` unique.
 *
 * Removing the slug is therefore gated on evidence, not on taste. This module owns that evidence:
 * it builds the slug-free copy a replacement contract would produce and reports exactly which
 * products would stop being distinguishable under it. It deliberately does not change what the live
 * PDP emits; `buildStorefrontProductMetadata` stays the single metadata authority.
 *
 * The discriminators the audit warns against are not used here. Colour, collection membership and
 * similar attributes are not proven unique per product, and inventing one would replace a real
 * uniqueness contract with a plausible-looking guess.
 */

export type ProductMetadataUniquenessCandidate = Readonly<{
  slug: string;
  name: string;
  seoTitle: string | null;
  seoDescription: string | null;
}>;

export type ProductMetadataCopy = Readonly<{
  title: string;
  description: string;
}>;

export type ProductMetadataCollisionGroup = Readonly<{
  title: string;
  description: string;
  slugs: readonly string[];
}>;

export type ProductMetadataUniquenessVerdict = Readonly<{
  safeToRemoveSlugDiscriminator: boolean;
  collidingProductCount: number;
  collisions: readonly ProductMetadataCollisionGroup[];
}>;

/**
 * The copy a slug-free replacement contract would emit: the same published-or-fallback sentences as
 * today with the technical slug and path removed, and nothing else invented.
 */
export function buildSlugFreeProductCopy(
  product: ProductMetadataUniquenessCandidate,
): ProductMetadataCopy {
  return {
    title: product.seoTitle ?? product.name,
    description:
      product.seoDescription ?? `Thông tin sản phẩm ${product.name} tại LA Clothing.`,
  };
}

/**
 * Groups of products that the slug-free copy could not tell apart.
 *
 * A collision needs both the title and the description to match: a shared title alone still leaves
 * two distinguishable pages. Groups and the slugs inside them are sorted so the same catalog always
 * produces the same report regardless of query order.
 */
export function findProductMetadataCollisions(
  products: readonly ProductMetadataUniquenessCandidate[],
): readonly ProductMetadataCollisionGroup[] {
  const groups = new Map<string, { copy: ProductMetadataCopy; slugs: string[] }>();

  for (const product of products) {
    const copy = buildSlugFreeProductCopy(product);
    const key = JSON.stringify([copy.title, copy.description]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { copy, slugs: [product.slug] });
    else group.slugs.push(product.slug);
  }

  return [...groups.values()]
    .filter((group) => group.slugs.length > 1)
    .map((group) => ({
      title: group.copy.title,
      description: group.copy.description,
      slugs: [...group.slugs].sort(),
    }))
    .sort((left, right) =>
      left.title === right.title
        ? left.description.localeCompare(right.description)
        : left.title.localeCompare(right.title),
    );
}

/**
 * The gate W2b has to pass. `safeToRemoveSlugDiscriminator` is true only when the evaluated catalog
 * has no collision group at all — a partially collision-free catalog is not a licence to drop the
 * discriminator for the rest.
 */
export function evaluateProductMetadataUniqueness(
  products: readonly ProductMetadataUniquenessCandidate[],
): ProductMetadataUniquenessVerdict {
  const collisions = findProductMetadataCollisions(products);
  const collidingProductCount = collisions.reduce((total, group) => total + group.slugs.length, 0);

  return {
    safeToRemoveSlugDiscriminator: collisions.length === 0,
    collidingProductCount,
    collisions,
  };
}
