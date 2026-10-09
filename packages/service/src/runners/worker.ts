/**
 * Cloudflare Worker entry: HTTP routes plus the hourly cron that runs the pipeline.
 * WARDEN_DEV_FEEDS=1 (local dev only, e.g. `wrangler dev --var WARDEN_DEV_FEEDS:1`) also
 * publishes eval-only feeds such as OpenPhish, reading and writing under `dev/` so that data
 * can never be served from the production keys.
 */
import { handleRequest } from "../app.ts";
import { runPipeline } from "../run.ts";
import type { PrefixCache, RateLimiter, UpstreamBudget } from "../sb-proxy.ts";
import { createSigner } from "../signing.ts";
import { type BlobStore, prefixedStore } from "../storage.ts";
import { r2Store } from "./r2-store.ts";

export interface Env {
  FEEDS: R2Bucket;
  SB_RATE_LIMITER?: RateLimiter;
  /** Overall cap on Safe Browsing calls to Google (key "upstream"). */
  SB_UPSTREAM_LIMITER?: RateLimiter;
  SB_API_KEY?: string;
  ADMIN_TOKEN?: string;
  ALERT_WEBHOOK_URL?: string;
  WARDEN_DEV_FEEDS?: string;
  /** Base64 PKCS#8 Ed25519 key that signs the manifest (`keygen.ts`). */
  MANIFEST_SIGNING_KEY?: string;
  MANIFEST_KEY_ID?: string;
}

const devFeeds = (env: Env) => env.WARDEN_DEV_FEEDS === "1";

/** Safe Browsing answers per prefix in this data center's Cache API (never with an IP). */
const sbCache: PrefixCache = {
  async get(prefix) {
    const res = await caches.default.match(sbCacheKey(prefix));
    return res ? ((await res.json()) as { value: unknown; expiresAt: number }) : null;
  },
  async put(prefix, value, expiresAt) {
    const ttl = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    const body = JSON.stringify({ value, expiresAt });
    await caches.default.put(
      sbCacheKey(prefix),
      new Response(body, { headers: { "cache-control": `max-age=${ttl}` } }),
    );
  },
};
const sbCacheKey = (prefix: string) =>
  new Request(`https://sb-cache.warden.invalid/${encodeURIComponent(prefix)}`);

const budgetFor = (env: Env): UpstreamBudget | undefined => {
  const limiter = env.SB_UPSTREAM_LIMITER;
  return limiter
    ? { take: async () => (await limiter.limit({ key: "upstream" })).success }
    : undefined;
};
const storeFor = (env: Env): BlobStore =>
  devFeeds(env) ? prefixedStore(r2Store(env.FEEDS), "dev/") : r2Store(env.FEEDS);

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const budget = budgetFor(env);
    return handleRequest(request, {
      store: storeFor(env),
      fetch,
      sbApiKey: env.SB_API_KEY,
      sbLimiter: env.SB_RATE_LIMITER,
      sbCache,
      ...(budget ? { sbBudget: budget } : {}),
      adminToken: env.ADMIN_TOKEN,
      signer: createSigner(env.MANIFEST_SIGNING_KEY, env.MANIFEST_KEY_ID),
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runPipeline({
        store: storeFor(env),
        fetch,
        now: Date.now(),
        devFeeds: devFeeds(env),
        signer: createSigner(env.MANIFEST_SIGNING_KEY, env.MANIFEST_KEY_ID),
        ...(env.ALERT_WEBHOOK_URL ? { alertWebhook: env.ALERT_WEBHOOK_URL } : {}),
      }).then((log) =>
        console.log(
          `[warden-feeds] run published=${log.published} version=${log.version} alerts=${log.alerts.length}`,
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
