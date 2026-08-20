import assert from "node:assert/strict";
import test from "node:test";

import {
  CollectionDefinitionError,
  parseCollectionDefinition,
} from "../../src/commerce/collection-definition.ts";

test("P7 keeps collection identity and publication state website-owned", () => {
  const collection = parseCollectionDefinition({
    slug: "ao-so-mi-nam",
    title: "Áo sơ mi nam",
    description: "Các mẫu áo sơ mi nam được LA Clothing biên tập thủ công.",
    seoTitle: "Áo sơ mi nam | LA Clothing",
    seoDescription: "Khám phá bộ sưu tập áo sơ mi nam của LA Clothing.",
    isPublished: true,
    pancakeCategoryIds: [42, 7, 42],
  });

  assert.deepEqual(collection, {
    slug: "ao-so-mi-nam",
    title: "Áo sơ mi nam",
    description: "Các mẫu áo sơ mi nam được LA Clothing biên tập thủ công.",
    seoTitle: "Áo sơ mi nam | LA Clothing",
    seoDescription: "Khám phá bộ sưu tập áo sơ mi nam của LA Clothing.",
    isPublished: true,
    pancakeCategoryIds: [7, 42],
  });
});

test("P7 supports manual collections with no Pancake category mapping", () => {
  const collection = parseCollectionDefinition({
    slug: "everyday-uniform",
    title: "Everyday Uniform",
    description: "Nhóm sản phẩm do LA Clothing quản lý trực tiếp.",
    isPublished: false,
    pancakeCategoryIds: [],
  });

  assert.equal(collection.isPublished, false);
  assert.deepEqual(collection.pancakeCategoryIds, []);
});

test("P7 never auto-publishes a collection from POS category IDs", () => {
  const collection = parseCollectionDefinition({
    slug: "ao-khoac-nam",
    title: "Áo khoác nam",
    description: null,
    pancakeCategoryIds: [18],
  });

  assert.equal(collection.isPublished, false);
});

test("P7 fails closed on invalid collection slugs and POS category IDs", () => {
  assert.throws(
    () =>
      parseCollectionDefinition({
        slug: "Áo Sơ Mi",
        title: "Áo sơ mi",
        description: "Collection copy",
      }),
    (error: unknown) =>
      error instanceof CollectionDefinitionError && error.reason === "collection-slug",
  );

  assert.throws(
    () =>
      parseCollectionDefinition({
        slug: "ao-so-mi",
        title: "Áo sơ mi",
        description: "Collection copy",
        pancakeCategoryIds: [0],
      }),
    (error: unknown) =>
      error instanceof CollectionDefinitionError && error.reason === "collection-pos-category",
  );
});

test("P7 requires visible copy before a collection can be published", () => {
  assert.throws(
    () =>
      parseCollectionDefinition({
        slug: "ao-so-mi-nam",
        title: "Áo sơ mi nam",
        description: "   ",
        isPublished: true,
      }),
    (error: unknown) =>
      error instanceof CollectionDefinitionError && error.reason === "collection-description",
  );
});
