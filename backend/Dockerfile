# Build from the repo root so the workspace lockfile is in context:
#   docker build -f backend/Dockerfile -t qrreward-api .
FROM node:22-alpine AS base
# Pinned rather than `corepack enable`, so a build cannot silently change package manager
# version between deploys.
RUN npm i -g pnpm@11.4.0

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Before install, because backend's postinstall is `prisma generate` and it needs these.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/prisma.config.ts
# `--filter qrreward-backend...` installs that package and what it depends on, so the
# frontend's tree is never fetched for an API build.
RUN pnpm install --frozen-lockfile --filter qrreward-backend...
COPY backend/ backend/
# `pnpm build` runs `prisma generate` first. Prisma 7 emits the client as TypeScript, so tsc
# compiles it alongside the rest of src/ — nothing extra to copy into the runtime image.
RUN pnpm -C backend run build

FROM base
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
# The migration runner needs the schema, the migration history, and the CLI config at
# runtime; they are copied before install so postinstall's `prisma generate` can find them.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/prisma.config.ts
RUN pnpm install --frozen-lockfile --prod --filter qrreward-backend...
# Set after the install, not before: postinstall runs `prisma generate`, and prisma.config.ts
# demands a real DATABASE_URL once NODE_ENV=production — which a build machine has no reason
# to hold. `--prod` above already excludes devDependencies on its own.
ENV NODE_ENV=production
COPY --from=build /app/backend/dist backend/dist
# Run unprivileged: a QR render bug should not have root in the container.
USER node
EXPOSE 4000
WORKDIR /app/backend
# Migrate before serving, then `exec` so node replaces the shell and receives SIGTERM
# directly — the app drains in-flight requests on that signal.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/src/main.js"]
