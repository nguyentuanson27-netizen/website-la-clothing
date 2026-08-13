# ADR 0001: Production infrastructure

- **Status:** Accepted for provisioning
- **Date:** 2026-08-13
- **Release baseline:** `788c273a1974ada5131993f6798f405b9ee9b3f5`
- **Bootstrap branch:** `release/production-bootstrap-788c273` (must remain pinned to the release baseline)

## Context

LA Clothing is release-ready at the repository level, but production deployment was intentionally left provider-neutral. The current application requires a persistent Next.js Node runtime, PostgreSQL, production secrets, a trusted proxy-owned single-value client-IP header, custom-domain TLS, database recovery, and an exact-commit deployment path.

The repository currently pins Next.js 16.2.11, Node `>=22.14.0`, pnpm 11.4.0, Prisma 7.9.1, and PostgreSQL. CI runs Node 22 and enables Corepack before using the pinned pnpm version.

The first production release must preserve the existing release rules: run the real environment preflight, review migrations and establish a recoverable database point before migration, deploy the exact approved commit, avoid live Pancake order creation as a generic smoke test, and never blind-retry a Pancake create-order outcome in `SYNC_UNKNOWN`.

Render starts a service's first deploy as part of Web Service creation. Therefore, creating a service from a moving `main` branch and planning to correct it later with `Manual Deploy -> Deploy a specific commit` does **not** guarantee that the first successful production deploy is the approved release baseline. The initial service source itself must be pinned before the service is created.

## Decision

### Hosting

Use a **Render Web Service** in the **Singapore** region.

Initial production settings:

- Workspace: **Render Pro**.
- Environment: dedicated **Production** environment.
- Service runtime: native **Node.js**.
- Instance type: **Standard** as the initial production baseline; resize only from observed load.
- Node version: set `NODE_VERSION=22.22.0` to stay on the same major version as CI and avoid Render's unbounded Node default changing the runtime major.
- Source branch for service creation: **`release/production-bootstrap-788c273`**.
- The bootstrap branch must resolve to exactly `788c273a1974ada5131993f6798f405b9ee9b3f5` immediately before the Web Service is created, and it must not receive later commits.
- Auto-deploy: **disabled at service creation**, not after the first deploy. If provisioning through the Render API, create the service with `autoDeploy=no`. If using another Render flow, it must provide the equivalent pre-create setting; do not create the production Web Service until this is true.
- Build command:
  `corepack enable && pnpm --version && pnpm install --frozen-lockfile --ignore-scripts && pnpm prisma:generate && pnpm build`
- Start command: `pnpm start`.
- Pre-deploy command: `pnpm release:check && pnpm prisma:migrate:deploy`.
- HTTP health check path: **`/shop`** for the bootstrap release.

The production Web Service is provisioned **last**, only after the production database, intended domain value, secrets/configuration, migration review/recovery gate, CI/review evidence, and Pancake production-acceptance gate are ready. Creating the Web Service is itself the action that starts the first deploy.

This sequencing guarantees that Render's first deploy can only build the immutable bootstrap branch at `788c273a1974ada5131993f6798f405b9ee9b3f5`. After Render reports the first deploy successful, the release owner must verify that the deploy metadata records that exact SHA before connecting production DNS or declaring the service live. A SHA mismatch is a release failure and must not receive production traffic.

Provisioning also has a hard compatibility gate: the build log must report **pnpm 11.4.0**. If Render's native runtime does not honor the repository's pinned package-manager version, stop the production launch and make the toolchain deterministic in a separate reviewed change; do not silently downgrade pnpm for production.

After the first successful baseline deploy, later releases use Render's **Deploy a specific commit** flow and keep auto-deploy disabled. The bootstrap branch remains a historical release pointer and is not advanced.

### HTTP readiness

Do not rely only on Render's default TCP port probe. Configure the Web Service health check path as **`/shop`** during initial service creation.

This path exists in the exact bootstrap commit and is an application-level readiness signal rather than a simple socket check: rendering `/shop` reads the configured Pancake shop ID and queries the PostgreSQL-backed storefront catalog. A missing required shop configuration or unavailable database causes the request to fail instead of reporting a healthy instance. The route does not make a live Pancake network request or create an order.

A dedicated minimal `/api/health` endpoint would be preferable for long-term health-check cost and isolation, but it does not exist in the immutable first-release SHA. Adding one would change the application release candidate and is therefore outside this infrastructure-selection PR. It should be considered in a later reviewed application change; until then `/shop` is the bootstrap HTTP readiness path.

### PostgreSQL

Use **Render Postgres** in the same **Singapore** region and workspace as the web service.

Initial database settings:

- Instance type: **Basic-1gb** as the starting capacity; resize based on measured database load.
- Use a paid database so point-in-time recovery is available.
- Because the workspace is Pro, retain the provider's **7-day PITR** recovery window.
- Set application `DATABASE_URL` from the database's **internal URL**, so normal application/database traffic stays on Render's private network.
- Disable unrestricted external database access. Permit external access only for an explicitly reviewed operator/maintenance source when it is required, and remove that rule afterwards.
- Before a release containing a migration that might require restoration, create/confirm the required Render recovery point or logical backup before triggering the deployment whose pre-deploy command runs Prisma migrations.

PITR restores to a new database instance. Database recovery therefore remains a separate operation from application rollback; reverting the web-service commit does not reverse schema/data changes.

### Domain, DNS, and TLS

Use **Cloudflare as the authoritative DNS provider**. If the production domain has not been purchased yet, prefer Cloudflare Registrar when the chosen TLD is supported; otherwise the existing registrar can remain in place while nameservers are delegated to Cloudflare.

The exact production domain is business input and is intentionally not invented by this ADR. It must be chosen before Web Service creation so the intended HTTPS origin can be supplied as `BETTER_AUTH_URL` for the first pre-deploy environment check.

For initial launch:

- Do **not** point the production domain at Render before the first successful deploy's SHA has been verified as `788c273a1974ada5131993f6798f405b9ee9b3f5`.
- After that verification, add the production root domain to the Render web service.
- Configure Cloudflare root and `www` records to point to the Render service according to Render's Cloudflare DNS instructions.
- Keep Cloudflare proxy status **DNS only** while Render verifies the domain and issues certificates; do not introduce a second proxy layer during first-launch acceptance.
- Remove conflicting `AAAA` records while using Render, because Render's documented custom-domain path is IPv4-based.
- Use **Render-managed TLS**. Render issues/renews the certificate and redirects HTTP to HTTPS.

### Production secrets and runtime configuration

Store production secrets in **Render Production environment variables**, not in GitHub, repository files, PR comments, screenshots, or release notes.

Required runtime configuration includes:

- `DATABASE_URL` — Render Postgres internal URL;
- `BETTER_AUTH_SECRET` — newly generated high-entropy production-only secret;
- `BETTER_AUTH_URL` — exact intended `https://` production origin;
- `BETTER_AUTH_IP_HEADER=cf-connecting-ip`;
- `PANCAKE_API_KEY`;
- `PANCAKE_SHOP_ID`;
- approved shipping-policy variables where production differs from repository defaults;
- `NODE_VERSION=22.22.0`.

Render's public web-service traffic passes through Cloudflare and Render documents `CF-Connecting-IP` as proxy-written and caller-uncontrollable. This matches the application's requirement for a trusted, single-value client-IP header and avoids the explicitly rejected generic `x-forwarded-for` path.

### Observability and rollback

Use Render application/deploy logs, HTTP health-check state, and the application's existing Pancake/order telemetry for launch acceptance. The Pro workspace additionally provides HTTP request logs and request identifiers useful for correlating public requests.

Application rollback uses Render's previous known-good deployment / exact known-good commit. Database rollback uses the reviewed Render PITR/logical-backup procedure when data restoration is actually required. These are intentionally separate rollback mechanisms.

The existing Pancake safety invariant is unchanged: a rollback does not undo an order accepted by Pancake, and an order in `SYNC_UNKNOWN` must be reconciled before any further create-order write.

## Alternatives considered

### Vercel + managed PostgreSQL

Not selected for the initial launch. Vercel is a strong Next.js host, but its current official package-manager documentation lists pnpm support through v10 while this repository pins pnpm 11.4.0. Vercel documents Corepack as experimental. Adopting Vercel now would introduce a production-specific package-manager workaround or require changing the repository contract solely for hosting.

Reconsider Vercel if pnpm 11 becomes an officially supported deployment path or the repository intentionally changes package-manager versions for independent reasons.

### Self-managed VM/VPS + PostgreSQL

Not selected. It adds operating-system patching, process supervision, TLS automation, database backup/restore ownership, deployment orchestration, and more incident surface without providing value required by the current launch.

## Consequences

Positive:

- the first successful production deploy is constrained at service creation to the approved exact SHA instead of relying on a corrective deploy afterward;
- compute and database are colocated in Singapore and can use a private network;
- production preflight and Prisma migration can run before promotion of the new build;
- an HTTP application-level readiness signal is enabled from the bootstrap release;
- provider-managed TLS and paid Postgres recovery reduce launch-day operational work;
- production secrets remain outside source control;
- the trusted client-IP configuration has a provider-documented header source.

Trade-offs:

- the immutable bootstrap branch is an operational release pointer that must not be advanced;
- `/shop` is heavier than a dedicated minimal health endpoint and should eventually be replaced by one in a separately reviewed application release;
- this is not Vercel's Next.js-specific platform, so Vercel-only framework optimizations are not part of the production architecture;
- Basic-1gb Postgres is not a high-availability database tier; scale/HA is a later evidence-based capacity decision;
- the exact domain is still a human/business input;
- Render resources, DNS records, secrets, and the Pancake production-acceptance gate still need to be provisioned and verified before go-live.

## Provider references

- Render first deploy/service creation: https://render.com/docs/your-first-deploy
- Render deploys and exact-commit deploys: https://render.com/docs/deploys
- Render Create Service API (`branch`, `autoDeploy`): https://api-docs.render.com/reference/create-service
- Render health checks: https://render.com/docs/health-checks
- Render Node version pinning: https://render.com/docs/node-version
- Render private network: https://render.com/docs/private-network
- Render Postgres connections: https://render.com/docs/postgresql-creating-connecting
- Render Postgres recovery: https://render.com/docs/postgresql-backups
- Render environment variables and secrets: https://render.com/docs/configure-environment-variables
- Render custom domains/TLS: https://render.com/docs/custom-domains
- Render + Cloudflare DNS: https://render.com/docs/configure-cloudflare-dns
- Render client-IP guidance: https://render.com/articles/host-pocketbase-on-render
- Vercel package-manager support: https://vercel.com/docs/package-managers
