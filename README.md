# LA Clothing

Editorial men's fashion ecommerce storefront with Pancake POS integration.

## Stack

- Next.js 16.2.11 / React 19.2 / TypeScript
- Tailwind CSS v4
- PostgreSQL + Prisma 7.9.1
- Better Auth
- Pancake POS adapter under `src/integrations/pancake/`
- pnpm 11.4.0 on Node.js 22+

## Local commands

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm dev
```

Quality gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

`pnpm prisma:migrate:deploy` applies checked-in production migrations.

## Production deployment

The active production architecture is a self-managed VPS using Docker Compose with Next.js, PostgreSQL, and Caddy.

Repository deployment assets live under `deploy/vps/`:

- `env.example` — placeholder-only production configuration template;
- `compose.yml` — app/PostgreSQL/Caddy/ops topology;
- `Caddyfile` — TLS reverse proxy and trusted client-IP boundary;
- `deploy.sh` — exact-SHA preflight, backup, migration, promotion, and health flow;
- `rollback.sh` — application-image rollback only.

See:

- `docs/decisions/0002-vps-production-infrastructure.md`
- `docs/operations/vps-bootstrap.md`
- `docs/operations/release-and-rollback.md`

Production secrets and VPS credentials must never be committed to this repository.
