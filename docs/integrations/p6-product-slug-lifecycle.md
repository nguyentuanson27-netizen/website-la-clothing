# P6 product slug lifecycle

Status: **P6a persistence/admin lifecycle is merged; P6b HTTP resolution is implemented and verified on PR #79, with human review/merge approval still required.**

This document records the website-owned URL identity contract introduced by FINAL PLAN V2 Task P6 without enabling search indexing or changing the P12 domain gate.

## Ownership boundary

```text
Pancake product.id
  → stable commerce/source identity

Pancake product.name
  → one-time slug bootstrap input only
  → ProductMirror.slug (website-owned current URL identity)
  → explicit ADMIN change only
  → ProductSlugHistory (permanently reserved previous slugs)
```

- Pancake product ID remains the stable source identity.
- Pancake product name is used only when a mirrored product receives its initial website slug.
- Later Pancake name sync updates `ProductMirror.name` but never updates an already-readable website-owned slug.
- Exact legacy opaque slugs matching `p-[0-9a-f]{20}` are a compatibility-only exception: new runtime heals them once to the readable deterministic form and stores the old slug in permanent history.
- `keyword`, `custom_id`, `display_id`, variation IDs, barcode and SKU are not URL identity inputs.
- A website slug can otherwise change only through the explicit ADMIN-gated slug workflow.
- Previous slugs are never released for another product; this prevents redirect ambiguity and URL takeover.

P6 deliberately does not depend on P5 publication state. The slug freezes from first website bootstrap, which is stronger than waiting for publication and preserves FINAL PLAN V2's declared P2-only dependency for P6.

## Normalization and deterministic bootstrap

`normalizeProductSlug` produces a bounded lowercase ASCII slug:

1. normalize Unicode to NFD;
2. map Vietnamese `đ/Đ` to `d/D`;
3. remove combining marks;
4. lowercase;
5. collapse non-alphanumeric runs to `-`;
6. trim boundary hyphens;
7. enforce the 160-character persisted slug bound.

Initial mirror slugs use:

```text
<readable-normalized-name>-<20-hex stable identity digest>
```

The digest remains derived only from `pancakeShopId:pancakeProductId`, matching the old opaque `p-<digest>` identity suffix. This makes same-name product collisions deterministic without relying on import order or mutable product fields. If a name contains no usable characters, or would use the reserved legacy base `p`, the factual generic URL label `san-pham` is used; it does not create a product claim.

The exact pattern `p-[0-9a-f]{20}` is reserved permanently for legacy compatibility. Admin input cannot claim that namespace, and new bootstrap output cannot recreate it.

## Migration from legacy opaque slugs

Migration `20260820140000_add_product_slug_history` is additive:

1. create `ProductSlugHistory` with `slug` as the permanent unique key and a cascading ProductMirror relation;
2. copy every current `p-[0-9a-f]{20}` slug into history before changing it;
3. assign those products a readable current slug using the same Vietnamese normalization rules and the existing 20-hex identity suffix;
4. leave already-readable/non-legacy slugs unchanged.

The migration runs transactionally. Any uniqueness conflict aborts the migration rather than partially changing URL identity. A focused PostgreSQL test applies the migration to a minimal pre-P6 schema containing real legacy-shaped rows and verifies both readable current slugs and preserved history.

Rolling/rollback implications:

- older application code tolerates the additive history table;
- if old runtime creates a new `p-<20hex>` row after the migration but before all instances are upgraded, the new runtime detects that exact legacy pattern on the next catalog sync, reserves the old slug in history and assigns the deterministic readable slug atomically under the shared slug advisory lock;
- already-readable existing slugs are never recomputed from later Pancake names;
- older storefront reads still use `ProductMirror.slug`, so a code rollback can continue serving the new readable current slug;
- do not drop `ProductSlugHistory` in the same rollout because public historical redirects depend on it;
- migration rollback must restore current slugs from history before dropping the table if a true data rollback is ever required.

## Explicit ADMIN change

The admin product editor exposes a dedicated slug form separate from P5 editorial content.

Server-side flow:

1. authenticate and authorize ADMIN before parsing browser values;
2. use the server-resolved product ID rather than trusting browser product identity;
3. normalize and bound the proposed slug;
4. reject the exact reserved legacy `p-[0-9a-f]{20}` namespace;
5. serialize slug ownership changes with the catalog bootstrap/healing path;
6. reject any candidate that is already a current or historical slug;
7. create history for the previous current slug and update the product in one transaction;
8. repeat of the current slug is a no-op and creates no history.

The browser cannot modify Pancake product identity, source description, commerce fields or publication state through the slug form.

## Catalog sync behavior

Catalog sync still owns Pancake source facts such as name, source description, media and variant/stock data. For slug lifecycle it has only two narrowly-scoped authorities:

1. assign the initial website-owned readable slug when a product row is first created;
2. heal an exact legacy `p-[0-9a-f]{20}` current slug left by rolling deployment compatibility, preserving that old slug in history.

Sync and explicit admin slug mutations share a PostgreSQL advisory-lock namespace around slug ownership so bootstrap/healing cannot race with a history reservation. For all already-readable existing products, sync updates source fields while intentionally omitting `slug` from the update set.

## Public HTTP resolution

Next.js Proxy resolves `/shop/:slug` before the PDP can enter streamed rendering:

- current visible/active slug in the configured Pancake shop → pass through to the PDP → **200**;
- historical slug for a visible/active product in that shop → exact **301** to the current canonical product path;
- unknown, malformed, inactive, stale or wrong-shop slug → direct **404**.

Historical redirect construction never derives canonical identity from request `Host` or request origin. The Proxy constructs a Next-compatible absolute destination from validated server-owned `APP_DOMAIN`, while the framework may serialize that same-site response as a relative `Location: /shop/<current-slug>` on the wire. The HTTP regression sends a real raw request with `Host: attacker.example` and proves the resulting 301 still targets only the exact current product path and never contains the hostile host.

`APP_DOMAIN` is deployment configuration, not P12 indexing state. Public hostnames resolve to HTTPS; only `localhost` and `127.0.0.1` may use an explicit HTTP port for local verification. Release preflight fails closed when `APP_DOMAIN` is missing or malformed. This does not enable canonicals or indexing: `la.lanadesign.vn` remains temporary non-indexable staging, and the dedicated LA Clothing domain is still required only before enabling indexing/final canonicals and release preflight for that launch state.

Direct 301/404 responses retain the existing global security headers, including `X-Content-Type-Options` and `X-Frame-Options`.

## Verification contract

P6a is covered by:

- domain tests for Vietnamese normalization, bounded deterministic bootstrap, reserved legacy namespace handling, same-name collision handling, ADMIN-first authorization and malformed input;
- database tests for explicit change, no-op behavior, current-slug collision, permanent history reservation and missing products;
- catalog database tests proving readable initial bootstrap, Pancake rename freeze, fail-closed historical reservation and rolling-deploy healing of late legacy rows;
- a migration test applying the real SQL to pre-P6 opaque rows;
- the real admin browser/Axe/VoiceOver suite, which changes a slug through the UI, verifies current slug + history persistence, then continues the existing P5 editorial workflow regression.

P6b is covered by:

- repository tests for current/history/unknown resolution and fail-closed inactive/stale/wrong-shop/malformed cases;
- a real Next.js HTTP smoke proving historical=301, current=200 and unknown=404;
- a hostile-Host regression using raw `node:http` transport;
- security-header assertions on direct Proxy responses;
- release-readiness tests for the server-owned storefront origin;
- VPS container verification for release preflight, migrations, production image and runtime health.

RED/review evidence:

- CI #899 failed only because the new P6 test imported the not-yet-existing `src/commerce/product-slug.ts`; the preceding 112 database tests were green. Production implementation was added only after that RED was observed.
- CI #912 reproduced the rolling-deploy compatibility defect: 120/121 database tests passed and the new legacy-healing regression alone failed because the existing `p-<digest>` row remained opaque. The compatibility healing patch was added only after that RED was observed.
- Review 4984937534 reported two Required findings: the first P6b Proxy returned a relative `Location` that Next rejected with `ERR_INVALID_URL`, and the smoke did not actually send a hostile `Host`.
- CI #930 reproduced the first finding as historical **500** instead of 301.
- CI #931 repeated that RED with an actual `Host: attacker.example` request before the production fix.
- CI #940 proved the production fix reached **301** under the hostile request; its only failure was an overly strict test expectation that required an absolute wire `Location` although Next serialized the trusted same-site destination as a relative path.
- Behavior candidate `a51f9a4c8f62a0db600f2fefafd692015602839b` passed CI #941 verify + admin-a11y and VPS #172 before this documentation-only update.

P6 is not considered merged-complete on the planning branch until PR #79 receives human review approval and is merged.

## Non-goals

P6 does not implement P7, P9, P10 or P12 behavior; it does not enable indexing, select the dedicated production domain, add metadata/canonicals, or change product editorial publication semantics.
