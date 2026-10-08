# Warden phish crawler (S2.3). Build context: the repo root; ignore rules are in
# Dockerfile.dockerignore next to this file.
#   docker compose -f packages/eval/docker/compose.yaml up -d --build
FROM node:24-bookworm-slim

ENV CI=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/service/package.json packages/service/
COPY packages/eval/package.json packages/eval/
COPY packages/extension/package.json packages/extension/
RUN pnpm install --frozen-lockfile --filter "@warden/eval..."

# Chromium and its system libraries, installed where the non-root user can read them.
RUN pnpm --filter @warden/eval exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

COPY packages/shared/src packages/shared/src
COPY packages/service/src packages/service/src
COPY packages/eval/src packages/eval/src

RUN useradd --create-home --uid 10001 crawler && mkdir /data && chown crawler /data
USER crawler

ENTRYPOINT ["node", "packages/eval/src/crawl/watch.ts", "--data", "/data"]
CMD ["--interval", "30"]
