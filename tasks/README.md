# Task planning policy

Task plans in this directory define dependencies, ownership, acceptance criteria, and verification for their workstreams.

## Pull request sizing

Current PR sizing is governed by [ADR 0005](../docs/decisions/0005-pr-scope-reviewability.md).

- There is **no hard file-count limit**.
- File count is a signal, not a merge/split gate.
- Use effective changed lines (`additions + deletions`), atomicity, subsystem ownership, risk, verification, and revertability to judge scope.
- `≤300` changed lines is the preferred small-review target; `301–500` is normally acceptable for one coherent concern; `501–800` requires an explicit cohesion/reviewability justification; `>800` defaults to split; `>1000` has a strong presumption to split except for justified mechanical/generated/migration/fixture bulk or an inseparable atomic change.
- Do not split production behavior from directly affected tests/assertions merely to meet a size target.
- Independent concerns should still split even when the diff is small.

Any older `≤5`, `>5`, `~5 files`, or equivalent wording in historical task plans is **non-authoritative for PR sizing** where it conflicts with ADR 0005. Those notes remain useful only as historical estimates; they do not create a mandatory split gate.
