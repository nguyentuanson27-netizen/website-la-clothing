import assert from "node:assert/strict";
import test from "node:test";

import { listRelatedStorefrontProducts } from "../../src/commerce/storefront-related-products.ts";

type Candidate = Readonly<{ id: string; name: string }>;

function candidate(id: string): Candidate {
  return { id, name: `Product ${id}` };
}

test("U4 seeds only projected collections, excludes current product, dedupes deterministically and caps at four", async () => {
  const calls: Array<{ slug: string; limit: number }> = [];
  const byCollection: Record<string, readonly Candidate[]> = {
    tailoring: [candidate("current"), candidate("alpha"), candidate("shared"), candidate("charlie")],
    essentials: [candidate("shared"), candidate("bravo"), candidate("delta"), candidate("echo")],
  };

  const related = await listRelatedStorefrontProducts({
    currentProduct: {
      id: "current",
      collections: [
        { slug: "tailoring" },
        { slug: "essentials" },
      ],
    },
    listCollectionProducts: async (slug, limit) => {
      calls.push({ slug, limit });
      return byCollection[slug] ?? [];
    },
  });

  assert.deepEqual(calls, [
    { slug: "tailoring", limit: 5 },
    { slug: "essentials", limit: 5 },
  ]);
  assert.deepEqual(
    related.map(({ id }) => id),
    ["alpha", "shared", "charlie", "bravo"],
  );
  assert.equal(related.length, 4);
  assert.equal(related.some(({ id }) => id === "current"), false);
});

test("U4 has an intentional empty fallback and never fetches without projected collections", async () => {
  let calls = 0;
  const related = await listRelatedStorefrontProducts({
    currentProduct: { id: "solo", collections: [] },
    listCollectionProducts: async () => {
      calls += 1;
      return [candidate("unexpected")];
    },
  });

  assert.deepEqual(related, []);
  assert.equal(calls, 0);
});

test("U4 bounds collection fan-out even if persisted editorial data bypasses the admin limit", async () => {
  const calls: string[] = [];
  await listRelatedStorefrontProducts({
    currentProduct: {
      id: "current",
      collections: Array.from({ length: 12 }, (_, index) => ({
        slug: `collection-${index + 1}`,
      })),
    },
    listCollectionProducts: async (slug) => {
      calls.push(slug);
      return [];
    },
  });

  assert.equal(calls.length, 8);
  assert.deepEqual(calls, Array.from({ length: 8 }, (_, index) => `collection-${index + 1}`));
});
