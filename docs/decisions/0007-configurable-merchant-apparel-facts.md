# ADR 0007 — Configurable Merchant apparel facts

Status: **Accepted — owner decision 2026-09-02; amends PR #153 O3; runtime implementation remains gated by the Merchant train**

## Context

PR #153 leaves owner gate **O3** open: before Merchant activation, LA Clothing must either prove that every emitted standalone offer can truthfully use one catalog-wide set of apparel facts or add product-owned facts.

The owner has chosen a hybrid model that keeps current operations simple while avoiding a future Merchant redesign when LA Clothing adds products outside the current default audience.

Google Merchant currently accepts these controlled values:

- `gender`: `male`, `female`, `unisex`;
- `age_group`: `newborn`, `infant`, `toddler`, `kids`, `adult`;
- `condition`: `new`, `refurbished`, `used`.

Authoritative references:

- https://support.google.com/merchants/answer/6324479
- https://support.google.com/merchants/answer/6324463
- https://support.google.com/merchants/answer/6324469

## Authority and source-plan amendment

This ADR is the explicit human-approved amendment to **O3 only** in PR #153. It does not replace the rest of `docs/specs/marketing-analytics-shopping.md`, `tasks/marketing-analytics-shopping-plan.md`, or `tasks/marketing-analytics-shopping-todo.md`.

Where the original #153 artifacts still phrase O3 as "confirm whether ... or add product-owned facts", this ADR resolves that owner-decision branch in favor of **approved shop defaults plus product-owned overrides**. The old O3 prompt is therefore historical decision context, not an instruction to re-open the choice.

O3 has two distinct readiness states after this ADR:

```text
O3 policy decision        = RESOLVED by ADR 0007
O3 runtime implementation = PENDING until Merchant-train persistence,
                            validation, admin editing and effective-fact
                            resolution are implemented and verified
```

Accordingly:

- do not treat the accepted decision as evidence that the current runtime already supports overrides;
- do not activate Merchant merely because O3 policy is resolved;
- M3/U25 remains incomplete until the runtime work and tests in this ADR land;
- historical M1/integration artifacts that predate this decision may say `OWNER_BLOCKED`; that wording describes their then-current runtime/decision state and must not be copied forward as the current owner-policy status after ADR 0007.

O1, O2 and O4 are unchanged.

## Decision

### 1. Approved shop defaults

Merchant v1 uses these owner-approved LA Clothing defaults:

```text
gender    = male
age_group = adult
condition = new
```

These are business policy defaults, not values inferred from catalog text.

### 2. Product-level override is part of the contract

A standalone product may override any of the three defaults independently.

Resolution order is:

```text
explicit product override
        ↓
approved shop default
        ↓
unresolved => fail closed
```

Example:

```text
Product A: no overrides       => male / adult / new
Product B: gender=unisex      => unisex / adult / new
Product C: gender=female,
           age_group=kids     => female / kids / new
```

Overrides are product-family facts. Color/size variants inherit the effective product values unless a future reviewed requirement introduces a real variant-level distinction.

### 3. Ownership boundary

Product overrides are **local website-owned Merchant facts**. They must not be written into or derived from Pancake-owned mirror fields.

The implementation must keep the override source on a local-owned product record/domain. The exact persistence shape is chosen in the focused implementation PR, but it must preserve these semantics:

- absence of an override means **inherit the approved shop default**;
- absence must not simultaneously mean "unknown";
- values are restricted to the reviewed Merchant enums above;
- Pancake sync cannot erase an override;
- deleting a local override returns the product to inheritance rather than copying the current default into the product row.

### 4. No inference

The application must never derive O3 values from:

- product name;
- category or collection;
- description;
- size text or size guide;
- color;
- model output or other heuristic classification.

For example, a title containing `nam` is not an authorization boundary for `gender=male`.

### 5. Merchant fail-closed rule

M3 may emit an offer only after all three **effective** apparel facts resolve to allowed values.

If policy/default configuration or a product override is malformed/unavailable, exclude the offer with a bounded diagnostic such as:

```text
APPAREL_FACT_UNRESOLVED
```

Do not omit a required fact silently and do not invent a fallback from catalog text.

### 6. Admin UX contract

The Merchant implementation should expose one product-level control per fact with an explicit inheritance choice, conceptually:

```text
Giới tính
[ Dùng mặc định cửa hàng: Nam ▼ ]

Nhóm tuổi
[ Dùng mặc định cửa hàng: Người lớn ▼ ]

Tình trạng
[ Dùng mặc định cửa hàng: Hàng mới ▼ ]
```

The UI must distinguish inherited values from explicit overrides. Saving "Dùng mặc định cửa hàng" removes/clears the override rather than persisting a duplicate copy of the default.

The initial Merchant implementation does not need a second admin surface for editing shop defaults. The approved defaults above are the v1 shop policy. A later shop-default editor may be added without changing product override semantics or the Merchant mapper contract.

## Sequencing

This ADR resolves the **owner policy decision** for O3. It does **not** activate Merchant and does not pull Merchant persistence/UI work into Wave 1.

Implementation belongs with the Merchant train before M3/U25 is considered complete:

1. add the local-owned product override persistence shape;
2. add server-authoritative validation and admin editing for the three overrides;
3. expose effective apparel facts to the M1/M3 Merchant facts projection;
4. add RED/GREEN tests for inheritance, each override, clearing back to inheritance, invalid input, and fail-closed unresolved state;
5. keep composite Merchant offers deferred and keep all other Merchant activation gates unchanged.

Until that implementation lands, this ADR is the normative policy contract; it is not evidence that the runtime already supports overrides.

## Consequences

### Positive

- Current LA Clothing catalog can use simple owner-approved defaults.
- Future female, unisex, children, used, or refurbished products do not require a Merchant architecture rewrite.
- Product variants do not duplicate family-level facts.
- Merchant mapping stays deterministic and auditable.
- Pancake sync remains separate from website-owned Merchant policy.

### Trade-offs

- M3 has one additional local fact source to resolve.
- Product admin needs three small override controls before Merchant activation.
- Merchant readiness must distinguish policy approval from runtime implementation/readiness.

## Non-goals

- No Merchant activation in this ADR.
- No composite Merchant support.
- No inference from product text.
- No change to GTM, analytics, promotion activation, SEO indexing, or checkout.
- No decision here about O1, O2, or O4.
