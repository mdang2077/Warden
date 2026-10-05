# Warden phish crawler (S2.3). Build context: the repo root.
#   docker compose -f docker/crawler/compose.yaml up -d --build
FROM node:24-bookworm-slim

ENV CI=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY service/package.json service/
COPY eval/package.json eval/
COPY extension/package.json extension/
RUN pnpm install --frozen-lockfile --filter "@warden/eval..."

# Chromium and its system libraries, installed where the non-root user can read them.
RUN pnpm --filter @warden/eval exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

COPY shared/src shared/src
COPY service/src service/src
COPY eval/src eval/src

RUN useradd --create-home --uid 10001 crawler && mkdir /data && chown crawler /data
USER crawler

ENTRYPOINT ["node", "eval/src/crawl/watch.ts", "--data", "/data"]
CMD ["--interval", "30"]
