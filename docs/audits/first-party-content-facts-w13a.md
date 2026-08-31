# W13A — first-party factual content inventory

Owning source: `docs/audits/seo-geo-audit.md` findings **W13A** / **W13**, planning step **P5**.
Master-plan unit: **U6**. Consumer: **U33 / W13**.

Status: **BLOCKED — OWNER FACT/APPROVAL REQUIRED for every page except a partial Shipping/Payment
section.** No evergreen page may be built until the facts marked blocked below are supplied and
approved by the human owner. Nothing in this inventory is inferred from UI copy, naming conventions
or code structure.

U6 builds no pages. It records what exists, what is close but not authoritative, and what is
missing.

## Classification

| Class | Meaning |
|---|---|
| **A — has source of truth** | A single server-owned source already produces the fact and it is already published to buyers. Safe for U33 to reuse. |
| **B — UI copy without authority** | The claim appears in a page or component, but no reviewed source owns it. Reusable only as *evidence for the owner to confirm*, never quoted as policy. |
| **C — missing** | The fact does not exist anywhere in the repository. |
| **D — owner approval required** | A business, legal or contactability decision. A coding agent must not author it regardless of what code or copy suggests. |

## The one authoritative source

`src/content/public-brand-facts.ts` → `buildPublicBrandFacts(policy)` is the only reviewed
first-party fact source. It is rendered by the site footer and the homepage, and its exact shape is
pinned by `tests/domain/public-brand-content.test.ts`.

| Fact key | Value source | Class |
|---|---|---|
| `brandName` | Constant `"LA Clothing"` | **A** |
| `brandSummary` | Constant, one sentence | **A** |
| `paymentMethod` | Constant: cash on delivery | **A** |
| `checkoutAccount` | Constant: no account required | **A** |
| `shipping` | Derived from the server-owned `GuestShippingPolicy` (`LA_SHIPPING_FEE_VND`, `LA_FREE_SHIPPING_SUBTOTAL_VND`, `LA_FREE_SHIPPING_MIN_QUANTITY`) | **A** |
| `orderTracking` | Constant describing the `/track-order` capability that exists | **A** |
| `serverVerification` | Constant describing behaviour the checkout actually implements | **A** |

Everything an evergreen page needs beyond this list is B, C or D.

## Per-page inventory

### About

| Fact needed | Current state | Class |
|---|---|---|
| Brand name and one-line positioning | `brandName`, `brandSummary` | **A** |
| Footer strapline "Modern menswear for everyday movement." | Hardcoded in `src/components/layout/site-footer.tsx`, not in the fact source | **B** |
| Homepage and lookbook editorial copy | `src/app/page.tsx`, `src/app/lookbook/page.tsx` and website-owned collection copy | **B** — editorial voice, not verified brand history |
| Founding story, year, values, people | Nowhere | **C** |
| `legalEntity` — registered business name | Nowhere | **C / D** |
| `taxCode` — business registration or tax identifier | Nowhere | **C / D** |

`BLOCKED — OWNER FACT/APPROVAL REQUIRED`: founding facts, registered entity name, and whether the
legal identifier should be public at all.

### Returns

| Fact needed | Current state | Class |
|---|---|---|
| `returnPolicy` — whether returns are accepted, and on what conditions | Nowhere | **C / D** |
| `returnWindowDays` — the window in days | Nowhere | **C / D** |
| `exchangePolicy` — size or colour exchanges | Nowhere | **C / D** |
| `refundMethod` — how a COD order is refunded | Nowhere | **C / D** |
| Who pays return shipping | Nowhere | **C / D** |
| Non-returnable categories, if any | Nowhere | **C / D** |

`BLOCKED — OWNER FACT/APPROVAL REQUIRED`: the entire returns policy. Nothing in the repository
implies one, and a returns page is exactly the kind of content a coding agent must not invent — it
is a commitment to customers and a consumer-law surface.

### Shipping / Payment

| Fact needed | Current state | Class |
|---|---|---|
| Payment method (COD) | `paymentMethod` | **A** |
| No account required to order | `checkoutAccount` | **A** |
| Shipping fee, free-shipping threshold and minimum quantity | `shipping`, from the server-owned policy | **A** |
| Phone confirmation before delivery | Stated at checkout and on the success page (`src/components/commerce/guest-checkout-form.tsx`, `src/app/checkout/success/page.tsx`) but not in the fact source | **B** |
| Server re-verification of price, stock and address at order time | `serverVerification` | **A** |
| `deliveryEstimate` — how long delivery takes | Nowhere | **C / D** |
| Delivery coverage, or areas not served | Nowhere. Address entry uses Pancake province/district/commune data, which is a geography reference, **not** a statement of where LA Clothing delivers | **C / D** |
| Carrier, and whether orders are trackable with the carrier | Nowhere. `/track-order` exposes the local COD order state only | **C / D** |
| Other payment methods (bank transfer, card, wallet) | Not implemented; checkout is COD only | **C / D** |

This is the only page with a substantial A-class base. It still cannot ship complete: a shipping
page without a delivery estimate or coverage statement is the part buyers look for.

`BLOCKED — OWNER FACT/APPROVAL REQUIRED`: delivery estimate, coverage, carrier, and confirmation
that the phone-confirmation step is a policy rather than current practice.

### Size Guide

| Fact needed | Current state | Class |
|---|---|---|
| Per-product size notes | `ProductContent.sizeGuide`, free text, editor-authored, rendered on the PDP | **B** — per product, editorial, and frequently absent |
| Size vocabulary and ordering | `src/commerce/clothing-size.ts` sorts known size labels | **A**, but it is a sort order, not a measurement fact |
| `sizeChart` — site-wide measurements per size | Nowhere | **C / D** |
| Measuring instructions | Nowhere | **C / D** |
| Fit guidance (regular, relaxed, oversized) and what each means | Product names hint at fit; no defined vocabulary | **C / D** |
| Units and tolerance | Nowhere | **C / D** |

`BLOCKED — OWNER FACT/APPROVAL REQUIRED`: the size chart itself. Deriving centimetres from product
names or existing per-product free text would be inventing measurements, which is worse than having
no page: a wrong chart drives returns the returns policy does not yet cover.

### Contact

| Fact needed | Current state | Class |
|---|---|---|
| `contactPhone` | Nowhere. No phone number appears anywhere in the repository | **C / D** |
| `contactEmail` | Nowhere | **C / D** |
| `storeAddress` — physical or registered address | Nowhere | **C / D** |
| `businessHours` — when the brand responds | Nowhere | **C / D** |
| Social or messaging channels | Nowhere in first-party content | **C / D** |
| Order-specific support route | `/track-order` exists and is described by `orderTracking` | **A**, but it is self-service status lookup, not a contact channel |

`BLOCKED — OWNER FACT/APPROVAL REQUIRED`: every contact channel. The storefront currently gives a
buyer no way to reach the brand other than waiting for the confirmation call, and inventing a
channel would send customers somewhere nobody is listening.

## Consequence for structured data

`buildSiteStructuredData` emits `Organization` with only `name` and `url`. W6 / U32 wants to enrich
it with verified first-party facts — address, contact point, social profiles. Every one of those is
class C/D above, so **U32's Organization enrichment is blocked by the same owner decision as U33**,
not by anything technical.

## Registered decision gates

These are recorded as **B1–B4** in the "Owner decision gates" register in
`tasks/growth-commerce-master-todo.md`, each with its owner, what it blocks and where the blocked
unit must stop:

| Gate | Covers | Blocks |
|---|---|---|
| **B1** | Returns policy | U33 Returns page |
| **B2** | Contact channels | U33 Contact page; U32 `Organization` enrichment only |
| **B3** | Size chart | U33 Size Guide page |
| **B4** | Shipping delivery terms | U33 Shipping/Payment page |

Owner in every case: repository owner / brand authority. Until a gate is answered, the blocked unit
stops and reports; every other unit continues. No page is built from an inferred policy, and no
missing fact is reconstructed from UI copy, checkout wording or naming conventions.

## What the owner needs to supply

For each of Returns, Shipping delivery terms, Size Guide and Contact:

1. the factual content itself, in Vietnamese, as the brand wants it published;
2. confirmation of who owns it and when it was last reviewed;
3. whether it is stable enough to live in `buildPublicBrandFacts` as a reviewed constant, or belongs
   in editable website-owned content.

U33 then builds the pages from that single approved source rather than duplicating copy between the
footer, the pages and structured data. Until then, no evergreen page is created, and no thin page is
published to chase GEO keywords.
