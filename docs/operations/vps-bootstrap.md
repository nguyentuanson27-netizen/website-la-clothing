# VPS bootstrap handoff

This runbook is for the agent/operator that has shell access to the production VPS. Repository preparation does **not** prove these host steps have happened.

## Inputs required before host work

- intended production domain;
- exact approved Git commit SHA after VPS-readiness review/CI;
- production Pancake API key and shop ID;
- production Better Auth secret;
- selected VPS IP/provider and backup destination;
- approved SSH administration source/access model.

Never paste production secrets into issues, PRs, CI logs, or chat transcripts used as public/project records.

## 1. Harden the host

Use a supported Linux release. Apply security updates before installing the application stack.

Create a non-root operator with key-based SSH. Verify replacement access in a second session before disabling password/root SSH. Restrict inbound traffic so only the deliberately chosen SSH path and public 80/443 are reachable.

Install Docker Engine and Docker Compose from an official source. Treat membership/access to the Docker daemon as root-equivalent.

Record:

```text
OS/version:
Docker version:
Docker Compose version:
VPS public IP:
operator account:
firewall policy:
```

## 2. Check out the exact approved release

Clone the repository into an operator-owned deployment directory, fetch the approved commit, and detach at that exact SHA:

```bash
git clone https://github.com/nguyentuanson27-netizen/website-la-clothing.git
cd website-la-clothing
git fetch --all --tags --prune
git checkout --detach <APPROVED_FULL_SHA>
git rev-parse HEAD
git status --porcelain
```

The last command must be empty. Do not deploy a moving branch name.

## 3. Create production configuration

```bash
cp deploy/vps/env.example deploy/vps/.env.production
chmod 600 deploy/vps/.env.production
```

Populate real values locally. Set:

- `RELEASE_SHA=<APPROVED_FULL_SHA>`;
- `APP_DOMAIN=<production hostname>`;
- `BETTER_AUTH_URL=https://<same production hostname>`;
- a unique high-entropy `BETTER_AUTH_SECRET`;
- `BETTER_AUTH_IP_HEADER=x-la-client-ip`;
- PostgreSQL credentials and a URL-encoded `DATABASE_URL` whose host is `postgres`;
- Pancake credentials/shop ID;
- approved shipping policy.

Review/pin PostgreSQL and Caddy image references (prefer recorded digests) before production promotion.

Do not print the completed environment file into terminal transcripts or logs.

## 4. Prepare DNS without proxying

Create Cloudflare authoritative DNS records for the production hostname pointing to the VPS, but keep proxy status **DNS-only** for initial launch.

Caddy must be reachable on ports 80/443 and the hostname must resolve to the VPS before public certificate issuance can succeed.

Do not enable Cloudflare proxying until Caddy trusted-proxy/client-IP parsing is separately configured and verified.

## 5. Configure resilient database backup

The deploy helper creates a local custom-format `pg_dump` before migrations. That protects against some migration failures but does not protect against VPS loss.

Before go-live configure:

- scheduled encrypted/off-site copy or independent database backup destination;
- retention appropriate to the shop;
- monitoring for failed/stale backups;
- a restore drill into an isolated PostgreSQL instance;
- documented restore location/credentials available to the operator without relying on the failed VPS.

Record one successful restore test before launch.

## 6. Complete controlled Pancake production acceptance

The existing read-only Pancake contract probe is not a substitute for the write-path launch gate.

Using an explicitly managed test order, perform exactly one controlled:

```text
create -> verify returned/remote order -> cancel/void according to verified Pancake capability
```

If the create outcome is ambiguous, mark/reconcile it as `SYNC_UNKNOWN`. Never submit a blind second create request.

Record only non-secret evidence: timestamp, local order reference, confirmed Pancake order ID/status where safe, and cleanup result.

## 7. Run exact-SHA production deploy

From the clean detached checkout:

```bash
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /var/backups/la-clothing
bash deploy/vps/deploy.sh
```

The helper must pass:

```text
exact checkout == RELEASE_SHA
Compose config
Docker image build
PostgreSQL health
pnpm release:check
pre-migration pg_dump
prisma migrate deploy
app /shop health
```

A failure at any stage is a release blocker. Diagnose before rerunning; do not bypass the failed gate.

## 8. Public acceptance

After Caddy has a valid certificate, verify from an external client:

- HTTP redirects to HTTPS;
- homepage loads;
- `/shop` loads;
- product/cart flow is usable;
- checkout availability renders without creating a throwaway live order;
- order tracking path is reachable;
- security headers remain present;
- Caddy/app logs show no new errors or secret/PII leakage.

Review container state:

```bash
docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml ps
```

## 9. Monitoring/maintenance handoff

Before calling production complete, configure and test alerts/checks for:

- public HTTPS uptime;
- application/container unhealthy/restart loop;
- disk space and inode exhaustion;
- PostgreSQL container/database health;
- backup freshness/failure;
- unusually high application error rate;
- host security updates/reboot needs.

Define log retention so Docker/Caddy logs cannot consume the disk indefinitely.

## 10. Rollback readiness

Keep the previous known-good `la-clothing:<full-sha>` image locally until the new release has baked successfully.

Application-only rollback:

```bash
bash deploy/vps/rollback.sh <PREVIOUS_APPROVED_FULL_SHA>
```

Do not use this command as a database rollback. If a migration/data restore is required, follow the release-specific database recovery plan and validate restored data before switching the application.

Pancake side effects are external and survive application/database rollback; reconcile them explicitly.
