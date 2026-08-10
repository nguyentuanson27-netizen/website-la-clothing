# Pancake POS integration contract spike

Status: In progress — authoritative contract discovery before product/order adapter expansion.

## Verified from official Pancake POS documentation

- Production base URL: `https://pos.pages.fm/api/v1`.
- Authentication uses an API key created in Pancake POS settings. The official examples send it as the `api_key` request parameter.
- Shop discovery is available via `GET /shops`.
  - The documented success payload contains `success: true` and a `shops` array.
  - Each documented shop contains a numeric `id` and string `name` plus additional POS metadata.
  - The website adapter intentionally maps only `{ id, name }` until more fields are required.
- Product/variation inventory can be read via `GET /shops/{SHOP_ID}/products/variations`.
- Product detail is available via `GET /shops/{SHOP_ID}/products/{PRODUCT_SKU}`.
- Warehouses are available via `GET /shops/{SHOP_ID}/warehouses`.
- Orders support list/create/get/update via:
  - `GET /shops/{SHOP_ID}/orders`
  - `POST /shops/{SHOP_ID}/orders`
  - `GET /shops/{SHOP_ID}/orders/{ORDER_ID}`
  - `PUT /shops/{SHOP_ID}/orders/{ORDER_ID}`
- Address vocabulary is exposed through province, district and commune endpoints.
- The Open API reference exposes a webhook configuration operation at `PUT /shops/{SHOP_ID}`.
- Pancake publishes a dedicated “Order status & processing flow” reference for `status` / `status_name` semantics.

## Implemented boundary

- `src/integrations/pancake/client.ts` owns the API credential and GET transport.
- The client validates the canonicalized Pancake origin/API prefix before attaching `api_key`.
- `src/integrations/pancake/shops.ts` calls `/shops`, treats the payload as untrusted, validates the documented envelope, and maps only the minimal internal shop contract.
- Malformed/unsuccessful shop payloads fail closed with `PancakePayloadError`.

## Security boundary

The website backend is the only caller allowed to possess the Pancake API key. Browser code must never receive the key or call privileged Pancake operations directly.

External Pancake payloads are untrusted data. The adapter must validate them before mapping to internal commerce types.

Object **field names can themselves contain data**. Therefore unknown raw field names must not be persisted into GitHub Actions logs. Lexical identifier syntax is not treated as proof that a key is schema metadata.

## Contract discovery vs verification

Exact unknown field-name discovery and persistent CI logging are intentionally separate operations.

### 1. Trusted local discovery — complete normalized paths + observed JSON types

Copy the server-only Pancake placeholders from `.env.example` into ignored `.env.local`, then use only a trusted local/non-persisted inspection environment:

```bash
pnpm pancake:contract:discover
```

The discovery command:

- loads `.env.local` through the Node 22 CLI without requiring the API key in shell history;
- refuses execution when `CI` or `GITHUB_ACTIONS` is enabled;
- reads the two live read-only endpoints currently needed for the catalog spike;
- traverses every JSON node rather than sampling only the first array items;
- normalizes array indexes as `[]`, so the same structural field across different items is represented by one path such as `$.data[].variations_warehouses[].warehouse_id`;
- preserves exact object field names in those trusted-local paths;
- records the union of observed JSON types for each normalized path;
- never retains or prints external scalar values;
- returns `format: "normalized-path-types-v1"` and `complete: true` only after the complete payload has been traversed successfully.

Trusted discovery is still bounded for operator safety, but the bounds now **fail closed** rather than returning `truncated` / `max-depth` evidence:

- at most `1,000,000` visited JSON nodes;
- at most `64` structural levels;
- at most `50,000` distinct normalized paths.

If a bound is exceeded, the command exits non-zero with a safe budget message and does not emit a partial contract block. Increase/rework that trusted-local budget deliberately before contract review instead of guessing missing structure.

The older sampled discovery format could emit `truncated: true` or `max-depth`; any such output is incomplete legacy evidence and must **not** be used to populate reviewed keys, validators or mappers. Rerun discovery with the complete path/type format.

Because a field name can itself be PII/token-like data, treat this terminal output as sensitive inspection material. Do **not** redirect it to a committed file, upload it as an artifact, paste the complete output into a public/shared log, or run this command in CI.

The product-owner rerun after PR #37 produced `format: "normalized-path-types-v1"` and `complete: true` for both `productVariations` and `warehouses`. That establishes complete observed path/type evidence for the current shop payload, but it does **not** by itself define business semantics for similarly named stock fields.

After inspection, review which names are genuine stable schema fields. Add only those reviewed names to `src/integrations/pancake/reviewed-contract-keys.ts`, then implement fixtures/validators from the reviewed contract.

### 2. Controlled stock-semantics probe — read-only API + manual Pancake UI mutation

The product owner decided that website inventory will aggregate **all Pancake warehouses** for each variation. No warehouse subset should be selected unless that business decision changes later.

Trusted discovery observed these per-warehouse quantity fields as numbers:

- `actual_remain_quantity`
- `remain_quantity`
- `total_quantity`
- `pending_quantity`
- `waiting_quantity`
- `returning_quantity`

Their names were not treated as sufficient evidence of which field is the website-sellable quantity. The trusted-local read-only probe is available for behavioral evidence:

```bash
pnpm pancake:stock:probe <variation id | display_id | barcode>
```

With pnpm 11, arguments after the script name are forwarded to the executed script, so do not insert an extra `--` token for this command.

The command:

- loads `.env.local` locally and refuses CI/GitHub Actions execution;
- reads only `GET /shops/{SHOP_ID}/products/variations`;
- resolves exactly one variation by `id`, `display_id`, or `barcode`;
- validates `warehouse_id` and all six quantity fields before printing anything;
- prints only the selected variation identity, the six quantity values per warehouse, and their totals across **all** warehouses;
- fails closed if any expected quantity is not a finite number;
- fails closed if the same `warehouse_id` appears more than once, instead of guessing whether multiple rows represent batches/shelves or should be summed;
- never creates, updates or cancels an order.

Controlled test protocol:

1. Choose a low-risk/test variation that currently has stock and note its variation `id`, `display_id`, or barcode.
2. Run the probe and keep the terminal output as snapshot **A**.
3. In the Pancake UI, create a controlled order for quantity `1` of that exact variation and save it at the state being tested; do not use an unrelated real customer order.
4. Run the same probe again as snapshot **B**.
5. Cancel/revert the controlled order in Pancake.
6. Run the same probe a third time as snapshot **C**.
7. Compare A → B → C per warehouse and in the aggregated totals.

#### Verified stock behavior for the website reservation flow

The product owner completed the controlled A → B → C test against the live shop with a quantity-1 order. To avoid persisting current inventory levels, only deltas are recorded here:

| Field | A → B after saving order | B → C after cancellation |
| --- | ---: | ---: |
| `actual_remain_quantity` | 0 | 0 |
| `remain_quantity` | **-1** | **+1** |
| `total_quantity` | 0 | 0 |
| `pending_quantity` | 0 | 0 |
| `waiting_quantity` | 0 | 0 |
| `returning_quantity` | 0 | 0 |

This verifies that, for the tested Pancake order-save/cancel reservation lifecycle, `remain_quantity` is the quantity field that reflects immediately sellable availability: it decreases when one unit is reserved by a saved order and restores when that order is cancelled. The other observed fields did not move during this lifecycle, so this evidence does not assign broader semantics to them.

For the current website MVP, the inventory rule is therefore:

```text
website sellable stock for a variation
= SUM(variations_warehouses[].remain_quantity across all distinct warehouses)
```

The website must still re-read/revalidate authoritative stock immediately before creating an order; the mirrored catalog quantity is not a reservation mechanism by itself.

### 3. GitHub Actions verification — reviewed names only

`.github/workflows/pancake-contract-probe.yml` is a **verification workflow**, not a discovery mechanism.

It runs:

```bash
pnpm pancake:contract:verify
```

The verifier uses two separate phases:

1. **Full allowlist validation** traverses every JSON value in the live payload, independent of render sampling/depth limits. Any unreviewed object field causes a generic failure that does not echo the field name.
2. **Bounded shape rendering** runs only after full validation succeeds. Its `maxArrayItems`, `maxDepth`, distinct-shape and object-field caps keep the persisted Actions output small; those rendering caps cannot hide an unknown field from validation.

Full validation uses an explicit global node budget of `250000` nodes for each endpoint payload. If traversing the entire payload would exceed that budget, verification fails closed with a generic inspection-budget error instead of accepting a partially inspected contract.

The verifier also:

- requires non-empty checked-in reviewed key allowlists before making a Pancake request;
- exposes only field names already present in those allowlists;
- remains manual-only with `contents: read`, immutable action SHAs and Pancake secrets scoped to the verification step.

Until trusted discovery has been reviewed and `REVIEWED_PANCAKE_CONTRACT_KEYS` is populated, this Actions workflow is expected to fail closed instead of producing a misleading “discovery” shape.

The historical Actions run executed on `main@2d33d0eb...` used the pre-hardening sanitizer and is invalid as contract evidence. Do not use that output to implement validators or mappers.

## Still unverified — blocks catalog/write-path completion

1. The reviewed subset of exact product/variation/warehouse fields still needs to be committed into fixtures/allowlists before production mapping.
2. Exact create-order request/response schema and the correct field for a website-origin reference.
3. Exact order status codes and all valid transitions.
4. Webhook event names, payload shape, authentication/signature and replay-protection mechanism.
5. Native create-order idempotency behavior or a unique client-reference constraint.

Do not guess these fields or semantics. Do not implement automatic retries for uncertain order writes until idempotency/reconciliation behavior is proven.

## Intended adapter boundary

Raw Pancake data will be isolated under `src/integrations/pancake/` and mapped to internal types used by storefront modules. No page/component should depend on raw Pancake field names.

## Official sources checked

- Pancake POS Open API reference: https://docs.pancake.biz/pos/api/en/
- Pancake POS Open API overview: https://docs.pancake.biz/pos/st-f13/st-p1?lang=en
- API key/authentication: https://docs.pancake.biz/pos/st-f13/st-p2?lang=en
- Order status & processing flow: https://docs.pancake.biz/pos/st-f13/st-p3?lang=en
- pnpm 11/12 `run` argument forwarding: https://pnpm.io/cli/run
