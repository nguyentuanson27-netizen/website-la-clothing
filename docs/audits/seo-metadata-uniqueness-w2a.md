# W2a — PDP metadata uniqueness replacement contract

Owning source: `docs/audits/seo-geo-audit.md` finding **W2**, planning step **P1/W2a**.
Master-plan unit: **U4**. Consumer: **U29 / W2b**.

Status: **BLOCKED — the slug/path discriminator cannot be removed yet.** See
[Verdict](#verdict).

## What the current contract does

`src/seo/product-metadata.ts` builds every PDP title and description from website-owned copy and
then appends the canonical slug:

```text
title:       `${seoTitle ?? name} — ${slug}`
description: `${seoDescription} — /shop/${slug}.`
             `Thông tin sản phẩm ${name} tại LA Clothing — /shop/${slug}.`   (fallback)
```

That trailing slug and path read poorly in a SERP, which is what W2 flags. It is also the only thing
keeping two PDPs distinguishable when their copy is otherwise identical, which is why W2b may not
remove it before a replacement is proven.

## Inventory of the existing uniqueness verification

| Verification | Location | What it proves | Runs in CI |
|---|---|---|---|
| Distinct-slug published copy stays unique | `tests/domain/product-metadata.test.ts` — "published SEO copy remains unique across distinct canonical product slugs" | Two products with the same published `seoTitle`/`seoDescription` still get different titles and descriptions | Yes (`pnpm test`) |
| Distinct-slug fallback copy stays unique | `tests/domain/product-metadata.test.ts` — "fallback metadata stays factual and unique for distinct slugs sharing the same product name" | Two products with the same `name` and no published copy still get different titles and descriptions | Yes (`pnpm test`) |
| Rendered HTML keeps both classes unique | `scripts/product-metadata-http-smoke.ts` (`publishedDuplicate*`, `fallback*` fixtures) | The same two classes stay unique in the real `<title>`/`<meta name="description">` of a Next response | Yes — see [How the HTTP smoke reaches CI](#how-the-http-smoke-reaches-ci) |
| Collisions are reachable through the deployed schema | `tests/database/product-metadata-uniqueness.test.ts` (added by U4) | Neither `ProductContent.seoTitle`/`seoDescription` nor `ProductMirror.name` is constrained unique, so both collision classes are real data states | Yes (`pnpm test:db`) |
| The replacement contract's collision report | `tests/domain/product-metadata-uniqueness.test.ts` (added by U4) | The slug-free candidate copy collides for both classes and is deterministic | Yes (`pnpm test`) |

### How the HTTP smoke reaches CI

No workflow step or npm script names `scripts/product-metadata-http-smoke.ts`, which makes it easy
to assume it is unwired. It is not. The chain is:

```text
.github/workflows/ci.yml  → job `verify` → step "Domain tests" → pnpm test
package.json              → "test": node --test tests/domain/*.test.ts tests/integrations/*.test.ts
tests/integrations/product-slug-http.test.ts
                          → await import("../../scripts/product-metadata-http-smoke.ts")
```

The import boots a real Next server, seeds PostgreSQL and asserts against real HTTP responses, so
the uniqueness contract is gated at the rendered-HTML level on every pull request.

## When two PDPs collide

Two products produce identical slug-free metadata when **both** the title and the description match.
Two independent data states reach that:

1. **Duplicate published copy.** `ProductContent.seoTitle` and `seoDescription` are plain nullable
   columns with no unique index and no cross-product validation. Two editors can publish the same
   sentences, and the migration history has never constrained them.
2. **Duplicate fallback copy.** With no published copy the title is `ProductMirror.name` and the
   description is generated from it. `ProductMirror.name` is mirrored from Pancake and is not
   unique — only `pancakeProductId` and `slug` are.

A shared title alone is *not* a collision: the description still separates the two pages. The
contract therefore keys on the pair.

## The replacement contract implemented by U4

`src/seo/product-metadata-uniqueness.ts` is validation and evidence only. It does not change what a
PDP emits; `buildStorefrontProductMetadata` remains the single metadata authority.

- `buildSlugFreeProductCopy(product)` — the exact copy a slug-free contract would emit: today's
  published-or-fallback sentences with the slug and `/shop/<slug>` path removed and nothing invented
  in their place.
- `findProductMetadataCollisions(products)` — the deterministic collision groups under that copy.
  Groups and their slugs are sorted, so the same catalog always yields the same report.
- `evaluateProductMetadataUniqueness(products)` — the gate: `safeToRemoveSlugDiscriminator` is true
  only when there is no collision group at all. A partially collision-free catalog is not a licence
  to drop the discriminator for the rest of it.

## Discriminators considered and rejected

| Candidate | Why it was not used |
|---|---|
| Variant colour | The audit is explicit that colour is not unique per product without evidence. Products routinely share one colour, and a product with several colours has no single value to use. |
| Collection membership | `ProductContent.collectionSlugs` is an unconstrained array. A product may belong to zero or many collections, and two products commonly share one. |
| Size or size range | Shared across most of the catalog; carries no product identity. |
| `pancakeProductId` | Unique, but an opaque external identifier. Substituting it for the slug swaps one technical string for a less readable one, which does not address W2 at all. |
| A generated numeric suffix | Invents a fact the catalog does not have and produces copy no human approved. |

None of these yields a *human-readable* discriminator that is provably unique per product from data
the repository actually owns. Choosing one anyway would replace a real uniqueness contract with a
plausible-looking guess — exactly what the audit warns against.

## Verdict

**BLOCKED — U29 / W2b must not remove the slug/path copy on the current schema and data.**

The collision classes above are reachable states, not hypotheticals, and no trustworthy replacement
discriminator exists in the current schema. Until one of the following is true, the slug stays:

1. **A uniqueness constraint exists and is enforced.** Published `seoTitle`/`seoDescription` become
   unique across products — enforced in the database and in the admin publish path — and the
   fallback copy for products without published copy is separately proven collision-free. This
   requires an owner decision about what happens when an editor tries to publish copy that is
   already in use.
2. **An owner-approved, human-readable, per-product discriminator is added.** A real product-owned
   fact — not inferred from colour, collection or naming convention — that is guaranteed unique
   across the catalog.

Either path is a product/owner decision, not a coding one. When one lands, U29 re-runs
`evaluateProductMetadataUniqueness` over the real catalog, gets
`safeToRemoveSlugDiscriminator: true`, and only then changes `buildStorefrontProductMetadata` and
its regressions.

`BLOCKED — OWNER FACT/APPROVAL REQUIRED`: which of the two paths above to take, and the resulting
publish-time behaviour when copy collides.

**Owner:** repository owner / brand authority — the same human authority that owns ADR 0004's domain
decision. Not a coding decision, and not one a coding agent may infer from the catalog.

**Stop rule for U29 / W2b:** do not remove the slug/path discriminator, do not substitute a
discriminator of your own, and do not narrow the collision definition to make the verdict pass. If
U29 is reached before this decision exists, stop at U29 and report; every other unit that does not
depend on PDP metadata copy continues normally.

## Open semantic question for the owner: pair-level or per-field uniqueness

This must be settled in the source contract before U29 implements anything, not decided by accident
inside that implementation.

The **current live contract** keeps title *and* description individually distinct, because the slug
discriminator is appended to both. The **replacement contract implemented here** treats a collision
as *both* matching, and explicitly treats a shared title with different descriptions as safe — a
test pins that.

Those are different guarantees, and the choice is a search-presentation judgement:

- **Pair-level** (what this module implements): two PDPs may share a title as long as their
  descriptions differ. Fewer copy changes forced on editors; two results in a SERP can carry the
  same headline.
- **Per-field**: title and description must each be unique across products. Stricter, closer to
  today's behaviour, and more work for editors on a catalog of near-identical garments.

Whichever is chosen, `findProductMetadataCollisions` changes in one place — its grouping key — and
the regressions follow. It belongs to the same owner decision above rather than being left implicit.
