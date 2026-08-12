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
- treats Schema Object `$ref` values separately from ordinary OpenAPI Reference Objects: every Schema `$ref` hop is checked before dereference;
- strips only non-contract annotation/sample siblings such as descriptions/examples, `readOnly`, and vendor extensions next to a Schema `$ref`;
- rejects `writeOnly` next to a selected Schema `$ref` instead of silently stripping it, because this evidence describes a GET response and `writeOnly` changes whether a value is available when the resource is retrieved;
- fails closed with `MALFORMED_OPENAPI_DOCUMENT` for any other Schema `$ref` sibling that could add an unsupported validation/structural constraint;
- requires exactly one matching `GET /shops/{...}/orders/{...}` operation;
- rejects operation/path deployment overrides that would make root server/security metadata ambiguous;
- validates the two required path parameters before producing evidence;
- requires the documented `200` `application/json` response;
- inspects only the six response properties needed by the production status boundary;
- copies only structural `type`, `format`, selected `required` names and bounded primitive `enum` values;
- never copies response examples, descriptions, defaults, customer objects, phone/name values or other order PII.

The exact candidate CLI source checked into this PR was executed locally against the supplied raw OpenAPI file and produced the checked artifact with the fingerprint above.

## Schema `$ref` hardening review evidence

The first Schema `$ref` hardening closed silent loss of structural siblings such as `type` and `enum`. Re-review comment `5271066252` then identified one remaining directional annotation issue: `writeOnly` was still classified as safe to strip, which is not safe for evidence about a GET response.

The follow-up was implemented with focused TDD:

- RED commit `7cedbc4395ca2ba19bff17c9dab0076c83d6abf2`, CI #642 / `31628714359`: DB 69/69, all three HTTP/security smokes, lint and typecheck passed; domain/integration failed exactly the new `$ref + writeOnly: true` regression with `Missing expected exception` (224/225 pass), and build was skipped after that intentional failure;
- GREEN production commit `187091d3b0bf52355f24e55a6ab7351dad3c69a8`: `writeOnly` was removed from the ignorable Schema-ref sibling set, so the existing per-hop fail-closed check rejects it without changing the generic Reference Object resolver or production Pancake gateway/parser;
- `readOnly` remains ignorable for this GET/output evidence because it does not make the field unavailable on retrieval.

After the `writeOnly` hardening, the exact candidate inspector/CLI source was executed locally against the same raw fingerprint. The raw source remained SHA-256 `44916312beb9f6d23ec96ac2ef4cf6428274ca024708f23afd19794ecddba81f` and 2,774,602 bytes. The generated evidence remained 1,582 bytes and byte-for-byte equal to the checked artifact; both generated and checked files have SHA-256 `aafdf1394a74be71e6f6b48df9566a1410ea2fa5d836299e11a7ca695cb077a0`.

The current selected order-detail schemas therefore require no artifact content change, while the inspector now fails closed if a future selected Schema `$ref` would otherwise hide `writeOnly` or another unsupported contract-affecting sibling.

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
