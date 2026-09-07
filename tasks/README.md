# Task planning policy

Task plans in this directory define dependencies, ownership, acceptance criteria, and verification for their workstreams.

## Current owner-decision source of truth

Owner-approved LA Clothing business facts and owner-controlled launch/planning decisions are recorded in
[`docs/specs/la-clothing-owner-approved-facts-and-decisions.md`](../docs/specs/la-clothing-owner-approved-facts-and-decisions.md).
The current status reconciliation against older roadmap/audit blockers is recorded in
[`docs/audits/owner-facts-reconciliation-2026-09-07.md`](../docs/audits/owner-facts-reconciliation-2026-09-07.md).

For the specific owner-controlled decisions reconciled there, a historical `BLOCKED — OWNER FACT/APPROVAL REQUIRED`,
`proposed`, or unchecked owner-gate line in an older plan/audit does not override the newer approved source. This
precedence applies only to the owner decision itself: the older owning spec/audit/plan still governs technical
behavior, implementation order, acceptance criteria, verification, security, and independent launch gates.

A reconciled unit described as **owner-unblocked** is not implemented merely because its owner fact is resolved.
Items still marked `OPEN` in the owner source remain fail-closed. In particular, permanent-domain/Gate S approval
and O4 real vendor IDs/GTM live approval remain separate open gates. The Merchant↔JSON-LD family-collapse
**decision is resolved**, but its U27 runtime implementation, parity regression evidence, and launch-gate closure
remain separate pending work until the dedicated implementation PR is green.

## Storefront Refinement V3 execution record

The original V3 design/plan/todo files preserve the planning-state language under which they were authored. After the reviewed implementation slices were merged, current execution/closeout truth is recorded in [Storefront Refinement V3 — U6b final verification record](../docs/verification/storefront-refinement-v3-final.md).

Do not interpret an original `DRAFT` status line in those historical planning files as the current runtime status, and do not infer approval for deferred support content, permanent-domain selection, or `SEARCH_INDEXING_ENABLED=true` from implementation completion.

## Pull request sizing

Current PR sizing is governed by [ADR 0005](../docs/decisions/0005-pr-scope-reviewability.md).

- There is **no hard file-count limit**.
- File count is a signal, not a merge/split gate.
- Use effective changed lines (`additions + deletions`), atomicity, subsystem ownership, risk, verification, and revertability to judge scope.
- `≤300` changed lines is the preferred small-review target; `301–500` is normally acceptable for one coherent concern; `501–800` requires an explicit cohesion/reviewability justification; `>800` defaults to split; `>1000` has a strong presumption to split except for justified mechanical/generated/migration/fixture bulk or an inseparable atomic change.
- Do not split production behavior from directly affected tests/assertions merely to meet a size target.
- Independent concerns should still split even when the diff is small.

Any older `≤5`, `>5`, `~5 files`, or equivalent wording in historical task plans is **non-authoritative for PR sizing** where it conflicts with ADR 0005. Those notes remain useful only as historical estimates; they do not create a mandatory split gate.
