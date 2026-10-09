/**
 * HTTP routes for the feed service:
 *   GET  /v1/manifest.json     manifest with the live feed config overlaid (kill switch),
 *                              signed (Ed25519 envelope); 503 without a signing key, never unsigned
 *   GET  /v1/{snapshots,deltas,allowlist,shared-hosts}/…   published files, immutable
 *   POST /sb/hashes-search     Safe Browsing proxy
 *   GET|PUT /admin/config      feed config, bearer ADMIN_TOKEN
 * Nothing under state/, logs/, or config/ is ever served.
 */
import type { Manifest } from "@warden/shared/feed-format";
import { importPrivateKey, signManifest } from "@warden/shared/signed-manifest";
import { loadConfig, saveConfig } from "./config.ts";
import { MANIFEST_KEY } from "./publish.ts";
import {
  handleSbSearch,
  type PrefixCache,
  type RateLimiter,
  type UpstreamBudget,
} from "./sb-proxy.ts";
import { type BlobStore, getJson } from "./storage.ts";

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
  /** Base64 PKCS#8 Ed25519 private key (Worker secret MANIFEST_SIGNING_KEY). */
  signingKey: string | undefined;
  /** Key id the extension's bundled manifest-keys.json lists (MANIFEST_KEY_ID). */
  signingKid: string | undefined;
}

/** The imported signing key, per Worker instance; re-imported if the secret changes. */
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;
function signingKeyFor(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = importPrivateKey(secret);
    // A bad secret must not stay cached as a rejected promise.
    key.catch(() => {
      if (cachedKey?.key === key) cachedKey = null;
    });
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

const PUBLIC_FILE = /^v1\/(snapshots|deltas|allowlist|shared-hosts)\/[A-Za-z0-9._-]+$/;

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
    const manifest = await getJson<Manifest>(deps.store, MANIFEST_KEY);
    if (!manifest) return text("not published yet", 404);
    // The kill switch must reach clients within one sync, without waiting for a publish.
    const live: Manifest = { ...manifest, feeds: await loadConfig(deps.store) };
    if (!deps.signingKey || !deps.signingKid) {
      console.error(
        "[warden-feeds] manifest signing not configured: set MANIFEST_SIGNING_KEY and MANIFEST_KEY_ID",
      );
      return text("manifest signing not configured", 503);
    }
    let signed: Awaited<ReturnType<typeof signManifest>>;
    try {
      signed = await signManifest(live, await signingKeyFor(deps.signingKey), deps.signingKid);
    } catch (err) {
      console.error("[warden-feeds] manifest signing key unusable", err);
      return text("manifest signing not configured", 503);
    }
    return new Response(JSON.stringify(signed), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
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
    return Response.json(await saveConfig(deps.store, body));
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
