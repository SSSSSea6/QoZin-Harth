ARG NODE_VERSION=24-slim
FROM node:${NODE_VERSION} AS base
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_registry=${NPM_REGISTRY}
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
COPY packages/cli/package.json packages/cli/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter api...

FROM deps AS sdk
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @harth/sdk
COPY packages/sdk ./packages/sdk
RUN pnpm --filter @harth/sdk build

FROM base AS runner
ENV NODE_ENV=production \
    HARTH_TOOLS_DIR=/data/tools
COPY --from=deps /app ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY --from=sdk /app/packages/sdk/dist ./packages/sdk/dist
RUN mkdir -p /data/tools && chown node:node /data/tools
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "api", "start"]
