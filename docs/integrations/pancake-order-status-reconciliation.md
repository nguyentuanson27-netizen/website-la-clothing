# Pancake order-status reconciliation

This document records the durable persistence/concurrency contract for T10-B. It builds on the fingerprinted read-contract evidence in:

- `docs/integrations/pancake-order-status-contract-observed.json`
- `docs/integrations/pancake-order-status-openapi-evidence.md`

The upstream read shape and numeric status enum are therefore source-backed. This reconciliation layer still does **not** invent business meanings, a Pancake transition graph, webhook guarantees, or a mapping into website-owned `LocalOrderState`.

## Persisted upstream status tuple

Migration `20260812144500_add_pancake_order_status_reconciliation` adds three nullable columns to `OrderMirror`:

- `pancakeSystemId TEXT`
- `pancakeStatus INTEGER`
- `pancakeStatusUpdatedAt TEXT`

They are intentionally nullable so existing orders are not backfilled with guessed upstream state.

`pancakeSystemId` is canonical decimal text. The OpenAPI field is an integer, but storing it as PostgreSQL `INTEGER` would unnecessarily narrow a value that the source contract does not constrain to 32 bits.

`pancakeStatusUpdatedAt` stores the already validated upstream RFC3339 revision **as text**. Pancake's `date-time` examples/schema allow fractional-second precision that can exceed JavaScript/Prisma millisecond precision. Persisting the validated source string prevents distinct sub-millisecond revisions from collapsing to the same local `DateTime` value.

The three values form one logical status tuple. A partially populated tuple is treated as `STATUS_CONFLICT`; the service does not guess missing members.

## Revision ordering

`comparePancakeOrderStatusTimestamps()` validates the bounded RFC3339 value and compares semantic instants as:

```text
(epochMilliseconds, subMillisecondNanoseconds)
```

Consequences:

- timezone-equivalent representations compare equal;
- the six fractional digits below the millisecond remain ordered;
- impossible calendar/time values fail closed;
- lexical string order is never used as time order.

The comparator is only an ordering mechanism for observed read revisions. It does not claim Pancake event-delivery or webhook ordering guarantees.

## Reconciliation outcomes

For one local order scoped to the configured Pancake shop:

- no previously persisted tuple + valid upstream read → `UPDATED`;
- strictly newer upstream revision → atomic `UPDATED`;
- strictly older revision → `STALE`, no write;
- same semantic instant + same system id/status → idempotent `UNCHANGED`;
- same semantic instant + different system id/status → `STATUS_CONFLICT`;
- malformed/partial persisted tuple → `STATUS_CONFLICT`;
- upstream transport/contract failure → safe non-PII `STATUS_UNAVAILABLE`.

Missing, unsynced or cross-shop local orders fail closed before Pancake access where applicable.

## Bounded compare-and-set

Status writes use Prisma's parameterized tagged `$executeRaw` form; values are bound parameters rather than string-built SQL.

The compare-and-set predicate includes:

- local `OrderMirror.id`;
- configured/persisted Pancake shop scope;
- persisted Pancake order id;
- the complete previously observed system-id/status/revision tuple.

If another reconciliation commits first, the loser re-reads the row and reevaluates ordering. Retries are bounded to `4` attempts. Exhausting that contention budget fails closed as `STATUS_CONFLICT`.

This prevents a delayed stale response from overwriting a newer committed status.

## Local order lifecycle stays independent

This slice deliberately does **not** map Pancake numeric status codes into `LocalOrderState`. The website lifecycle remains its own state machine until separate semantic evidence defines a safe mapping.

The raw status CAS also deliberately does **not** update `OrderMirror.updatedAt`.

Existing checkout recovery uses `OrderMirror.updatedAt` as the local transition clock for states such as `VALIDATING` and `POS_SUBMITTING`. Bumping it during an unrelated upstream status refresh could postpone or suppress stranded-order recovery. A database regression test verifies reconciliation persists upstream status while preserving that local recovery clock exactly.

## Runtime boundary

The default runtime composes:

```text
readPancakeConfig()
→ server-only PancakeClient
→ strict fixed-path order-status gateway
→ reconciliation service scoped to configured shop
```

There is no import-time network/config side effect. Bootstrap/config construction failures collapse to `STATUS_UNAVAILABLE` without exposing API keys or third-party details. Service-level programmer-input/database errors are not blanket-caught.

## Explicitly out of scope

This persistence contract does not add or authorize:

- a webhook receiver;
- assumptions about webhook signature/authentication;
- webhook retry, duplicate, replay or delivery-order behavior;
- a scheduler/poller cadence;
- public guest tracking or its access-control capability;
- a live Pancake write;
- automatic Pancake-status → `LocalOrderState` transitions.
