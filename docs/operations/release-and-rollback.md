# LA Clothing release and rollback runbook

Production infrastructure is defined by [ADR 0001](../decisions/0001-production-infrastructure.md): a Render Web Service and Render Postgres in Singapore, Cloudflare DNS, and Render-managed TLS. CI proves release readiness but does not deploy production automatically. Production auto-deploy remains disabled so every release is an explicit exact-commit action.

## Selected production infrastructure

- **Hosting:** Render Web Service, Singapore, native Node.js, Standard instance, Pro workspace.
- **Runtime:** `NODE_VERSION=22.22.0`; build must report pnpm `11.4.0` before launch is allowed.
- **Bootstrap source:** `release/production-bootstrap-788c273`, permanently pinned to `788c273a1974ada5131993f6798f405b9ee9b3f5`.
- **Auto-deploy:** disabled **at Web Service creation**, not after the first deploy begins.
- **Build:** `corepack enable && pnpm --version && pnpm install --frozen-lockfile --ignore-scripts && pnpm prisma:generate && pnpm build`.
- **Pre-deploy:** `pnpm release:check && pnpm prisma:migrate:deploy`.
- **Start:** `pnpm start`.
- **HTTP readiness:** Render health check path `/shop` for the bootstrap release. It exercises the Next.js request path, required Pancake shop configuration, and PostgreSQL-backed storefront catalog without making a live Pancake network call.
- **Database:** paid Render Postgres Basic-1gb in Singapore; application `DATABASE_URL` uses the database internal URL.
- **Database recovery:** Render PITR is required; the selected Pro workspace provides a 7-day recovery window. Create a logical backup/recovery point before a migration when the reviewed migration risk calls for one.
- **DNS:** Cloudflare authoritative DNS. Keep the Render records DNS-only for initial verification/launch and remove conflicting `AAAA` records.
- **TLS:** Render-managed certificate and HTTP-to-HTTPS redirect.
- **Secrets:** Render Production environment variables. Production secrets do not belong in GitHub or repository files.
- **Trusted client IP:** `BETTER_AUTH_IP_HEADER=cf-connecting-ip`.
- **First release candidate:** `788c273a1974ada5131993f6798f405b9ee9b3f5`.

The exact public domain is still a human/business input. Do not invent `BETTER_AUTH_URL`; choose the production domain before the Web Service is created so the intended HTTPS origin can be supplied during the first pre-deploy check.

## Why Web Service creation is a release action

Render starts a service's first deploy as part of Web Service creation. Therefore, **do not create the production Web Service early** and plan to correct it later with `Manual Deploy -> Deploy a specific commit`.

The production Web Service is created only after every pre-launch prerequisite that can be completed without it is ready. Its initial linked branch is the immutable bootstrap branch `release/production-bootstrap-788c273`, which must resolve to exactly `788c273a1974ada5131993f6798f405b9ee9b3f5`. Auto-deploy must already be off in the create-service configuration.

This is the invariant:

> The first successful Render production deploy must have commit SHA `788c273a1974ada5131993f6798f405b9ee9b3f5`. No newer `main`/PR commit is allowed to become the first live deploy.

If the bootstrap branch does not resolve to that exact SHA, if auto-deploy cannot be disabled before service creation, or if the first successful Render deploy metadata shows another SHA, stop the launch. Do not connect production DNS or treat the service as released.

## Release gate

A release candidate is eligible only when all of the following are true:

1. The exact candidate commit has the required human review/approval.
2. CI is green on that exact commit, including migrations, database smoke tests, security/authz HTTP smokes, lint, typecheck, domain/integration tests, production build, release preflight, production-start smoke, and the macOS Chromium/Axe/VoiceOver runtime suite.
3. The intended Render production environment values are prepared. `pnpm release:check` runs in Render's pre-deploy phase and must succeed before migration/promotion.
4. The migration diff since the currently deployed commit has been reviewed. Classify every migration as additive/backward-compatible or requiring an explicit data/schema rollback plan.
5. A recoverable Render Postgres point exists when the migration review requires restoration safety. Create/confirm it **before** Web Service creation or any later Render deployment whose pre-deploy command applies Prisma migrations.
6. The release owner records the previous known-good application commit and the candidate commit before deployment.
7. For the first release, `release/production-bootstrap-788c273` resolves exactly to `788c273a1974ada5131993f6798f405b9ee9b3f5` and has not been advanced.
8. For the first release, production auto-deploy will be disabled in the Web Service creation request/configuration.
9. The controlled Pancake production-acceptance gate required for launch has been completed. Do not use Web Service creation as a substitute for that acceptance step.

## Configuration preflight

Required server configuration is validated by `pnpm release:check`:

- `DATABASE_URL` must be the Render Postgres internal PostgreSQL URL used by the application;
- `BETTER_AUTH_SECRET` is a production-only high-entropy secret;
- `BETTER_AUTH_URL` is the exact intended HTTPS production origin;
- `BETTER_AUTH_IP_HEADER=cf-connecting-ip`;
- Pancake API key and positive shop ID pass the existing integration validator;
- shipping fee/free-shipping thresholds pass the same server-owned policy parser used by checkout and shopper-facing free-shipping copy.

Also set `NODE_VERSION=22.22.0` for the Render service. During the first provider build, verify the build log reports pnpm `11.4.0`. If it does not, stop the launch and fix the toolchain deterministically in a reviewed change; do not silently downgrade the repository's pinned package manager.

Do not paste preflight environment values into tickets, CI logs, PR comments, or screenshots. A failed preflight reports the field/rule, not the supplied secret.

## HTTP readiness

Configure the Render Web Service health check path as **`/shop`** during service creation instead of relying only on the default TCP port probe.

The exact bootstrap SHA does not contain a dedicated health endpoint, but `/shop` is suitable as an initial application-level readiness signal because it:

- exists in `788c273a1974ada5131993f6798f405b9ee9b3f5`;
- resolves the required configured Pancake shop ID;
- queries the PostgreSQL-backed storefront catalog;
- returns an application error when those required dependencies are not usable;
- does **not** call Pancake over the network or create an order.

Render considers a new deploy ready only after its configured HTTP health check returns a successful HTTP status. A future reviewed application release should replace `/shop` with a minimal dedicated readiness endpoint such as `/api/health`; do not change the first-release SHA merely to add that endpoint.

## First production launch

The ordering below is mandatory because creating a Render Web Service immediately starts its first deploy.

1. Merge/review the infrastructure documentation as required, but keep the application release candidate fixed at `788c273a1974ada5131993f6798f405b9ee9b3f5`.
2. Confirm GitHub branch `release/production-bootstrap-788c273` resolves exactly to `788c273a1974ada5131993f6798f405b9ee9b3f5`. Do not move this branch.
3. Provision the Render Pro workspace/project Production environment and paid Render Postgres in **Singapore**. **Do not create the production Web Service yet.**
4. Restrict Postgres external access. Prepare the application `DATABASE_URL` from the database's internal URL.
5. Choose the production domain and prepare Cloudflare authoritative DNS. Do not point the production hostname at a Render service yet.
6. Prepare the production environment values/secrets needed by `release:check`, including the intended HTTPS `BETTER_AUTH_URL`, Better Auth secret, Pancake credentials/shop ID, trusted IP header, shipping policy, and Node version. Do not copy production secrets into GitHub Actions.
7. Confirm exact-SHA CI/review evidence, complete the migration review/recovery gate, and complete the controlled Pancake production-acceptance gate.
8. Create the **production Render Web Service last** with all of these settings in the creation request/form:
   - source branch `release/production-bootstrap-788c273`;
   - auto-deploy **Off** from creation (`autoDeploy=no` when using the Render API);
   - Singapore / Standard / Node runtime;
   - the approved build, pre-deploy, and start commands;
   - all required production environment values;
   - HTTP health check path `/shop`.
9. Creating the Web Service starts Render's first deploy. Observe the build and confirm Node 22.22.0 and pnpm 11.4.0. A toolchain mismatch is a release blocker.
10. Observe the pre-deploy command: `pnpm release:check && pnpm prisma:migrate:deploy`. Any failure blocks promotion and must be diagnosed before retrying. Because the service remains linked to the immutable bootstrap branch, retries must still build the exact baseline SHA.
11. Verify the application process starts with `pnpm start` and Render's `/shop` HTTP health check passes.
12. **Before connecting production DNS**, inspect the successful Render deploy metadata and verify its Git commit is exactly `788c273a1974ada5131993f6798f405b9ee9b3f5`. If it is not exact, stop; do not route production traffic.
13. Add the production root domain to Render, configure Cloudflare root/`www` records according to Render's Cloudflare instructions, keep them DNS-only for certificate verification, and wait for Render-managed TLS to succeed.
14. Run non-destructive smoke checks: homepage -> shop -> product/cart -> checkout availability -> tracking. **Do not create a live Pancake order solely as a release smoke test.**
15. Check Render application/request logs, HTTP health-check state, and existing Pancake integration telemetry for new validation failures, rejected configuration, or `SYNC_UNKNOWN` order outcomes before declaring launch complete.
16. Record the post-release evidence listed below.

## Later production releases

For each later release:

1. Record the previous known-good commit and exact approved candidate SHA.
2. Confirm exact-head CI/review evidence.
3. Review migration changes since the deployed commit and create/confirm a database recovery point when required.
4. Trigger **Manual Deploy -> Deploy a specific commit** in Render using the exact approved SHA. Keep auto-deploy disabled. Do not advance the bootstrap branch.
5. Observe build -> production preflight -> migration -> start -> HTTP readiness.
6. Verify Render deploy metadata records the intended SHA.
7. Run the same non-destructive smoke and telemetry checks.

## Rollback

### Application-only or additive-schema rollback

1. Stop further rollout of the bad candidate.
2. Deploy the previous known-good application commit in Render using an exact-commit deploy. Restore its previous server configuration if configuration changed.
3. Do **not** automatically reverse database migrations. If migrations are additive and the previous application ignores the new fields/tables, leave the schema in place.
4. Re-run the HTTP readiness check and non-destructive smoke checks; verify order tracking/checkout state remains readable.
5. Confirm Render logs and application telemetry have returned to the expected state.

### Migration or data rollback

If a migration is destructive, changes meanings/types, removes data, or is not backward-compatible, the PR must include a release-specific database rollback/restoration plan before it can pass the release gate. Do not invent a reverse migration during an incident.

Render PITR restores to a new database instance. When recovery is required, restore according to the reviewed recovery procedure, validate the recovered database, then deliberately switch `DATABASE_URL` to the recovered instance. Rolling back the web-service commit alone is not a database rollback.

### Pancake write safety during rollback

Application rollback does not undo a Pancake order already accepted by the POS. For an order in `SYNC_UNKNOWN`, never issue a blind second create-order request. Reconcile the remote outcome using the existing safe status/reconciliation path before taking any further write action.

## Post-release evidence

Record:

- deployed application commit;
- for the first launch, evidence that `release/production-bootstrap-788c273` resolved to `788c273a1974ada5131993f6798f405b9ee9b3f5` immediately before service creation;
- Render deploy identifier and recorded Git commit SHA;
- migration set applied;
- CI run for the exact commit;
- production `release:check` result (pass/fail only, no secrets);
- database recovery/backup evidence when required;
- HTTP health-check result/path;
- domain/TLS status for first launch or domain changes;
- smoke-check result;
- Render/Pancake telemetry review result;
- any rollback action or `SYNC_UNKNOWN` investigation.
