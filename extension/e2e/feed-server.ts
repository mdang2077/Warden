/**
 * Minimal stand-in for the feed service, for e2e tests. Publishes one snapshot with a
 * single OpenPhish entry and answers the Safe Browsing proxy with "no hits".
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

export const FEED_SERVER_PORT = 47123;
export const FEED_SERVER_URL = `http://127.0.0.1:${FEED_SERVER_PORT}`;
/** Bare-host entry, so it compiles to a `||host/` DNR rule. */
export const FEED_BLOCKED_HOST = "phish-feed.warden-test.example";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function buildFiles(): Map<string, string> {
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
    feeds: {
      openphish: { enabled: true, tier: "A" },
      phishing_database: { enabled: false, tier: "B" },
      phishstats: { enabled: false, tier: "B" },
    },
  };
  files.set("v1/manifest.json", JSON.stringify(manifest));
  return files;
}

export function startFeedServer(): Promise<http.Server> {
  const files = buildFiles();
  const server = http.createServer((req, res) => {
    const key = (req.url ?? "/").slice(1);
    if (key === "sb/hashes-search" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cacheDuration: "300s" }));
      return;
    }
    const body = files.get(key);
    res.writeHead(body === undefined ? 404 : 200);
    res.end(body ?? "not found");
  });
  return new Promise((resolve) =>
    server.listen(FEED_SERVER_PORT, "127.0.0.1", () => resolve(server)),
  );
}
