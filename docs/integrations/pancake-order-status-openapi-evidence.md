# Pancake order-status OpenAPI evidence

This document records the reproducible, sanitized source evidence for the Pancake order-detail read contract used by T10 order-status reconciliation.

The raw Pancake OpenAPI document is **not committed**. The checked artifact is `docs/integrations/pancake-order-status-contract-observed.json`.

## Fingerprinted source

The supplied raw document inspected for this contract has:

- SHA-256: `44916312beb9f6d23ec96ac2ef4cf6428274ca024708f23afd19794ecddba81f`
- bytes: `2774602`
- OpenAPI: `3.1.0`
- title: `Pancake POS Open API`
- version: `1.0.0`
- production server: `https://pos.pages.fm/api/v1`
- root auth: API key in query parameter `api_key`

This fingerprint is the same raw source fingerprint already recorded for the reviewed create-order and geo evidence.

## Reproduce the sanitized artifact

Use a trusted local copy of that raw OpenAPI JSON:

```bash
pnpm pancake:order-status:inspect-openapi <local-openapi.json>
```

Redirect stdout to a temporary file and compare it with `docs/integrations/pancake-order-status-contract-observed.json`.

The command:

- reads a local file only; it makes no network request and does not read `PANCAKE_API_KEY`;
- limits the raw evidence file to 16 MiB and reads through the same opened handle used for metadata checks;
- applies a 10,000-work-unit inspection budget and a 32-hop local-reference depth limit;
- rejects external, unresolved and circular references;
- requires exactly one matching `GET /shops/{...}/orders/{...}` operation;
- rejects operation/path deployment overrides that would make root server/security metadata ambiguous;
- validates the two required path parameters before producing evidence;
- requires the documented `200` `application/json` response;
- inspects only the six response properties needed by the production status boundary;
- copies only structural `type`, `format`, selected `required` names and bounded primitive `enum` values;
- never copies response examples, descriptions, defaults, customer objects, phone/name values or other order PII.

The exact candidate CLI source checked into this PR was executed locally against the supplied raw OpenAPI file and produced the checked artifact with the fingerprint above.

## Verified read contract

The fingerprinted document establishes:

- method/path: `GET /shops/{SHOP_ID}/orders/{ORDER_ID}`;
- `SHOP_ID`: required path parameter, integer;
- `ORDER_ID`: required path parameter, string;
- documented success response: `200 application/json`;
- selected response structure:
  - `id`: integer;
  - `system_id`: integer;
  - `shop_id`: integer;
  - `status`: integer;
  - `inserted_at`: string, `date-time`;
  - `updated_at`: string, `date-time`.

The exact status enum in that schema is:

```text
0, 17, 11, 12, 13, 20, 1, 8, 9, 2, 3, 16, 4, 15, 5, 6, 7
```

The production parser may therefore validate this exact structural enum without relying on undocumented constants.

## What this evidence does not establish

This artifact proves the read shape and enum membership only. It does **not** establish:

- the business meaning/name of each numeric status;
- which status-to-status transitions are valid, terminal, reversible or monotonic;
- whether `updated_at` provides delivery/event ordering guarantees beyond being the upstream revision observed by a read;
- a mapping from Pancake status codes to website-owned `LocalOrderState`;
- webhook event names or payload completeness;
- webhook authentication/signature format;
- webhook retry, duplicate-delivery, replay or ordering guarantees.

Those semantics remain separate gates. They must not be inferred from the enum ordering or from field names.
