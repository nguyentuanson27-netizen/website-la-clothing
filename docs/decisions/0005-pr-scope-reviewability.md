# ADR 0005: Pull request scope is governed by atomicity and reviewability, not file count

- **Status:** Accepted
- **Date:** 2026-08-25
- **Supersedes:** fixed `≤5 files`, `>5 files`, `~5 files`, and equivalent file-count guidance when it is used as a mandatory PR split/merge gate in task plans or checklists
- **Preserves:** task dependencies, subsystem ownership, acceptance criteria, verification requirements, security boundaries, and Definition of Done

## Context

Earlier LA Clothing plans used a small file-count heuristic to encourage focused pull requests. That heuristic was useful as a warning against broad changes, but it became an overly rigid gate: a cohesive copy/test change could be forced into multiple stacked PRs merely because directly affected assertions were spread across more than five files.

Raw file count is a weak proxy for review cost. A seven-file change with forty changed lines and one behavioral contract can be easier to review, verify, revert, and reason about than a three-file change with hundreds of lines across persistence, security, and UI concerns.

The repository therefore needs a sizing policy that preserves small, focused changes without making file count itself authoritative.

## Decision

1. **There is no hard PR file-count limit.** File count is a review signal only. A PR is not required to split merely because it touches more than five files.
2. **Judge scope primarily by atomicity, subsystem ownership, risk, and effective changed lines.** Use the effective diff against the intended base, not commit count or historical branch churn.
3. **Default changed-line guidance** uses `additions + deletions` for human-authored code, tests, and docs:
   - `≤300` changed lines: small/easy review target;
   - `301–500`: normally acceptable when the PR owns one coherent concern;
   - `501–800`: author must explain why the diff remains atomic and reviewable; actively consider splitting;
   - `>800`: default to splitting unless keeping the change together materially improves correctness or verification;
   - `>1000`: strong presumption to split, with exceptions only when most of the bulk is mechanical/generated/migration/fixture output or an inseparable atomic change.
4. **Independent concerns must still split when practical even below the line thresholds.** Examples include unrelated refactors, separate product features, independent persistence/security/UI changes, or changes that can be reviewed, merged, reverted, and verified independently without weakening either contract.
5. **Do not split source from directly affected verification merely to hit a size target.** Tests/assertions that prove the changed behavior belong with that behavior. A cohesive cross-file rename, contract update, or assertion sweep may legitimately touch many files.
6. **Mechanical bulk is reported separately.** Generated files, lockfiles, vendored artifacts, large fixtures, and migration output do not by themselves force a split, but they must be called out explicitly and still receive any applicable dependency, security, or migration review.
7. **Reviewability remains the gate.** A PR should have one explainable intent, bounded ownership, a verification story reviewers can trace, and a practical rollback/revert story. If reviewers cannot establish correctness without mentally reviewing several independent changes at once, the PR is too broad regardless of line count.
8. **Historical plan wording is non-authoritative where it conflicts with this ADR.** Existing `≤5`, `>5`, or `~5 files` notes may remain as historical estimates, but ADR 0005 governs whether a current or future PR must split.

## Examples

- **Acceptable without splitting:** 7–10 files, 40–150 changed lines, all implementing one buyer-copy contract plus directly affected independent assertions.
- **Usually acceptable:** 4 files, ~450 changed lines, one cohesive feature with focused tests and one ownership boundary.
- **Should split:** 3 files, ~250 changed lines, but the diff mixes an unrelated refactor, an auth policy change, and a UI behavior change.
- **Default split:** ~900 human-authored changed lines spanning multiple independently verifiable surfaces.

## Consequences

- Review agents must stop treating file count as an automatic Required finding.
- Plans may still suggest likely files or smaller slices, but those estimates do not override this policy.
- PR descriptions should call out effective diff size and justify cohesion when the diff is above ~500 changed lines or spans multiple ownership boundaries.
- Directly affected tests can remain with their source change even when that raises the file count.
- Very large PRs remain discouraged; the policy replaces an arbitrary file cap with explicit reviewability and risk criteria rather than removing scope discipline.
