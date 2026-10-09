/**
 * HTTP routes for the feed service:
 *   GET  /v1/manifest.json     the signed manifest stored at publish time (signing.ts), as-is;
 *                              503 if it hasn't been signed yet, never unsigned
 *   GET  /v1/{snapshots,deltas,allowlist,shared-hosts}/…   published files, immutable
 *   POST /sb/hashes-search     Safe Browsing proxy
 *   GET|PUT /admin/config      feed config, bearer ADMIN_TOKEN
 * Nothing under state/, logs/, or config/ is ever served.
 */
import { loadConfig, saveConfig } from "./config.ts";
import { MANIFEST_KEY } from "./publish.ts";
import {
  handleSbSearch,
  type PrefixCache,
  type RateLimiter,
  type UpstreamBudget,
} from "./sb-proxy.ts";
import { type ManifestSigner, resignManifest, SIGNED_MANIFEST_KEY } from "./signing.ts";
import type { BlobStore } from "./storage.ts";

export interface AppDeps {
  store: BlobStore;
  fetch: typeof fetch;
  sbApiKey: string | undefined;
  sbLimiter: RateLimiter | undefined;
  /** Shared per-prefix Safe Browsing answers (Workers Cache API). */
  sbCache?: PrefixCache;
  /** Overall cap on calls to Google (SB_UPSTREAM_LIMITER). */
  sbBudget?: UpstreamBudget;
  adminToken: string | undefined;
  /** Signs the manifest when the admin changes the feed config (null: no signing key). */
  signer: ManifestSigner | null;
}

/** Every file kind a published manifest can point to (publish.ts). */
const PUBLIC_FILE =
  /^v1\/(snapshots|deltas|allowlist|shared-hosts|popup-networks)\/[A-Za-z0-9._-]+$/;

export async function handleRequest(request: Request, deps: AppDeps): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/+/, "");

  if (path === "sb/hashes-search") {
    return handleSbSearch(request, {
      apiKey: deps.sbApiKey,
      limiter: deps.sbLimiter,
      fetch: deps.fetch,
      ...(deps.sbCache ? { cache: deps.sbCache } : {}),
      ...(deps.sbBudget ? { budget: deps.sbBudget } : {}),
    });
  }
  if (path === "admin/config") return handleAdminConfig(request, deps);
  if (request.method !== "GET") return text("method not allowed", 405);

  if (path === MANIFEST_KEY) {
    const signed = await deps.store.get(SIGNED_MANIFEST_KEY);
    if (signed !== null) {
      return new Response(signed, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      });
    }
    if ((await deps.store.get(MANIFEST_KEY)) === null) return text("not published yet", 404);
    console.error(
      "[warden-feeds] manifest published but not signed: set MANIFEST_SIGNING_KEY and MANIFEST_KEY_ID",
    );
    return text("manifest not signed yet", 503);
  }

  if (PUBLIC_FILE.test(path) && !path.includes("..")) {
    const body = await deps.store.get(path);
    if (body === null) return text("not found", 404);
    return new Response(body, {
      headers: {
        "content-type": path.endsWith(".txt") ? "text/plain" : "application/json",
        // Every published file is versioned or content-addressed, so it never changes.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  return text("not found", 404);
}

async function handleAdminConfig(request: Request, deps: AppDeps): Promise<Response> {
  if (!deps.adminToken) return text("not configured", 503);
  const auth = request.headers.get("authorization") ?? "";
  if (!(await constantTimeEqual(auth, `Bearer ${deps.adminToken}`))) {
    return text("unauthorized", 401);
  }
  if (request.method === "GET") {
    return Response.json(await loadConfig(deps.store));
  }
  if (request.method === "PUT") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return text("expected JSON", 400);
    }
    // The config only reaches clients inside the signed manifest, so a change that can't be
    // signed is refused rather than saved and silently not served.
    if (!deps.signer) return text("manifest signing not configured", 503);
    const config = await saveConfig(deps.store, body);
    try {
      await resignManifest(deps.store, deps.signer);
    } catch (err) {
      console.error("[warden-feeds] re-signing after a config change failed", err);
      return text("config saved, but the manifest couldn't be re-signed", 500);
    }
    return Response.json(config);
  }
  return text("method not allowed", 405);
}

/** Compares via SHA-256 digests so timing doesn't depend on where the strings differ. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}
