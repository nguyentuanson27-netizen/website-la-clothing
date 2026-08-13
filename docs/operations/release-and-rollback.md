# LA Clothing release and rollback runbook

Production infrastructure is defined by [ADR 0002](../decisions/0002-vps-production-infrastructure.md): a self-managed VPS running Docker Compose with Next.js, PostgreSQL, and Caddy. [ADR 0001](../decisions/0001-production-infrastructure.md) remains historical context for the superseded Render decision.

Host provisioning is documented in [VPS bootstrap handoff](./vps-bootstrap.md).

## Release model

Production does not auto-deploy a moving branch. Every release uses one reviewed, CI-green, full 40-character Git SHA.

`deploy/vps/.env.production` contains `RELEASE_SHA`. `bash deploy/vps/deploy.sh` refuses to continue if the checked-out commit differs or the worktree is dirty.

The old Render bootstrap commit `788c273a1974ada5131993f6798f405b9ee9b3f5` remains historical release evidence. After the VPS-readiness change is merged, the first VPS candidate must be the exact newly reviewed commit containing the VPS deployment assets, not an automatic reuse of the old Render candidate.

## Release gate

A candidate is eligible only when all of these are true:

1. Human review/approval exists for the exact candidate.
2. CI is green on that exact commit, including normal application gates and the VPS Docker/Compose smoke.
3. The production domain and server configuration are known.
4. `deploy/vps/.env.production` contains real production values and is protected on the VPS.
5. PostgreSQL/Caddy image references have been reviewed/pinned for the host.
6. Migration changes since the current deployment have been reviewed.
7. Off-site backup is configured and a restore drill has succeeded; destructive migrations additionally have a release-specific recovery plan.
8. The previous known-good application SHA/image is recorded and retained locally.
9. The controlled Pancake production write acceptance has completed; a read-only contract probe alone is insufficient.
10. VPS host firewall/SSH/TLS/monitoring prerequisites in `vps-bootstrap.md` are satisfied.

## Production configuration preflight

The canonical preflight remains:

```bash
pnpm release:check
```

On VPS it is run inside the `ops` Docker target with the real production environment before migration. It validates PostgreSQL URL shape, Better Auth URL/secret/trusted IP header, Pancake configuration, and shipping policy without printing secret values.

Production uses:

```text
BETTER_AUTH_URL=https://<production-domain>
BETTER_AUTH_IP_HEADER=x-la-client-ip
DATABASE_URL=postgresql://...@postgres:5432/...
```

Caddy overwrites `X-LA-Client-IP` before proxying to Next.js. Initial Cloudflare records remain DNS-only so Caddy is the direct edge. Cloudflare proxying requires a later trusted-proxy review before enablement.

## Standard release

1. Record current known-good SHA and candidate SHA.
2. Confirm review/CI for the candidate.
3. Review migrations and database recovery requirements.
4. Confirm off-site backup/restore evidence and current backup freshness.
5. Confirm Pancake controlled production acceptance is complete.
6. On VPS, fetch and detach at the exact candidate SHA; confirm clean worktree.
7. Set `RELEASE_SHA` in protected `deploy/vps/.env.production` to the same exact SHA.
8. Run:

   ```bash
   bash deploy/vps/deploy.sh
   ```

9. The helper validates Compose, builds exact-SHA images, starts/waits for PostgreSQL, runs production `release:check`, creates a pre-migration custom-format dump, deploys Prisma migrations, starts the exact app image, and waits for `/shop` health.
10. Verify public HTTPS and non-destructive buyer-flow smoke through Caddy.
11. Review Caddy/application/PostgreSQL logs and container health.
12. Record post-release evidence before declaring success.

Do not create a live Pancake order merely as a generic release smoke test. The write acceptance is a controlled, separately recorded gate.

## Rollback triggers

Rollback/recovery is required for material user harm or integrity/security risk, including:

- the app container cannot become healthy;
- public critical buyer flows fail after promotion;
- new auth/authz/security failure is observed;
- a migration causes data/read/write integrity issues;
- checkout/Pancake telemetry shows a release-caused unsafe state.

## Application-only rollback

When schema/data remain compatible with the previous application:

```bash
bash deploy/vps/rollback.sh <PREVIOUS_APPROVED_FULL_SHA>
```

The previous exact image must already exist locally. The rollback helper does not rebuild old code during the incident.

After rollback:

- wait for `/shop` health;
- verify public HTTPS and critical read/checkout/tracking flows;
- inspect logs/error state;
- record the failed candidate and rollback SHA.

Do not automatically reverse additive migrations.

## Database/data recovery

Application rollback is not database rollback.

For destructive/incompatible migrations or damaged data, use the release-specific recovery plan. Restore the selected logical/off-site backup into an isolated target first, validate it, then deliberately switch the application database only after the recovery point is understood.

Never invent a reverse migration while responding to an incident.

## Pancake write safety during rollback

Application or database rollback does not undo a Pancake order accepted by the external POS.

For an order in `SYNC_UNKNOWN`, never issue a blind duplicate create request. Use the existing status/reconciliation path to determine the remote outcome before any additional write.

## Post-release evidence

Record without secrets:

- exact deployed application SHA;
- GitHub CI run for that SHA;
- runtime Docker image tag/digest;
- PostgreSQL and Caddy image digests;
- `release:check` pass/fail;
- migration set applied;
- local pre-migration dump path/checksum;
- off-site backup freshness / restore-drill reference;
- `/shop` health result;
- domain/TLS status;
- public non-destructive smoke result;
- Caddy/app/database telemetry review;
- Pancake production-acceptance evidence;
- previous known-good SHA retained for rollback;
- any rollback or `SYNC_UNKNOWN` reconciliation performed.

## Host-only work not performed by repository automation

The repository cannot claim these complete until observed on the real VPS:

- OS hardening/patching;
- SSH/firewall configuration;
- Docker Engine/Compose installation;
- production DNS and certificate issuance;
- real secret installation;
- off-site backup scheduling and restore drill;
- external uptime/disk/backup alerting;
- controlled Pancake create -> verify -> cancel acceptance;
- first real production deploy and public smoke.
