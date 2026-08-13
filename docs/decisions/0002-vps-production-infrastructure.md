# ADR 0002: Self-managed VPS production infrastructure

- **Status:** Accepted
- **Date:** 2026-08-13
- **Supersedes:** ADR 0001 (Render production infrastructure)

## Context

LA Clothing is a Next.js 16.2.11 application with PostgreSQL/Prisma, Better Auth, and Pancake POS integration. The application runtime is provider-portable: it builds with the repository's pinned Node/pnpm toolchain, starts with the Next.js Node server, and receives database/auth/Pancake configuration from server environment variables.

ADR 0001 selected Render to minimize launch-day operations. The production platform decision has now changed to a self-managed VPS. Render-specific provisioning, PITR, deploy metadata, and managed TLS are therefore no longer the active production path.

The VPS path must preserve the existing safety invariants: exact approved-commit releases, production configuration preflight, recoverable database state before migrations, HTTP readiness, no blind Pancake write retries, and explicit rollback evidence.

## Decision

### Deployment unit

Use Docker Compose on one production VPS for the initial launch. The repository defines four services:

- `app`: the LA Clothing Next.js production runtime;
- `postgres`: PostgreSQL 16 persistent database;
- `caddy`: public reverse proxy and TLS terminator;
- `ops`: one-shot image target for `release:check` and Prisma migrations.

Only Caddy publishes host ports. PostgreSQL and Next.js remain reachable only on the Compose bridge network.

The first VPS release after this ADR is **not** automatically the old Render bootstrap SHA. The release candidate is the exact commit that contains the reviewed VPS deployment assets after it has passed CI and human review. Every release records and deploys one full 40-character Git SHA.

### Application image

Use `node:22.22.0-bookworm-slim`, matching the Node 22 production contract selected for the project. The Dockerfile verifies that Corepack resolves repository-pinned `pnpm 11.4.0` before installing dependencies.

Use a multi-stage build:

1. immutable lockfile install with lifecycle scripts disabled;
2. Prisma client generation and Next.js build;
3. production-only dependency install;
4. non-root Node runtime image.

The runtime starts the standard Next.js Node server and exposes only container port 3000. `/shop` remains the bootstrap application-level health path because it exercises required shop configuration and the PostgreSQL-backed storefront without creating a Pancake order.

### PostgreSQL

Run PostgreSQL 16 in a dedicated Compose service with a persistent named volume. Do not publish PostgreSQL to a host/public port.

Before each migration deployment, create a `pg_dump --format=custom` logical dump. The repository deploy helper creates this local pre-migration recovery artifact before `prisma migrate deploy`.

A dump stored only on the same VPS is **not** a complete production backup strategy. Before go-live, the VPS operator must configure encrypted/off-site backup replication, retention, monitoring, and a restore drill. Database recovery remains separate from application rollback.

### Reverse proxy, TLS, and client IP

Use Caddy as the only public HTTP(S) service. Caddy obtains/renews public TLS certificates once the chosen production domain resolves to the VPS and ports 80/443 are reachable.

For initial launch, keep Cloudflare as authoritative DNS but use **DNS-only** records. Caddy is therefore the direct HTTP edge.

Caddy overwrites `X-LA-Client-IP` on every upstream request with `{client_ip}`. Production uses:

`BETTER_AUTH_IP_HEADER=x-la-client-ip`

This preserves the application's requirement for a proxy-owned single-value client-IP header and prevents a caller-supplied value for that header from reaching the application unchanged.

If Cloudflare proxying is enabled later, first configure and review Caddy `trusted_proxies` / strict client-IP parsing for current Cloudflare ranges. Do not enable the orange-cloud proxy first and attempt to fix client-IP trust afterward.

### Production configuration and secrets

The real production environment file lives only on the VPS at `deploy/vps/.env.production`, copied from the committed placeholder template. It must be mode 600 or equivalently protected and must never be committed.

Required production values include:

- exact `RELEASE_SHA`;
- public `APP_DOMAIN` and matching HTTPS `BETTER_AUTH_URL`;
- high-entropy `BETTER_AUTH_SECRET`;
- `BETTER_AUTH_IP_HEADER=x-la-client-ip`;
- PostgreSQL database/user/password plus application `DATABASE_URL` using Compose host `postgres`;
- Pancake API key/shop ID;
- approved shipping-policy values;
- reviewed PostgreSQL/Caddy image references.

No production secret belongs in GitHub source, workflow YAML, PR comments, screenshots, or deployment logs.

### Exact-SHA release sequence

The repository's `deploy/vps/deploy.sh` is the canonical host-side helper. It:

1. refuses a dirty checkout;
2. refuses when `git rev-parse HEAD` differs from `RELEASE_SHA`;
3. validates the Compose model;
4. builds the runtime and operations images tagged from the exact SHA;
5. starts/waits for PostgreSQL;
6. runs `pnpm release:check` with the real production environment;
7. creates a pre-migration logical dump;
8. runs `pnpm prisma:migrate:deploy`;
9. promotes the exact tagged app image behind Caddy;
10. waits for `/shop` container health.

The helper does not change DNS, provision host firewall/SSH, perform off-site backup replication, or execute a live Pancake create-order acceptance. Those remain explicit operator gates.

### Rollback

Application rollback uses a locally retained previous `la-clothing:<full-sha>` image and `deploy/vps/rollback.sh <previous-sha>`. The helper refuses to rebuild an old revision during an incident; the exact previous image must already exist locally.

Application rollback does not reverse Prisma migrations/data changes and does not undo Pancake orders. Destructive migrations require a release-specific database recovery plan. `SYNC_UNKNOWN` Pancake writes continue to require reconciliation rather than a blind second create request.

### Host security and operations

Before go-live, the VPS operator/agent must complete host-only controls that cannot safely be committed in the repository:

- patch a supported Linux distribution and enable timely security updates;
- create a non-root operator account and key-based SSH access;
- restrict SSH and disable password/root login after verified replacement access exists;
- expose only required public ports (normally 80/443 plus a deliberately restricted SSH path);
- install current Docker Engine + Compose from an official source;
- protect Docker daemon access as root-equivalent;
- configure disk/resource monitoring and log retention;
- configure off-site database backups and test restoration;
- record/pin reviewed container image digests before production promotion.

### Observability

The initial stack provides Docker container state/health, application stdout/stderr, PostgreSQL health, and Caddy structured access logs. Production launch additionally requires host/disk monitoring, backup-job monitoring, and an external uptime/error alerting path selected by the operator.

Do not log production secrets, auth headers, Pancake credentials, full checkout bodies, or unnecessary customer PII.

## Alternatives considered

### Render Web Service + Render Postgres

Previously accepted in ADR 0001 because managed deploys, TLS, logs, and database recovery reduce operational burden. It is superseded because the production owner chose VPS deployment and accepts the additional server/database operations responsibility.

### Native Node/systemd without containers

Feasible, but rejected for the initial VPS path. Docker Compose gives one repository-defined runtime topology, isolates PostgreSQL and the application from host ports, tags application images by exact Git SHA, and makes rollback less dependent on mutable host-level package state.

### Managed PostgreSQL with VPS application

Still a valid future option if database operational burden becomes undesirable. The current initial topology keeps PostgreSQL on the VPS to minimize provider dependencies, with off-site backup/restore as a mandatory launch gate.

## Consequences

Positive:

- the application is no longer coupled operationally to Render;
- runtime, database, proxy, and release sequence are reviewable in source control;
- exact-SHA application images provide a concrete rollback artifact;
- only the reverse proxy is publicly exposed by Compose;
- provider cost/control can be optimized independently.

Trade-offs:

- OS patching, Docker, PostgreSQL recovery, disk capacity, firewall, TLS reachability, and incident response are now operator responsibilities;
- same-host PostgreSQL creates a larger single-machine failure domain than managed database infrastructure;
- local pre-migration dumps must be replicated off-host to become resilient backups;
- Cloudflare proxying requires an additional trusted-proxy review before enablement;
- zero-downtime multi-instance rollout is not part of the initial single-VPS design.

## References

- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- Next.js deployment options: https://nextjs.org/docs/app/getting-started/deploying
- Docker build best practices: https://docs.docker.com/build/building/best-practices/
- Docker Compose service health/restart: https://docs.docker.com/reference/compose-file/services/
- Caddy automatic HTTPS: https://caddyserver.com/docs/quick-starts/https
- Caddy reverse proxy headers/health: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy trusted proxies/client IP: https://caddyserver.com/docs/caddyfile/options
