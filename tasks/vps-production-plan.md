# Plan: VPS production readiness

## Objective
Prepare the repository for a self-managed VPS production deployment without requiring VPS credentials or inventing production secrets/domain values.

## Dependency graph
1. Record the infrastructure decision that supersedes Render.
2. Add deterministic container/build/runtime assets.
3. Add exact-SHA deploy, preflight, migration, backup, and rollback helpers.
4. Add CI verification for the container path.
5. Replace the active release runbook with the VPS procedure and handoff checklist.

## Tasks

### Task 1: Record the VPS infrastructure decision
**Acceptance criteria:**
- ADR 0001 remains as history and is marked superseded.
- ADR 0002 defines VPS, Docker Compose, PostgreSQL, Caddy, DNS/TLS, secrets, backup, observability, and exact-SHA release constraints.

**Verification:** review rendered Markdown and links.

### Task 2: Add production container topology
**Acceptance criteria:**
- Dockerfile uses the pinned Node/pnpm contract and a non-root runtime.
- Compose keeps PostgreSQL and Next.js off public host ports; only Caddy publishes 80/443.
- Runtime health checks `/shop` and the proxy overwrites the trusted application client-IP header.
- No real secrets are committed.

**Verification:** `docker compose --env-file deploy/vps/env.example -f deploy/vps/compose.yml config --quiet`; Docker build/runtime CI smoke.

### Task 3: Add release/rollback helpers
**Acceptance criteria:**
- Deploy helper refuses a dirty/mismatched checkout and tags the image by exact `RELEASE_SHA`.
- Production `release:check` runs before migration.
- A pre-migration logical database dump is created before `prisma migrate deploy`.
- Rollback changes application image only and never claims to reverse database or Pancake side effects.

**Verification:** shell syntax check plus CI/container path; destructive/live operations remain VPS-only.

### Task 4: Add CI verification
**Acceptance criteria:**
- CI validates Compose syntax using placeholder values.
- CI builds both runtime and operations Docker targets.
- CI runs migrations/preflight in the operations image and proves `/shop` reaches healthy state in the runtime image against PostgreSQL.

**Verification:** GitHub Actions run on this branch/PR.

### Task 5: Update the active operations runbook
**Acceptance criteria:**
- Runbook describes bootstrap, exact-SHA release, DNS/TLS, backup, rollback, Pancake acceptance, and post-release evidence for VPS.
- It clearly separates repo-ready work from host-only work that the VPS agent must perform.

**Verification:** documentation review against ADR 0002 and project Definition of Done.

## Boundaries
- Do not provision or mutate a real VPS from this repository change.
- Do not commit production credentials, SSH keys, Cloudflare tokens, or Pancake secrets.
- Do not enable Cloudflare proxying at launch until the origin trusted-proxy configuration is reviewed.
- Do not automate a live Pancake create-order smoke test.
- Do not treat an application rollback as a database or Pancake rollback.
