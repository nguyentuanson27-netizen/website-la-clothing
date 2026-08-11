# Pancake create-order OpenAPI evidence workflow

Status: **local evidence tooling is implemented; the exact create-order request/response, client-reference and idempotency contract is still unverified until a raw official Pancake OpenAPI JSON document is obtained and inspected.**

## Why this exists

The official Pancake POS Open API reference verifies OpenAPI 3.1.0, the production base `https://pos.pages.fm/api/v1`, and endpoint existence for `POST /shops/{SHOP_ID}/orders`. The currently searchable/rendered reference does not expose the expanded create-order request/response schema to this project, so endpoint existence must not be converted into guessed payload fields.

PR #43 merged the bounded structural inspector in `src/integrations/pancake/order-openapi-contract.ts`. This follow-up adds a local-only bridge from a developer-selected raw OpenAPI JSON file into that inspector.

## Usage

1. In the official Pancake POS Open API reference, use **Download OpenAPI Document** and save the raw JSON file locally. Do not commit the raw external document unless it has been separately reviewed as safe to persist.
2. Run:

```bash
pnpm pancake:order:inspect-openapi /absolute/or/relative/path/to/pancake-openapi.json
```

3. Review the emitted structural JSON. The command prints only the create-order structure returned by the reviewed inspector; examples, defaults, descriptions and external scalar sample values are not emitted.

## Safety boundary

The command:

- reads exactly one developer-selected local file;
- does not load `.env.local` and does not read `PANCAKE_API_KEY` or `PANCAKE_SHOP_ID`;
- does not instantiate the Pancake HTTP client and performs no network request;
- performs no create-order POST or other Pancake write;
- rejects files larger than 16 MiB before JSON parsing;
- maps JSON parse failures to the fixed code `MALFORMED_OPENAPI_DOCUMENT` instead of printing parser details or the local file path;
- forwards only fixed inspector error codes for malformed/unresolved/external/circular/budget failures;
- relies on the inspector's shared 10,000-work-unit traversal budget after parsing.

The command is an **evidence inspection aid, not write authorization**.

## What successful inspection can and cannot prove

A successful run can expose the structural create-order operation represented in the supplied official document: path parameter contract, request media types and structural schema subset, plus response status/media-type structural schemas.

It does **not** by itself prove:

- that the supplied file is current unless its official provenance/version is checked;
- business semantics that are not represented by the emitted structural subset;
- which field, if any, Pancake intends as the website-origin/client reference;
- native idempotency or uniqueness guarantees unless those semantics are separately documented and reviewed;
- a safe retry rule after an ambiguous timeout.

Actual C8 order-write work remains blocked until those items are verified. In particular, no payload field should be guessed from names, examples, UI behavior or third-party/generated clients, and uncertain writes must never be blindly retried.
