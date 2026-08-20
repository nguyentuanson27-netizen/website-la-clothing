# P5 website-owned editorial workflow

Status: **implementation complete on `build/p5-editorial-workflow`; human merge approval remains required.**

This document records the current website-owned product editorial contract from FINAL PLAN V2 Task P5. It extends the P2 Pancake source mirror without changing Pancake commerce/source ownership or P7 collection ownership.

## Ownership boundary

```text
Pancake Product.note_product
  → ProductMirror.sourceDescription (source context, read-only in admin)
  → website editorial workspace
  → ProductContent editorial/SEO fields
  → DRAFT / REVIEWED / PUBLISHED
  → public storefront projection only when PUBLISHED
```

- `ProductMirror.sourceDescription` is Pancake-owned source context. It may change on catalog sync and is rendered to admins only as read-only context.
- `ProductContent` is website-owned. It stores the editorial/SEO workspace and survives Pancake source sync unchanged.
- Pancake `Product.note` remains private/internal and is not parsed, stored as product source content, rendered, used for SEO/GEO, or used as fallback copy.
- A Pancake sync cannot create a publication decision, change `ProductContent.status`, or overwrite editorial/SEO fields.
- `sourceDescription` is never a public-copy fallback and is not selected into the storefront product projection.

## Website-owned fields

The current workspace uses the existing fields:

- `editorialDescription`
- `careInstructions`
- `sizeGuide`
- `seoTitle`
- `seoDescription`
- `collectionSlugs` (existing P7 membership input; publication state does not redefine P7 ownership)

P5 does not add material, fit, origin, promotion, review/rating, return-policy, or other product claims. Unknown facts remain absent. If such fields are added later they require a verified/manual source and remain nullable unless a separate approved contract says otherwise.

## Publication state

`ProductContent.status` is website-owned and has exactly three values:

- `DRAFT` — internal working copy; editorial/SEO fields are not public.
- `REVIEWED` — internally reviewed copy; editorial/SEO fields are still not public.
- `PUBLISHED` — editorial/SEO fields may be projected to the public storefront.

The database default is `DRAFT`. The admin service accepts only the exact allowlist above. A legacy submission that omits status defaults fail-closed to `DRAFT`; malformed or unknown status values are rejected before persistence.

Products do not become unsellable merely because editorial content is DRAFT/REVIEWED. Commerce visibility, variants, prices, stock, media trust and P7 collection membership keep their existing owning contracts. Only the website-owned editorial/SEO projection is publication-gated here.

## Admin workflow and security

The product editor:

1. authenticates and authorizes ADMIN server-side;
2. loads `sourceDescription` from the persisted `ProductMirror` and renders it outside editable form controls;
3. accepts website-owned fields plus an explicit native publication-state control;
4. treats all form/Server Action values as untrusted input;
5. validates status, field lengths/formats and canonical collection membership before persistence;
6. redirects only to website-owned internal admin routes.

React escaping remains the output boundary for source text. No source value is used as HTML, redirect target, authorization input, or website-owned identity.

## Public projection

`src/commerce/storefront-catalog.ts` selects the ProductContent status and returns editorial/SEO fields only when `status === PUBLISHED`.

For `DRAFT` and `REVIEWED`:

- `editorialDescription = null`
- `careInstructions = null`
- `sizeGuide = null`
- `seoTitle = null`
- `seoDescription = null`

The public projection does not select `sourceDescription`, so source text cannot silently replace unpublished website copy.

## Migration and rolling compatibility

Migration `20260820094000_add_product_content_status` is additive:

1. create enum `ProductContentStatus`;
2. add `ProductContent.status NOT NULL DEFAULT 'DRAFT'`.

There is no rename, drop or destructive backfill in this rollout. Existing ProductContent rows therefore become `DRAFT` deliberately. This is the fail-closed publication choice: previously stored editorial copy must be explicitly published before it is public under P5.

Rollback/data implications:

- older application code can coexist with the additive column because it does not require the new field;
- rolling back application code does not require immediately dropping the enum/column;
- do not contract/drop the status field in the same rollout;
- publication decisions made after P5 remain stored if application code is rolled back.

## Verification contract

P5 is protected by tests that prove:

- non-admin calls fail before repository work;
- malformed publication/input values fail before database access;
- explicit DRAFT/REVIEWED/PUBLISHED persistence behavior;
- omitted status defaults to DRAFT;
- forged `sourceDescription` input cannot enter ProductContent writes;
- DRAFT/REVIEWED editorial and SEO fields are not returned publicly;
- PUBLISHED website-owned fields are returned publicly;
- `sourceDescription` remains absent from public projection;
- the real admin browser exposes source context read-only, persists publication state, has no horizontal overflow, passes Axe, and announces save/error feedback through VoiceOver.

RED evidence was observed before implementation: the status contract initially failed against the old Prisma model, and the admin browser contract initially failed because source context/publication controls did not exist. An existing runtime fixture that expected editorial copy to be public was also corrected to state `PUBLISHED` explicitly rather than weakening the new fail-closed default.

## Non-goals

P5 does not implement:

- P6 product slug lifecycle;
- P7 taxonomy/collection reimplementation;
- P9/P10 buyer-facing visual productization;
- P12 domain/canonical/indexation behavior;
- AI content generation or auto-publish.

`la.lanadesign.vn` remains staging/temporary. P12 stays blocked until the product owner explicitly chooses the dedicated canonical production domain.
