# Pancake create-order OpenAPI evidence workflow

Status: **a raw Pancake POS OpenAPI document has now been supplied and inspected. The create-order request/response structure is verified for the fingerprinted document; native idempotency / unique client-reference semantics remain unverified.**

## Verified source evidence

The supplied JSON has:

- SHA-256 `44916312beb9f6d23ec96ac2ef4cf6428274ca024708f23afd19794ecddba81f`;
- size `2,774,602` bytes;
- OpenAPI `3.1.0`;
- title `Pancake POS Open API`;
- version `1.0.0`;
- production server `https://pos.pages.fm/api/v1`.

Those metadata values match the current official Pancake API reference. The project does not commit the raw 2.7 MB external document. Instead, the sanitized structural evidence needed by C8 is stored in `docs/integrations/pancake-order-create-contract-observed.json`.

The fingerprint proves which supplied bytes were inspected; it does not by itself cryptographically prove where the file was downloaded from.

## Verified create-order structure

Operation:

- `POST /shops/{SHOP_ID}/orders`;
- required path parameter `SHOP_ID` is an integer;
- API authentication is `api_key` in the query string;
- request body is required and uses `application/json`;
- the request schema contains a broad order model, but its only top-level required field is `shop_id`;
- `items[]` entries require `variation_id` and `quantity`;
- `variation_info.retail_price` is an integer and is documented as recommended when the caller needs the line price to be explicit;
- `shipping_address` resolves to `ShippingAddress`; that schema has no `required` array, while exposing string fields including `full_name`, `phone_number`, `address`, `full_address`, `province_id`, `district_id`, `commune_id`, and `country_code`;
- the documented success response is HTTP `200` with `application/json`;
- the response schema includes Pancake order `id` as an integer.

For LA Clothing, this broad external request schema must **not** become a browser-controlled pass-through. The eventual mapper should send a strict server-owned allowlist built from the local checkout snapshot and freshly revalidated Pancake facts.

## Idempotency / reference finding

The create-order operation does expose:

- `custom_id: string` described only as `Custom ID`;
- `account: integer` described as `Order source ID`;
- `account_name: string` described as `Order source name`.

The operation contains no documented native idempotency key, uniqueness guarantee, `request_id`, client-reference guarantee, or safe retry contract. Therefore:

- do not treat `custom_id` as an idempotency key merely because its name is convenient;
- do not perform a blind second POST after timeout/network ambiguity;
- a durable pre-write state plus **one POST attempt only** is still compatible with the approved C8 state machine: definitive success -> `CONFIRMED`; definitive rejection -> `REJECTED`; ambiguous network outcome -> `SYNC_UNKNOWN`;
- automatic retry or automatic duplicate-safe reconciliation remains blocked until Pancake documents a trustworthy unique reference/idempotency mechanism or another safe reconciliation key is verified.

This means the exact request/response schema is no longer the blocker for implementing the one-shot create-order adapter/orchestration. The remaining safety rule is to preserve the no-blind-retry state machine and avoid inventing idempotency semantics.

## Usage for future evidence refresh

1. In the official Pancake POS Open API reference, use **Download OpenAPI Document** and save the raw JSON file locally. Do not commit the raw external document unless it has been separately reviewed as safe to persist.
2. Run:

```bash
pnpm pancake:order:inspect-openapi /absolute/or/relative/path/to/pancake-openapi.json
```

3. Compare the emitted structural JSON and source fingerprint against the checked-in sanitized evidence before changing the production mapper/parser.

## Safety boundary of the local inspector

The command:

- reads exactly one developer-selected local file;
- does not load `.env.local` and does not read `PANCAKE_API_KEY` or `PANCAKE_SHOP_ID`;
- does not instantiate the Pancake HTTP client and performs no network request;
- performs no create-order POST or other Pancake write;
- rejects files larger than 16 MiB before JSON parsing;
- maps JSON parse failures to the fixed code `MALFORMED_OPENAPI_DOCUMENT` instead of printing parser details or the local file path;
- forwards only fixed inspector error codes for malformed/unresolved/external/circular/budget failures;
- relies on the inspector's shared 10,000-work-unit traversal budget after parsing.

The command and checked-in evidence are **inspection aids, not write authorization**.
