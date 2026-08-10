# Pancake POS integration contract

Status: **C3 catalog contract implementation complete; final trusted live reviewed-contract verification and human review remain before C4.**

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

## Later integration contracts still unverified

These items are outside the catalog C3 contract and continue to block their later slices:

1. Exact create-order request/response schema and the correct website-origin reference field.
2. Native create-order idempotency behavior or unique client-reference constraint.
3. Exact order status codes/transitions used by reconciliation.
4. Webhook event names, payload shape, authentication/signature and replay protection.
5. Shipping-fee business rule for checkout.

Do not guess these contracts. In particular, do not add blind retries for uncertain Pancake order writes.

## Official sources checked

- Pancake POS Open API reference: https://docs.pancake.biz/pos/api/en/
- Pancake POS Open API overview: https://docs.pancake.biz/pos/st-f13/st-p1?lang=en
- API key/authentication: https://docs.pancake.biz/pos/st-f13/st-p2?lang=en
- Order status & processing flow: https://docs.pancake.biz/pos/st-f13/st-p3?lang=en
- pnpm run argument forwarding: https://pnpm.io/cli/run
