# VPS bootstrap handoff

This runbook is for the agent/operator that has shell access to the production VPS. Repository preparation does **not** prove these host steps have happened.

The active edge topology is defined by [ADR 0003](../decisions/0003-shared-host-npm-edge.md), which amends ADR 0002 for the selected shared VPS: nginx-proxy-manager (NPM) owns public 80/81/443 and TLS, while LA Clothing's Caddy is internal-only.

## Inputs required before host work

- intended production domain;
- exact approved Git commit SHA after VPS-readiness review/CI;
- production Pancake API key and shop ID;
- production Better Auth secret;
- selected VPS IP/provider and backup destination;
- approved SSH administration source/access model;
- existing NPM Docker network name and the smallest reviewed CIDR that contains the trusted NPM proxy hop.

Never paste production secrets into issues, PRs, CI logs, or chat transcripts used as public/project records.

## 1. Harden and inventory the host

Use a supported Linux release. Apply security updates before installing the application stack.

Create a non-root operator with key-based SSH. Verify replacement access in a second session before disabling password/root SSH. Restrict inbound traffic so only the deliberately chosen SSH path and the existing public edge ports are reachable.

This VPS already hosts unrelated production services. **Do not stop, replace, or rebind the existing nginx-proxy-manager stack.** Before changing Docker/network/firewall state, record the current listeners and running containers so LA Clothing does not cause an outage to other services.

Install/verify Docker Engine and Docker Compose from an official source. Treat membership/access to the Docker daemon as root-equivalent.

Record:

```text
OS/version:
Docker version:
Docker Compose version:
VPS public IP:
operator account:
firewall policy:
NPM container/stack:
NPM Docker network:
NPM network CIDR:
existing host listeners on 80/81/443:
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
- approved shipping policy;
- `EDGE_NETWORK_NAME=<existing NPM Docker network>`;
- `EDGE_TRUSTED_PROXY_CIDR=<smallest reviewed CIDR containing the NPM proxy hop>`.

The repository intentionally uses non-production fallback values only so CI can parse the Compose/Caddy model. **Never deploy with `la-clothing-edge-unconfigured` or `192.0.2.1/32`.** Add the real edge values to the protected `.env.production` file before promotion.

Review/pin PostgreSQL and Caddy image references (prefer recorded digests) before production promotion.

Do not print the completed environment file into terminal transcripts or logs.

## 4. Prepare the shared NPM edge

Inspect the existing NPM network before launch:

```bash
docker network inspect <EDGE_NETWORK_NAME>
```

Confirm NPM is attached to that network and record the network subnet/CIDR. Scope `EDGE_TRUSTED_PROXY_CIDR` as tightly as the stable host topology allows; do not use all Docker private ranges.

The LA Clothing Compose stack joins Caddy to this external network using the stable alias:

```text
la-clothing-caddy
```

In the existing NPM admin UI, add **only a new Proxy Host for LA Clothing**. Do not edit unrelated live proxy hosts.

Configure the LA Clothing proxy host to:

```text
Domain: <APP_DOMAIN>
Forward scheme: http
Forward host/name: la-clothing-caddy
Forward port: 80
TLS/certificate: managed by NPM
HTTP -> HTTPS: enabled after certificate issuance
```

NPM's default proxy path appends `X-Forwarded-For`; Caddy uses strict right-to-left trusted-proxy parsing and then overwrites `X-LA-Client-IP` before Next.js receives the request.

Keep Cloudflare authoritative DNS **DNS-only** for the initial launch. Point the production hostname to the VPS. NPM, not Caddy, owns public certificate issuance and host ports 80/443 on this shared server.

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

Before running the helper, verify the external edge network exists and the real edge values are present locally without printing the rest of the environment file.

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

## 8. Public acceptance through NPM -> Caddy -> app

After NPM has a valid certificate, verify from an external client:

- HTTP redirects to HTTPS;
- homepage loads;
- `/shop` loads;
- product/cart flow is usable;
- checkout availability renders without creating a throwaway live order;
- order tracking path is reachable;
- security headers remain present;
- client-IP attribution/rate-limit behavior does not collapse all visitors to the NPM container IP;
- NPM/Caddy/app logs show no new errors or secret/PII leakage.

Review container state:

```bash
docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml ps
```

Confirm Caddy has **no published host ports** and is attached to both the private backend network and the selected external NPM network.

## 9. Monitoring/maintenance handoff

Before calling production complete, configure and test alerts/checks for:

- public HTTPS uptime through NPM;
- NPM availability/certificate renewal;
- application/container unhealthy/restart loop;
- disk space and inode exhaustion;
- PostgreSQL container/database health;
- backup freshness/failure;
- unusually high application error rate;
- host security updates/reboot needs.

Back up or otherwise preserve the host-specific NPM proxy-host configuration. Define log retention so Docker/NPM/Caddy logs cannot consume the disk indefinitely.

## 10. Rollback readiness

Keep the previous known-good `la-clothing:<full-sha>` image locally until the new release has baked successfully.

Application-only rollback:

```bash
bash deploy/vps/rollback.sh <PREVIOUS_APPROVED_FULL_SHA>
```

Do not use this command as a database rollback. If a migration/data restore is required, follow the release-specific database recovery plan and validate restored data before switching the application.

Pancake side effects are external and survive application/database rollback; reconcile them explicitly.
