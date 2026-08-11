# Pancake POS integration contract

Status: **catalog read contract is implemented and verified; C8 create-order contract verification is in progress and the actual Pancake order write remains blocked on exact request/response plus idempotency/reference evidence.**

## Authoritative boundaries

- Production API base: `https://pos.pages.fm/api/v1`.
- `PANCAKE_API_KEY` and `PANCAKE_SHOP_ID` are server-only configuration.
- Browser code must never receive the Pancake API key or call privileged Pancake operations directly.
- External Pancake payloads are untrusted data and must be validated before crossing the adapter boundary.
- Raw Pancake field names stay under `src/integrations/pancake/`; storefront code consumes internal types only.

Catalog endpoints used by C3:

- `GET /shops/{SHOP_ID}/products/variations`
- `GET /shops/{SHOP_ID}/warehouses`

Later order/write-path work remains separate and must not be inferred from this catalog contract.

## Trusted structural discovery

Trusted discovery runs only on a local machine with ignored `.env.local` credentials:

```bash
pnpm pancake:contract:discover
```

The command refuses CI/GitHub Actions, never retains external scalar values, normalizes array indexes to `[]`, and records observed path/type unions. It fails closed on explicit traversal budgets instead of returning partial evidence.

The product-owner rerun after PR #37 returned:

```text
format: normalized-path-types-v1
complete: true
```

for both `productVariations` and `warehouses`, with no legacy `truncated` or `max-depth` markers.

Exact field names from trusted discovery are treated as sensitive inspection material. Do not persist raw discovery output or API responses in GitHub artifacts, public logs, issues, or commits.

## Reviewed catalog contract

`src/integrations/pancake/reviewed-contract-keys.ts` contains the checked-in object-key allowlists reviewed from the trusted discovery output.

`src/integrations/pancake/catalog-contract.ts` validates and maps only the C4-facing subset currently required:

### Product/variation page

- pagination: `page_number`, `page_size`, `total_entries`, `total_pages`;
- variation identity: `id`, `product_id`, `display_id`, `barcode`;
- attributes: `fields[].id`, `fields[].keyValue`, `fields[].name`, `fields[].value`;
- images: `images[]` as raw URL strings only;
- raw flags: `is_hidden`, `is_locked`;
- raw price fields: `retail_price`, `retail_price_after_discount`;
- parent identity/presentation: `product.id`, `product.name`;
- per-warehouse inventory: `variations_warehouses[].warehouse_id`, `variations_warehouses[].remain_quantity`.

The parser:

- requires a successful response;
- validates pagination as non-negative safe integers so later sync can traverse pages deliberately;
- requires `product_id === product.id` instead of accepting inconsistent identities;
- validates the mapped field types without coercion;
- rejects duplicate `warehouse_id` rows rather than guessing whether they represent independent stock buckets;
- ignores unconsumed external fields at the internal mapped-output boundary.

`tests/fixtures/pancake/product-variations.json` and `tests/fixtures/pancake/warehouses.json` are synthetic/sanitized fixtures. They contain no live API key, real customer data, real operational inventory, or live shop identifiers.

### Semantics deliberately not invented by C3

The adapter preserves `is_hidden`, `is_locked`, `retail_price`, `retail_price_after_discount`, and attribute field values as reviewed raw contract data. C3 does **not** claim additional business semantics for those fields beyond what has been separately verified. Visibility policy, Color/Size interpretation, and final storefront price selection must be made explicitly in the slice that consumes them rather than being inferred silently from names.

Image strings are also data only. C3 does not fetch remote images. Any later server-side image fetch/render integration must apply an explicit trusted-origin policy before introducing an SSRF-capable fetch boundary.

## Verified all-warehouse stock semantics

The product owner decided:

> Website sellable inventory aggregates all Pancake warehouses for each variation.

No `PANCAKE_ONLINE_WAREHOUSE_IDS` subset is used. The former explicit-subset parser/config was removed because it no longer represents the approved business rule.

Trusted discovery observed these per-warehouse quantity fields as numbers:

- `actual_remain_quantity`
- `remain_quantity`
- `total_quantity`
- `pending_quantity`
- `waiting_quantity`
- `returning_quantity`

Field names alone were not used to choose sellable stock. PR #38 added a read-only local probe:

```bash
pnpm pancake:stock:probe <variation id | display_id | barcode>
```

The command refuses CI, reads only the product/variation endpoint, validates all six quantity fields, and never creates/updates/cancels an order.

The product owner then ran a controlled quantity-1 order lifecycle against the live shop:

| Field | A → B after saving order | B → C after cancellation |
| --- | ---: | ---: |
| `actual_remain_quantity` | 0 | 0 |
| `remain_quantity` | **-1** | **+1** |
| `total_quantity` | 0 | 0 |
| `pending_quantity` | 0 | 0 |
| `waiting_quantity` | 0 | 0 |
| `returning_quantity` | 0 | 0 |

Therefore the approved MVP rule for the tested reservation lifecycle is:

```text
website sellable stock for a variation
= SUM(variations_warehouses[].remain_quantity across all distinct warehouses)
```

Mirrored stock is not a reservation. Checkout must re-read/revalidate authoritative Pancake availability immediately before order creation.

## Final reviewed-contract verification

The local verifier can now load the same ignored `.env.local` configuration:

```bash
pnpm pancake:contract:verify
```

The manual GitHub workflow `.github/workflows/pancake-contract-probe.yml` runs the same verifier with repository secrets when explicitly dispatched.

Verification has three defenses:

1. **Full allowlist validation** traverses every returned JSON node and rejects any object key not in the checked-in reviewed allowlist without echoing the unknown key.
2. **Mapped contract validation** runs the production catalog/warehouse parsers against the same live payload, validating the exact path/type subset C4 is allowed to consume, including pagination and all-warehouse `remain_quantity` aggregation.
3. **Bounded sanitized rendering** emits only reviewed field names/type shapes after validation; rendering limits cannot hide an unknown key because full validation runs first.

The full-tree allowlist validator uses a `250000`-node budget per endpoint and fails closed if the budget is exceeded.

On failure, the verifier prints only a fixed safe diagnostic code such as:

```text
Pancake reviewed-contract verification failed [stage=product-key-contract reason=inspection-budget] without logging external values or unknown field names
```

The stage distinguishes configuration, endpoint fetch, full-key validation, and mapped-contract validation for product variations vs warehouses. The reason distinguishes transport, unreviewed-field, inspection-budget, non-JSON, mapped-contract, or unexpected failure. It never echoes the API key, raw scalar values, raw payloads, or the name of an unreviewed external field.

**C3 does not become complete until this verifier passes against the current live shop payload and the resulting PR receives a clean human review.**

## C8 create-order contract verification

The current official Pancake POS Open API reference at `https://api-docs.pancake.biz/` establishes these structural facts:

- reference version `v1.0.0`;
- OpenAPI 3.1.0;
- production server `https://pos.pages.fm/api/v1`;
- Order Operations contains `POST /shops/{SHOP_ID}/orders`.

Endpoint existence is **not** treated as evidence for the create-order request/response schema, a website-origin reference field, or native idempotency behavior.

PR #43 adds `src/integrations/pancake/order-openapi-contract.ts`, a pure local inspector for the create-order operation. It does not make network requests and does not need Pancake credentials. The inspector:

- locates exactly one `POST /shops/{...}/orders` operation without guessing the path-parameter name;
- resolves bounded local `#/...` references, including chained references;
- preserves the supported structural siblings of OpenAPI 3.1 Schema Object `$ref` values conjunctively rather than silently discarding them;
- rejects external references, unresolved references, circular references, malformed documents and inspection-budget overflow;
- uses one shared `10,000`-work-unit budget across externally controlled path entries, parameters, response entries, media types, schema nodes/arrays/properties, `$ref` hops and JSON-pointer segments so non-schema traversal cannot bypass the inspection ceiling;
- computes the effective OpenAPI parameter set by `(name, in)`, with operation-level parameters overriding matching path-level parameters; duplicate parameters within one level and path parameters without `required: true` fail closed;
- emits only structural contract metadata needed for review: parameter names/locations/required flags, schema types/formats/required property names/property structure, media types and response status structure;
- deliberately omits examples, defaults, descriptions and other external scalar sample values from its output.

The shared budget and effective-parameter rules were added after review comment `5251949190`. RED CI #432 kept 46/46 DB tests, HTTP security/authz, lint and typecheck green and failed exactly three new regressions: non-schema traversal budget, operation-over-path parameter override, and malformed duplicate/non-required path parameters. GREEN commit `0bbf5fa` passed CI #433 with 46/46 DB tests, HTTP security/authz, lint, typecheck, 151/151 domain/integration tests, production build and `admin-a11y-runtime`.

This inspector is a **discovery/review aid, not write authorization**. It intentionally captures only the structural subset needed to inspect the operation safely; it does not claim to preserve every JSON Schema/OpenAPI validation keyword.

The official reference exposes a “Download OpenAPI Document” control, but the raw downloadable document has not yet been captured into trusted local evidence in this project. The rendered/searchable official reference verifies the endpoint-level facts above, but current extraction does not expose the expanded `POST /shops/{SHOP_ID}/orders` request/response schema. Searches for candidate order field names are therefore not treated as contract evidence. Do not commit a guessed order payload based only on endpoint existence, UI examples, or generated client assumptions.

Before any Pancake order write is implemented, trusted evidence still needs to establish at minimum:

1. exact create-order request body fields/types/requiredness used by this shop/API version;
2. exact success/rejection response shape and Pancake order identity field;
3. the correct website-origin/client-reference field, if one exists;
4. native idempotency semantics or a documented unique client-reference constraint, if any;
5. how to resolve an ambiguous timeout before deciding whether another write is safe.

No destructive create-order probe is authorized by this verification slice.

## Later integration contracts still unverified

These items remain outside the verified catalog contract and continue to block their later slices:

1. Exact create-order request/response schema and the correct website-origin reference field; only the endpoint itself is verified so far.
2. Native create-order idempotency behavior or unique client-reference constraint.
3. Exact order status codes/transitions used by reconciliation.
4. Webhook event names, payload shape, authentication/signature and replay protection.

The guest shipping-fee policy is website-owned and was approved separately by the product owner on 2026-08-11: 30,000 VND by default, with free shipping when authoritative merchandise subtotal is over 1,000,000 VND or total product quantity is at least 3. It is not an unverified Pancake API contract.

Do not guess the remaining integration contracts. In particular, do not add blind retries for uncertain Pancake order writes.

## Official sources checked

- Pancake POS full Open API reference: https://api-docs.pancake.biz/
- Pancake POS Open API reference entry: https://docs.pancake.biz/pos/api/en/
- Pancake POS Open API overview: https://docs.pancake.biz/pos/st-f13/st-p1?lang=en
- API key/authentication: https://docs.pancake.biz/pos/st-f13/st-p2?lang=en
- Order status & processing flow: https://docs.pancake.biz/pos/st-f13/st-p3?lang=en
- OpenAPI 3.1.0 specification: https://spec.openapis.org/oas/v3.1.0
- pnpm run argument forwarding: https://pnpm.io/cli/run
