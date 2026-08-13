# LA Clothing release and rollback runbook

This runbook is provider-neutral. The repository does not define a production hosting provider or an automated deploy action, so CI proves release readiness but does not deploy production.

## Release gate

A release candidate is eligible only when all of the following are true:

1. The exact candidate commit has the required human review/approval.
2. CI is green on that exact commit, including migrations, database smoke tests, security/authz HTTP smokes, lint, typecheck, domain/integration tests, production build, release preflight, production-start smoke, and the macOS Chromium/Axe/VoiceOver runtime suite.
3. `pnpm release:check` succeeds with the actual server environment. The command validates configuration without making Pancake requests or printing secret values.
4. The migration diff since the currently deployed commit has been reviewed. Classify every migration as additive/backward-compatible or requiring an explicit data/schema rollback plan.
5. The release owner records the previous known-good application commit and the candidate commit before deployment.

## Configuration preflight

Required server configuration is validated by `pnpm release:check`:

- `DATABASE_URL` must be a PostgreSQL URL;
- Better Auth secret/origin/trusted client-IP-header rules must pass the existing auth validator;
- Pancake API key and positive shop ID must pass the existing integration validator;
- shipping fee/free-shipping thresholds must pass the same server-owned policy parser used by checkout and shopper-facing free-shipping copy.

Do not paste preflight environment values into tickets, CI logs, PR comments, or screenshots. A failed preflight reports the field/rule, not the supplied secret.

## Database and application sequence

1. Confirm a recoverable database backup/snapshot according to the production database provider's operating procedure when the release contains a migration that could require data restoration.
2. Run `pnpm prisma:migrate:deploy` against the target database.
3. Deploy the exact approved application commit.
4. Verify the application process starts successfully using the platform's normal production command (`pnpm start` for a Node.js deployment).
5. Run non-destructive smoke checks for homepage/storefront/cart/checkout/tracking availability. Do not create a live Pancake order solely as a release smoke test.
6. Check application/Pancake integration telemetry for new validation failures, rejected configuration, or `SYNC_UNKNOWN` order outcomes before declaring the release complete.

## Rollback

### Application-only or additive-schema rollback

1. Stop further rollout of the bad candidate.
2. Restore the previous known-good application commit and its previous server configuration.
3. Do **not** automatically reverse database migrations. If migrations are additive and the previous application ignores the new fields/tables, leave the schema in place.
4. Re-run non-destructive smoke checks and verify order tracking/checkout state remains readable.

### Migration or data rollback

If a migration is destructive, changes meanings/types, removes data, or is not backward-compatible, the PR must include a release-specific database rollback/restoration plan before it can pass the release gate. Do not invent a reverse migration during an incident. Restore from the reviewed migration procedure and/or provider backup as appropriate.

### Pancake write safety during rollback

Application rollback does not undo a Pancake order already accepted by the POS. For an order in `SYNC_UNKNOWN`, never issue a blind second create-order request. Reconcile the remote outcome using the existing safe status/reconciliation path before taking any further write action.

## Post-release evidence

Record:

- deployed application commit;
- migration set applied;
- CI run for the exact commit;
- release preflight result (pass/fail only, no secrets);
- smoke-check result;
- any rollback action or `SYNC_UNKNOWN` investigation.
