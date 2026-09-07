import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  createProductContentRepository,
  PUBLISHED_SEO_PAIR_LOCK_KEY,
} from "../../src/commerce/product-content-repository.ts";
import type { ProductContentSnapshot } from "../../src/commerce/product-content-admin.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createProductContentRepository(prisma);

const PREFIX = "u29";
const TITLE = "Áo Oxford Relaxed";
const DESCRIPTION = "Áo Oxford Relaxed của LA Clothing với phom hiện đại.";

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "ProductContent" WHERE "productId" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function insertProduct(suffix: string): Promise<string> {
  const id = `${PREFIX}-${suffix}`;
  await prisma.$executeRaw`
    INSERT INTO "ProductMirror" ("id", "pancakeShopId", "pancakeProductId", "slug", "name", "syncedAt", "createdAt", "updatedAt")
    VALUES (${id}, 920029, ${`${id}-external`}, ${`${id}-slug`}, ${`U29 ${suffix}`}, NOW(), NOW(), NOW())
  `;
  return id;
}

function snapshot(
  productId: string,
  overrides: Partial<ProductContentSnapshot> = {},
): ProductContentSnapshot {
  return {
    productId,
    status: "PUBLISHED",
    editorialDescription: "Editorial.",
    careInstructions: null,
    sizeGuide: null,
    seoTitle: TITLE,
    seoDescription: DESCRIPTION,
    collectionSlugs: [],
    ...overrides,
  };
}

async function readStatus(productId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS "status" FROM "ProductContent" WHERE "productId" = ${productId}
  `;
  return rows[0]?.status ?? null;
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("U29 a draft persists with missing SEO copy and never reaches the published set", async () => {
  const productId = await insertProduct("draft");

  const result = await repository.saveContent(
    snapshot(productId, { status: "DRAFT", seoTitle: null, seoDescription: null }),
  );

  assert.equal(result.ok, true);
  assert.equal(await readStatus(productId), "DRAFT");
});

test("U29 two drafts may share the same SEO pair", async () => {
  const first = await insertProduct("draft-a");
  const second = await insertProduct("draft-b");

  assert.equal((await repository.saveContent(snapshot(first, { status: "DRAFT" }))).ok, true);
  assert.equal((await repository.saveContent(snapshot(second, { status: "REVIEWED" }))).ok, true);
});

test("U29 the draft warning names the published product already holding the pair", async () => {
  const published = await insertProduct("published");
  const draft = await insertProduct("colliding-draft");
  await repository.saveContent(snapshot(published));
  await repository.saveContent(snapshot(draft, { status: "DRAFT" }));

  assert.deepEqual(
    await repository.findPublishedPairConflicts({
      productId: draft,
      seoTitle: TITLE,
      seoDescription: DESCRIPTION,
    }),
    [`${PREFIX}-published-slug`],
  );

  // A warning is not a publish: the draft is still a draft.
  assert.equal(await readStatus(draft), "DRAFT");
});

test("U29 a product never collides with itself and reports nothing when its copy is incomplete", async () => {
  const productId = await insertProduct("self");
  await repository.saveContent(snapshot(productId));

  assert.deepEqual(
    await repository.findPublishedPairConflicts({
      productId,
      seoTitle: TITLE,
      seoDescription: DESCRIPTION,
    }),
    [],
  );
  assert.deepEqual(
    await repository.findPublishedPairConflicts({
      productId: await insertProduct("incomplete"),
      seoTitle: TITLE,
      seoDescription: null,
    }),
    [],
  );
});

test("U29 the write path refuses a publish with incomplete copy even when its caller does not", async () => {
  const productId = await insertProduct("incomplete-publish");

  for (const overrides of [{ seoTitle: null }, { seoDescription: "   " }]) {
    const result = await repository.saveContent(snapshot(productId, overrides));
    assert.equal(result.ok, false);
    assert.equal(await readStatus(productId), null, "nothing may be written");
  }
});

test("U29 publishing a pair another published product already holds is blocked", async () => {
  const first = await insertProduct("pair-a");
  const second = await insertProduct("pair-b");
  assert.equal((await repository.saveContent(snapshot(first))).ok, true);

  const blocked = await repository.saveContent(snapshot(second));
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.ok === false ? blocked.block : null, {
    reason: "SEO_PAIR_CONFLICT",
    conflictingSlugs: [`${PREFIX}-pair-a-slug`],
  });
  assert.equal(await readStatus(second), null);
});

test("U29 the pair is the unit: sharing only the title or only the description still publishes", async () => {
  const first = await insertProduct("one-field-a");
  const second = await insertProduct("one-field-b");
  const third = await insertProduct("one-field-c");

  assert.equal((await repository.saveContent(snapshot(first))).ok, true);
  assert.equal(
    (await repository.saveContent(snapshot(second, { seoDescription: "Mô tả khác." }))).ok,
    true,
  );
  assert.equal(
    (await repository.saveContent(snapshot(third, { seoTitle: "Áo Linen" }))).ok,
    true,
  );
});

test("U29 collision equality is canonical Unicode and trimmed, not raw bytes", async () => {
  const first = await insertProduct("nfc");
  const second = await insertProduct("nfd");
  assert.equal((await repository.saveContent(snapshot(first))).ok, true);

  const blocked = await repository.saveContent(
    snapshot(second, {
      seoTitle: `  ${TITLE.normalize("NFD")}  `,
      seoDescription: DESCRIPTION.normalize("NFD"),
    }),
  );
  assert.equal(blocked.ok, false);
});

test("U29 a product may re-publish its own pair, and drafts are outside the published domain", async () => {
  const productId = await insertProduct("republish");
  const draft = await insertProduct("draft-holder");

  assert.equal((await repository.saveContent(snapshot(draft, { status: "DRAFT" }))).ok, true);
  // The draft holds the same pair, so a published-only domain is the only way this can succeed.
  assert.equal((await repository.saveContent(snapshot(productId))).ok, true);
  assert.equal(
    (await repository.saveContent(snapshot(productId, { editorialDescription: "Đã sửa." }))).ok,
    true,
  );
  assert.equal(await readStatus(productId), "PUBLISHED");
});

test("U29 a publish cannot slip past a concurrent publish that has not committed yet", async () => {
  const holder = await insertProduct("race-holder");
  const challenger = await insertProduct("race-challenger");

  // A second client, so the two transactions really are on two connections. The holder takes the
  // same lock the repository takes and commits its published row only once the challenger has had
  // every chance to read a catalog that does not contain it yet — which is exactly the Read
  // Committed interleaving that lets two publishes of one pair both commit when nothing serializes
  // them.
  const otherClient = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  let holderReady!: () => void;
  const holderHasLock = new Promise<void>((resolve) => {
    holderReady = resolve;
  });
  const holding = otherClient.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUBLISHED_SEO_PAIR_LOCK_KEY})`;
    await tx.$executeRaw`
      INSERT INTO "ProductContent" ("id", "productId", "status", "seoTitle", "seoDescription", "createdAt", "updatedAt")
      VALUES (${`${holder}-content`}, ${holder}, CAST('PUBLISHED' AS "ProductContentStatus"), ${TITLE}, ${DESCRIPTION}, NOW(), NOW())
    `;
    holderReady();
    await released;
  });
  await holderHasLock;

  const challenging = repository.saveContent(snapshot(challenger));
  const releaseTimer = setTimeout(release, 300);
  const [, challenged] = await Promise.all([holding, challenging]);
  clearTimeout(releaseTimer);
  await otherClient.$disconnect();

  assert.equal(challenged.ok, false, "the second publish of the pair must not commit");
  assert.equal(await readStatus(challenger), null);

  const publishedRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "ProductContent"
    WHERE "productId" LIKE ${`${PREFIX}-race-%`} AND "status" = CAST('PUBLISHED' AS "ProductContentStatus")
  `;
  assert.equal(Number(publishedRows[0]?.count), 1);
});

test("U29 bulk publish blocks the whole batch when a member has incomplete copy", async () => {
  const complete = await insertProduct("bulk-complete");
  const incomplete = await insertProduct("bulk-incomplete");
  await repository.saveContent(snapshot(complete, { status: "DRAFT" }));
  await repository.saveContent(
    snapshot(incomplete, { status: "DRAFT", seoDescription: null }),
  );

  const result = await repository.updateStatusesAtomically({
    productIds: [complete, incomplete],
    status: "PUBLISHED",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.ok === false && "blockedSlugs" in result ? result : null, {
    ok: false,
    reason: "SEO_INCOMPLETE",
    blockedSlugs: [`${PREFIX}-bulk-incomplete-slug`],
  });
  assert.equal(await readStatus(complete), "DRAFT");
});

test("U29 bulk publish blocks two members of the same batch claiming one pair", async () => {
  const first = await insertProduct("bulk-pair-a");
  const second = await insertProduct("bulk-pair-b");
  await repository.saveContent(snapshot(first, { status: "DRAFT" }));
  await repository.saveContent(snapshot(second, { status: "DRAFT" }));

  const result = await repository.updateStatusesAtomically({
    productIds: [first, second],
    status: "PUBLISHED",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && "reason" in result ? result.reason : null, "SEO_PAIR_CONFLICT");
  assert.equal(await readStatus(first), "DRAFT");
  assert.equal(await readStatus(second), "DRAFT");
});

test("U29 bulk publish blocks a member colliding with an already published product", async () => {
  const published = await insertProduct("bulk-published");
  const candidate = await insertProduct("bulk-candidate");
  await repository.saveContent(snapshot(published));
  await repository.saveContent(snapshot(candidate, { status: "DRAFT" }));

  const result = await repository.updateStatusesAtomically({
    productIds: [candidate],
    status: "PUBLISHED",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.ok === false && "blockedSlugs" in result ? result.blockedSlugs : null, [
    `${PREFIX}-bulk-candidate-slug`,
  ]);
  assert.equal(await readStatus(candidate), "DRAFT");
});

test("U29 bulk publish still succeeds for distinct complete pairs, and unpublishing is never gated", async () => {
  const first = await insertProduct("bulk-ok-a");
  const second = await insertProduct("bulk-ok-b");
  await repository.saveContent(snapshot(first, { status: "DRAFT" }));
  await repository.saveContent(
    snapshot(second, { status: "DRAFT", seoTitle: "Áo Linen Relaxed" }),
  );

  assert.equal(
    (await repository.updateStatusesAtomically({
      productIds: [first, second],
      status: "PUBLISHED",
    })).ok,
    true,
  );

  // Unpublishing can only shrink the published set, so it carries no precondition.
  assert.equal(
    (await repository.updateStatusesAtomically({
      productIds: [first, second],
      status: "DRAFT",
    })).ok,
    true,
  );
  assert.equal(await readStatus(first), "DRAFT");
});

test("U29 a product with no content row cannot be bulk published into an empty SEO pair", async () => {
  const bare = await insertProduct("bulk-bare");

  const result = await repository.updateStatusesAtomically({
    productIds: [bare],
    status: "PUBLISHED",
  });

  assert.equal(result.ok, false);
  assert.equal(await readStatus(bare), null);
});
