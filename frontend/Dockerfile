# Build from the repo root:
#   docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t qrreward-web .
FROM node:22-alpine AS base
# Pinned rather than `corepack enable`, so a build cannot silently change package manager
# version between deploys.
RUN npm i -g pnpm@11.4.0

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# `--filter qrreward-frontend...` installs that package and what it depends on, so the
# backend's tree is never fetched for a web build.
RUN pnpm install --frozen-lockfile --filter qrreward-frontend...
COPY frontend/ frontend/
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so the API origin has to
# be known here — it cannot be changed by setting an env var on the running container.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm -C frontend run build

FROM base
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --prod --filter qrreward-frontend...
COPY --from=build /app/frontend/.next frontend/.next
USER node
EXPOSE 3000
WORKDIR /app/frontend
# Straight to the binary so node is PID 1 and gets SIGTERM without a shell in between.
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
