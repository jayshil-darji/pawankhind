# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# ---- build: install everything, compile ----
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schemas/package.json packages/schemas/
COPY services/registration/package.json services/registration/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/schemas packages/schemas
COPY services/registration services/registration
RUN pnpm --filter "@pawankhind/registration..." build

# ---- runtime: production deps only + compiled output ----
FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schemas/package.json packages/schemas/
COPY services/registration/package.json services/registration/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/services/registration/dist services/registration/dist
USER node
WORKDIR /app/services/registration
EXPOSE 3001
CMD ["node", "dist/main.js"]