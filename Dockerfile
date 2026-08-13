# syntax=docker/dockerfile:1

FROM node:22.22.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN test "$(pnpm --version)" = "11.4.0" \
  && pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
# Build-only placeholders satisfy configuration imported during compilation.
# They are not production credentials and this stage is not the runtime image.
ENV DATABASE_URL=postgresql://build-only:build-only@127.0.0.1:5432/build-only
ENV BETTER_AUTH_SECRET=build-only-placeholder-secret-0123456789abcdef
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_IP_HEADER=x-build-client-ip
RUN pnpm prisma:generate
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN test "$(pnpm --version)" = "11.4.0" \
  && pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22.22.0-bookworm-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /app/src/generated/prisma ./src/generated/prisma

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/shop').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
