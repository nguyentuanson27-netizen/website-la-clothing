# LA Clothing release and rollback runbook

Production infrastructure is defined by [ADR 0001](../decisions/0001-production-infrastructure.md): a Render Web Service and Render Postgres in Singapore, Cloudflare DNS, and Render-managed TLS. CI proves release readiness but does not deploy production automatically. Production auto-deploy remains disabled so every release is an explicit exact-commit action.

## Selected production infrastructure

- **Hosting:** Render Web Service, Singapore, native Node.js, Standard instance, Pro workspace.
- **Runtime:** `NODE_VERSION=22.22.0`; build must report pnpm `11.4.0` before launch is allowed.
- **Build:** `corepack enable && pnpm --version && pnpm install --frozen-lockfile --ignore-scripts && pnpm prisma:generate && pnpm build`.
- **Pre-deploy:** `pnpm release:check && pnpm prisma:migrate:deploy`.
- **Start:** `pnpm start`.
- **Database:** paid Render Postgres Basic-1gb in Singapore; application `DATABASE_URL` uses the database internal URL.
- **Database recovery:** Render PITR is required; the selected Pro workspace provides a 7-day recovery window. Create a logical backup/recovery point before a migration when the reviewed migration risk calls for one.
- **DNS:** Cloudflare authoritative DNS. Keep the Render records DNS-only for initial verification/launch and remove conflicting `AAAA` records.
- **TLS:** Render-managed certificate and HTTP-to-HTTPS redirect.
- **Secrets:** Render Production environment variables. Production secrets do not belong in GitHub or repository files.
- **Trusted client IP:** `BETTER_AUTH_IP_HEADER=cf-connecting-ip`.
- **First release candidate:** `788c273a1974ada5131993f6798f405b9ee9b3f5`.

The exact public domain is still a human/business input. Do not invent `BETTER_AUTH_URL`; provision it only after the production domain is chosen and connected to Render.

## Release gate

A release candidate is eligible only when all of the following are true:

1. The exact candidate commit has the required human review/approval.
2. CI is green on that exact commit, including migrations, database smoke tests, security/authz HTTP smokes, lint, typecheck, domain/integration tests, production build, release preflight, production-start smoke, and the macOS Chromium/Axe/VoiceOver runtime suite.
3. The Render production environment contains the required production configuration. `pnpm release:check` will run again in Render's pre-deploy phase and must succeed before migration/promotion.
4. The migration diff since the currently deployed commit has been reviewed. Classify every migration as additive/backward-compatible or requiring an explicit data/schema rollback plan.
5. A recoverable Render Postgres point exists when the migration review requires restoration safety. Create/confirm it **before** triggering the Render deployment, because the deployment's pre-deploy command applies Prisma migrations.
6. The release owner records the previous known-good application commit and the candidate commit before deployment.
7. Render auto-deploy is disabled and the intended release will be triggered as an exact-commit deploy.

## Configuration preflight

Required server configuration is validated by `pnpm release:check`:

- `DATABASE_URL` must be the Render Postgres internal PostgreSQL URL used by the application;
- `BETTER_AUTH_SECRET` is a production-only high-entropy secret;
- `BETTER_AUTH_URL` is the exact HTTPS production origin;
- `BETTER_AUTH_IP_HEADER=cf-connecting-ip`;
- Pancake API key and positive shop ID pass the existing integration validator;
- shipping fee/free-shipping thresholds pass the same server-owned policy parser used by checkout and shopper-facing free-shipping copy.

Also set `NODE_VERSION=22.22.0` for the Render service. During the first provider build, verify the build log reports pnpm `11.4.0`. If it does not, stop the launch and fix the toolchain deterministically in a reviewed change; do not silently downgrade the repository's pinned package manager.

Do not paste preflight environment values into tickets, CI logs, PR comments, or screenshots. A failed preflight reports the field/rule, not the supplied secret.

## First production launch

1. Provision the Render Pro workspace/project Production environment, paid web service, and paid Render Postgres in **Singapore**.
2. Restrict Postgres external access. The web service must use the database's internal URL.
3. Add production environment variables in Render. Do not copy secrets into GitHub Actions merely to simplify deployment.
4. Choose/connect the production domain in Render. Configure Cloudflare DNS according to Render's Cloudflare instructions, initially DNS-only, and wait for Render TLS verification to succeed.
5. Confirm CI approval/evidence for exact commit `788c273a1974ada5131993f6798f405b9ee9b3f5`.
6. Review the complete migration set that will be applied to the fresh production database. If restoration safety is required, create/confirm the Render Postgres recovery point/logical backup before deployment.
7. In Render, use **Manual Deploy → Deploy a specific commit** and select/paste `788c273a1974ada5131993f6798f405b9ee9b3f5`. Keep auto-deploy disabled.
8. Observe the build. Confirm Node 22.22.0 and pnpm 11.4.0. A toolchain mismatch is a release blocker.
9. Observe the pre-deploy command: `pnpm release:check && pnpm prisma:migrate:deploy`. Any failure blocks promotion and must be diagnosed before retrying.
10. Verify the application process starts successfully with `pnpm start`.
11. Run non-destructive smoke checks: homepage → shop → product/cart → checkout availability → tracking. **Do not create a live Pancake order solely as a release smoke test.**
12. Check Render application/request logs and existing Pancake integration telemetry for new validation failures, rejected configuration, or `SYNC_UNKNOWN` order outcomes before declaring launch complete.
13. Record the post-release evidence listed below.

## Later production releases

For each later release:

1. Record the previous known-good commit and exact approved candidate SHA.
2. Confirm exact-head CI/review evidence.
3. Review migration changes since the deployed commit and create/confirm a database recovery point when required.
4. Trigger an exact-commit Render deployment. Do not re-enable automatic deploys as part of normal release operations.
5. Observe build → production preflight → migration → start.
6. Run the same non-destructive smoke and telemetry checks.

## Rollback

### Application-only or additive-schema rollback

1. Stop further rollout of the bad candidate.
2. Deploy the previous known-good application commit in Render using an exact-commit deploy. Restore its previous server configuration if configuration changed.
3. Do **not** automatically reverse database migrations. If migrations are additive and the previous application ignores the new fields/tables, leave the schema in place.
4. Re-run non-destructive smoke checks and verify order tracking/checkout state remains readable.
5. Confirm Render logs and application telemetry have returned to the expected state.

### Migration or data rollback

If a migration is destructive, changes meanings/types, removes data, or is not backward-compatible, the PR must include a release-specific database rollback/restoration plan before it can pass the release gate. Do not invent a reverse migration during an incident.

Render PITR restores to a new database instance. When recovery is required, restore according to the reviewed recovery procedure, validate the recovered database, then deliberately switch `DATABASE_URL` to the recovered instance. Rolling back the web-service commit alone is not a database rollback.

### Pancake write safety during rollback

Application rollback does not undo a Pancake order already accepted by the POS. For an order in `SYNC_UNKNOWN`, never issue a blind second create-order request. Reconcile the remote outcome using the existing safe status/reconciliation path before taking any further write action.

## Post-release evidence

Record:

- deployed application commit;
- Render deploy identifier;
- migration set applied;
- CI run for the exact commit;
- production `release:check` result (pass/fail only, no secrets);
- database recovery/backup evidence when required;
- domain/TLS status for first launch or domain changes;
- smoke-check result;
- Render/Pancake telemetry review result;
- any rollback action or `SYNC_UNKNOWN` investigation.
