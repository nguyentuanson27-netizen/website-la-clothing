# Pancake geo OpenAPI evidence

Status: **the fingerprinted Pancake POS OpenAPI document establishes the structural province → district → commune read contract needed for a server-side geo gateway. The product policy for Vietnam old/new administrative identifiers remains intentionally separate from this low-level contract.**

## Source fingerprint

The supplied raw JSON has the same fingerprint already used by the reviewed create-order evidence workflow:

- SHA-256 `44916312beb9f6d23ec96ac2ef4cf6428274ca024708f23afd19794ecddba81f`;
- size `2,774,602` bytes;
- OpenAPI `3.1.0`;
- title `Pancake POS Open API`;
- version `1.0.0`;
- production server `https://pos.pages.fm/api/v1`;
- API authentication: query parameter `api_key`.

The raw external document is not committed. The checked-in `pancake-geo-contract-observed.json` contains only the sanitized structural subset needed for review and implementation.

## Machine-derived geo contract

### Provinces

`GET /geo/provinces`

Query parameters:

- `country_code: string` — required;
- `is_new: boolean` — optional;
- `all: boolean` — optional.

HTTP `200` JSON shape:

```text
{
  data: Array<{
    id: string
    name: string
    name_en?: string
    new_id?: string
  }>
}
```

### Districts

`GET /geo/districts`

Query parameters:

- `province_id: string` — required.

HTTP `200` JSON shape:

```text
{
  data: Array<{
    id: string
    name: string
    name_en?: string
    province_id: string
  }>
}
```

### Communes

`GET /geo/communes`

Query parameters:

- `district_id: string` — required;
- `province_id: string` — required.

HTTP `200` JSON shape:

```text
{
  data: Array<{
    id: string
    name: string
    name_en?: string
    district_id: string
    province_id: string
    new_id?: string
    postcode?: string
  }>
}
```

The important contract correction versus the earlier unknown state is that commune lookup requires **both** the selected district ID and its province ID.

## Manual semantic review

The raw document describes:

- `country_code=84` as Vietnam;
- `province_id` for district lookup as the province ID returned by `GET /geo/provinces`;
- `district_id` and `province_id` for commune lookup as IDs returned by the preceding geo reads;
- province `is_new` as “New province (for country Viet Nam)”;
- province `all` as including old and new provinces;
- `new_id` fields on province/commune records.

The document therefore exposes an administrative-version choice for Vietnam. This evidence does **not** establish which old/new mode LA Clothing should present to shoppers, nor that a mixed old/new hierarchy is valid. The low-level gateway must preserve the documented parameters without silently choosing that product policy.

The raw commune example also shows `new_id` and `postcode` as `null` even though their structural schema says `string`. Checkout does not need those fields, so the first production parser deliberately does not expose them instead of widening the public contract around inconsistent optional metadata.

## Gateway implementation constraints

The server-side gateway built from this evidence must:

- keep `api_key` server-only through the existing `PancakeClient`;
- build only the three fixed geo paths above;
- require explicit caller input for documented lookup parameters;
- validate third-party response payloads before returning data;
- expose only IDs/names and parent IDs required for hierarchy selection;
- reject malformed, duplicate or wrong-parent records instead of silently repairing them;
- remain read-only and perform no Pancake write;
- not treat examples/default values as browser authority.

Visible checkout selectors remain a later slice. They should be activated only after the LA Clothing Vietnam old/new administrative policy is explicit and the server-side gateway is green.
