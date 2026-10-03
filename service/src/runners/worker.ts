/** Cloudflare Worker entry: HTTP routes plus the hourly cron that runs the pipeline. */
import { handleRequest } from "../app.ts";
import { runPipeline } from "../run.ts";
import type { RateLimiter } from "../sb-proxy.ts";
import { r2Store } from "./r2-store.ts";

export interface Env {
  FEEDS: R2Bucket;
  SB_RATE_LIMITER?: RateLimiter;
  SB_API_KEY?: string;
  ADMIN_TOKEN?: string;
  ALERT_WEBHOOK_URL?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      store: r2Store(env.FEEDS),
      fetch,
      sbApiKey: env.SB_API_KEY,
      sbLimiter: env.SB_RATE_LIMITER,
      adminToken: env.ADMIN_TOKEN,
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runPipeline({
        store: r2Store(env.FEEDS),
        fetch,
        now: Date.now(),
        ...(env.ALERT_WEBHOOK_URL ? { alertWebhook: env.ALERT_WEBHOOK_URL } : {}),
      }).then((log) =>
        console.log(
          `[warden-feeds] run published=${log.published} version=${log.version} alerts=${log.alerts.length}`,
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
