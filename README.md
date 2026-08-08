# LA Clothing

Editorial men's fashion storefront with Pancake POS as the commerce source of truth.

## Planned stack

- Next.js 16 Active LTS / React 19.2 / TypeScript
- Tailwind CSS v4
- PostgreSQL + Prisma (next increment)
- Pancake POS adapter isolated under `src/integrations/pancake/`

## Commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm test:domain` is available for dependency-free domain tests during the initial integration spike.

## Current build status

The source baseline is being created incrementally. Dependency installation/build requires registry network access; do not interpret source presence as a successful Next.js build until those commands are observed green.
