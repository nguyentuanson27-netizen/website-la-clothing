import assert from "node:assert/strict";
import test from "node:test";

import {
  createBootstrapProductSlug,
  createProductSlugAdminService,
} from "../../src/commerce/product-slug.ts";

const adminSession = {
  user: { id: "admin-legacy", role: "ADMIN" },
  session: { id: "session-admin-legacy" },
} as const;

const legacyOpaqueSlug = `p-${"a".repeat(20)}`;

test("bootstrap never emits the reserved legacy p-digest URL pattern even for product name P", () => {
  const slug = createBootstrapProductSlug({
    shopId: 910_060,
    pancakeProductId: "product-named-p",
    name: "P",
  });

  assert.match(slug, /^san-pham-[a-f0-9]{20}$/);
  assert.doesNotMatch(slug, /^p-[a-f0-9]{20}$/);
});

test("explicit admin slug changes cannot claim the reserved legacy p-digest URL pattern", async () => {
  let writes = 0;
  const service = createProductSlugAdminService({
    async changeSlug() {
      writes += 1;
      throw new Error("must not persist reserved legacy slug");
    },
  });

  assert.deepEqual(
    await service.update(adminSession, {
      productId: "product-1",
      slug: legacyOpaqueSlug,
    }),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.equal(writes, 0);
});
