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

### 1. Trusted local discovery — exact field names + value types

Copy the server-only Pancake placeholders from `.env.example` into ignored `.env.local`, then use only a trusted local/non-persisted inspection environment:

```bash
pnpm pancake:contract:discover
```

The discovery command:

- loads `.env.local` through the Node 22 CLI without requiring the API key in shell history;
- refuses execution when `CI` or `GITHUB_ACTIONS` is enabled;
- reads the two live read-only endpoints currently needed for the catalog spike;
- preserves exact object field names so the response structure can actually be reviewed;
- replaces scalar values with their JSON types, so product IDs, prices, tokens and other scalar values are not printed;
- still caps nesting, object fields, sampled array items and distinct array shapes.

A `truncated: true` or `max-depth` marker means the inspection is incomplete and must **not** be treated as exact contract evidence. Increase/rework the trusted inspection deliberately before populating reviewed keys rather than guessing missing structure.

Because a field name can itself be PII/token-like data, treat this terminal output as sensitive inspection material. Do **not** redirect it to a committed file, upload it as an artifact, paste the complete output into a public/shared log, or run this command in CI.

After inspection, review which names are genuine stable schema fields. Add only those reviewed names to `src/integrations/pancake/reviewed-contract-keys.ts`, then implement fixtures/validators from the reviewed contract.

### 2. GitHub Actions verification — reviewed names only

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

The indexed official docs available in this build session do not expose enough detail to safely implement the following yet:

1. Exact `products/variations` response schema, including per-warehouse quantity fields and active/hidden flags.
2. Exact warehouse response schema needed to select online sellable warehouse IDs.
3. Exact create-order request/response schema and the correct field for a website-origin reference.
4. Exact order status codes and all valid transitions.
5. Webhook event names, payload shape, authentication/signature and replay-protection mechanism.
6. Native create-order idempotency behavior or a unique client-reference constraint.
7. Which shop warehouse IDs should count toward online sellable inventory.

Do not guess these fields. Do not implement automatic retries for uncertain order writes until idempotency/reconciliation behavior is proven.

## Intended adapter boundary

Raw Pancake data will be isolated under `src/integrations/pancake/` and mapped to internal types used by storefront modules. No page/component should depend on raw Pancake field names.

## Official sources checked

- Pancake POS Open API reference: https://docs.pancake.biz/pos/api/en/
- Pancake POS Open API overview: https://docs.pancake.biz/pos/st-f13/st-p1?lang=en
- API key/authentication: https://docs.pancake.biz/pos/st-f13/st-p2?lang=en
- Order status & processing flow: https://docs.pancake.biz/pos/st-f13/st-p3?lang=en
