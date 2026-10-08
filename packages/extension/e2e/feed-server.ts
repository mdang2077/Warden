/**
 * Minimal stand-in for the feed service, for e2e tests. Publishes one snapshot with a
 * single OpenPhish entry and answers the Safe Browsing proxy with "no hits". The manifest is
 * served signed with the e2e test key, like the real Worker; `setManifestTampered(true)`
 * serves an envelope whose payload was edited after signing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { importPrivateKey, signManifest } from "@warden/shared/signed-manifest";
import { E2E_MANIFEST_KID, E2E_MANIFEST_PRIVATE_KEY } from "./manifest-test-key.ts";

export const FEED_SERVER_PORT = 47123;
export const FEED_SERVER_URL = `http://127.0.0.1:${FEED_SERVER_PORT}`;
/** Bare-host entry, so it compiles to a `||host/` DNR rule. */
export const FEED_BLOCKED_HOST = "phish-feed.warden-test.example";
/** The one popup-network domain the e2e feed publishes. */
export const POPNET_DOMAIN = "popnet-test.example";
export const POPNET_HOST = `go.${POPNET_DOMAIN}`;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function buildFiles(): { files: Map<string, string>; manifest: unknown } {
  const files = new Map<string, string>();
  const put = (key: string, text: string) => {
    files.set(key, text);
    return { key, sha256: sha256(text) };
  };

  const expression = `${FEED_BLOCKED_HOST}/`;
  const snapshot = {
    schema: 1,
    version: 1,
    created: 1,
    feeds: {
      openphish: [{ hash: sha256(expression), expression, expiresAt: Date.now() + 86_400_000 }],
    },
  };
  const sharedText = readFileSync(
    path.resolve(import.meta.dirname, "../../shared/src/shared-hosts.json"),
    "utf8",
  );
  const manifest = {
    schema: 1,
    version: 1,
    created: 1,
    snapshot: put("v1/snapshots/1.json", JSON.stringify(snapshot)),
    deltas: [],
    allowlist: { ...put("v1/allowlist/a.txt", "google.com\n"), count: 1 },
    sharedHosts: {
      ...put("v1/shared-hosts/1.json", sharedText),
      version: JSON.parse(sharedText).version,
    },
    popupNetworks: {
      ...put(
        "v1/popup-networks/1.json",
        JSON.stringify({ version: 1, generatedAt: "", sources: [], domains: [POPNET_DOMAIN] }),
      ),
      version: 1,
    },
    feeds: {
      openphish: { enabled: true, tier: "A" },
      phishing_database: { enabled: false, tier: "B" },
      phishstats: { enabled: false, tier: "B" },
    },
  };
  return { files, manifest };
}

let tampered = false;
/** Serve a manifest edited after signing (until set back to false). */
export function setManifestTampered(on: boolean): void {
  tampered = on;
}

export async function startFeedServer(): Promise<http.Server> {
  const { files, manifest } = buildFiles();
  const key = await importPrivateKey(E2E_MANIFEST_PRIVATE_KEY);
  const signed = await signManifest(
    manifest as Parameters<typeof signManifest>[0],
    key,
    E2E_MANIFEST_KID,
  );
  files.set("v1/manifest.json", JSON.stringify(signed));
  // An attacker turning on a Tier B feed it controls: valid-looking, but the signature is stale.
  const forged = JSON.stringify({
    ...signed,
    payload: signed.payload.replace(
      '"phishing_database":{"enabled":false',
      '"phishing_database":{"enabled":true',
    ),
  });
  const server = http.createServer((req, res) => {
    const key = (req.url ?? "/").slice(1);
    if (key === "sb/hashes-search" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cacheDuration: "300s" }));
      return;
    }
    const body = key === "v1/manifest.json" && tampered ? forged : files.get(key);
    res.writeHead(body === undefined ? 404 : 200);
    res.end(body ?? "not found");
  });
  return new Promise((resolve) =>
    server.listen(FEED_SERVER_PORT, "127.0.0.1", () => resolve(server)),
  );
}
