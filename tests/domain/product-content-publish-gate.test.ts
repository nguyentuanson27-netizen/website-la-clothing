import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductContentAdminService,
  createProductContentBulkStatusAdminService,
} from "../../src/commerce/product-content-admin.ts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

function contentInput(overrides: Record<string, unknown> = {}) {
  return {
    productId: "product-1",
    status: "PUBLISHED",
    editorialDescription: "Relaxed tailoring.",
    careInstructions: "",
    sizeGuide: "",
    seoTitle: "Áo Oxford Relaxed",
    seoDescription: "Áo Oxford Relaxed của LA Clothing.",
    collectionSlugs: "",
    ...overrides,
  };
}

type SavedCall = { seoTitle: string | null; seoDescription: string | null; status: string };

function service(
  save: (content: SavedCall & { productId: string }) => unknown,
  record?: SavedCall[],
) {
  return createProductContentAdminService({
    async productExists() {
      return true;
    },
    async resolveCollectionSlugs(slugs) {
      return [...slugs];
    },
    async saveContent(content) {
      record?.push({
        seoTitle: content.seoTitle,
        seoDescription: content.seoDescription,
        status: content.status,
      });
      return save(content) as never;
    },
  });
}

test("B5 publishing without an SEO title is blocked before anything is written", async () => {
  const written: SavedCall[] = [];
  const result = await service(
    () => {
      throw new Error("must not write");
    },
    written,
  ).update(adminSession, contentInput({ seoTitle: "   " }));

  assert.deepEqual(result, { ok: false, reason: "SEO_TITLE_REQUIRED", conflictingSlugs: [] });
  assert.deepEqual(written, []);
});

test("B5 publishing without an SEO description is blocked before anything is written", async () => {
  const written: SavedCall[] = [];
  const result = await service(
    () => {
      throw new Error("must not write");
    },
    written,
  ).update(adminSession, contentInput({ seoDescription: "\u00a0" }));

  assert.deepEqual(result, { ok: false, reason: "SEO_DESCRIPTION_REQUIRED", conflictingSlugs: [] });
  assert.deepEqual(written, []);
});

test("B5 a draft may be saved with missing or duplicate SEO copy", async () => {
  for (const status of ["DRAFT", "REVIEWED"]) {
    const written: SavedCall[] = [];
    const result = await service(
      (content) => ({ ok: true, content }),
      written,
    ).update(adminSession, contentInput({ status, seoTitle: "", seoDescription: "" }));

    assert.equal(result.ok, true);
    assert.equal(written.length, 1, `${status} must still reach persistence`);
    assert.deepEqual(
      { seoTitle: written[0]?.seoTitle, seoDescription: written[0]?.seoDescription },
      { seoTitle: null, seoDescription: null },
    );
  }
});

test("B5 a pair collision reported by the persistence boundary blocks the publish", async () => {
  const result = await service(() => ({
    ok: false,
    block: { reason: "SEO_PAIR_CONFLICT", conflictingSlugs: ["ao-oxford-den"] },
  })).update(adminSession, contentInput());

  assert.deepEqual(result, {
    ok: false,
    reason: "SEO_PAIR_CONFLICT",
    conflictingSlugs: ["ao-oxford-den"],
  });
});

test("B5 the persistence boundary is still trusted to refuse an incomplete publish", async () => {
  const result = await service(() => ({
    ok: false,
    block: { reason: "SEO_TITLE_REQUIRED", conflictingSlugs: [] },
  })).update(adminSession, contentInput());

  assert.deepEqual(result, { ok: false, reason: "SEO_TITLE_REQUIRED", conflictingSlugs: [] });
});

test("B5 a publish that clears both preconditions still saves", async () => {
  const written: SavedCall[] = [];
  const result = await service((content) => ({ ok: true, content }), written).update(
    adminSession,
    contentInput(),
  );

  assert.equal(result.ok, true);
  assert.equal(written[0]?.status, "PUBLISHED");
});

test("B5 bulk publish surfaces the persistence boundary's block instead of reporting success", async () => {
  const blocked = {
    ok: false,
    reason: "SEO_PAIR_CONFLICT",
    blockedSlugs: ["ao-oxford-den", "ao-oxford-trang"],
  } as const;

  const result = await createProductContentBulkStatusAdminService({
    async updateStatusesAtomically() {
      return blocked;
    },
  }).update(adminSession, { productIds: ["product-1", "product-2"], status: "PUBLISHED" });

  assert.deepEqual(result, blocked);
});

test("B5 bulk publish surfaces an incomplete-SEO block", async () => {
  const blocked = {
    ok: false,
    reason: "SEO_INCOMPLETE",
    blockedSlugs: ["ao-linen"],
  } as const;

  const result = await createProductContentBulkStatusAdminService({
    async updateStatusesAtomically() {
      return blocked;
    },
  }).update(adminSession, { productIds: ["product-1"], status: "PUBLISHED" });

  assert.deepEqual(result, blocked);
});
