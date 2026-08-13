# VPS production readiness checklist

- [ ] ADR 0002 supersedes the Render decision without deleting history.
- [ ] Dockerfile builds a production Next.js runtime using Node 22.22.0 and pnpm 11.4.0.
- [ ] Compose defines app, PostgreSQL, Caddy, and an ops/migration service.
- [ ] Caddy is the only service exposing public HTTP(S) ports.
- [ ] Caddy overwrites `X-LA-Client-IP`; app uses `BETTER_AUTH_IP_HEADER=x-la-client-ip`.
- [ ] Production env template contains placeholders only.
- [ ] Exact-SHA deploy helper runs preflight -> DB dump -> migration -> app promotion -> health check.
- [ ] Rollback helper only promotes a locally available previous application image.
- [ ] CI validates Compose and exercises the Docker runtime against PostgreSQL.
- [ ] Active release/rollback runbook reflects VPS, not Render.
- [ ] VPS-agent handoff lists firewall/SSH, Docker install, DNS, real secrets, off-site backup, restore drill, monitoring, and live acceptance gates.
