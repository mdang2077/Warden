import { canonicalize } from "@warden/shared/canonicalize";
import { sha256, toHex } from "@warden/shared/expressions";
import { describe, expect, it, vi } from "vitest";
import {
  base64ToHex,
  createSafeBrowsingClient,
  hexToBase64,
  parseDuration,
  type SearchHashesResponse,
} from "./safe-browsing.ts";

const URL_ =
  canonicalize("https://evil.example/login") ??
  (() => {
    throw new Error();
  })();

async function fullHashB64(expression: string) {
  return hexToBase64(toHex(await sha256(expression)));
}

function fakeFetch(body: SearchHashesResponse | (() => Promise<Response>), status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    typeof body === "function" ? body() : new Response(JSON.stringify(body), { status }),
  );
}

describe("encoding helpers", () => {
  it("round-trips hex and base64", () => {
    expect(base64ToHex(hexToBase64("ba7816bf"))).toBe("ba7816bf");
  });

  it("parses durations", () => {
    expect(parseDuration("300s")).toBe(300_000);
    expect(parseDuration("12.5s")).toBe(12_500);
    expect(parseDuration(undefined)).toBe(300_000);
    expect(parseDuration("bogus")).toBe(300_000);
  });
});

describe("Safe Browsing client", () => {
  it("sends only 4-byte prefixes, base64-encoded", async () => {
    const f = fakeFetch({});
    await createSafeBrowsingClient({ endpoint: "https://proxy/sb", fetch: f }).check(URL_);
    const body = JSON.parse(String(f.mock.calls[0]?.[1]?.body)) as { prefixes: string[] };
    expect(body.prefixes.length).toBeGreaterThan(0);
    for (const p of body.prefixes) expect(atob(p)).toHaveLength(4);
    expect(String(f.mock.calls[0]?.[1]?.body)).not.toContain("evil.example");
  });

  it("reports a phishing hit when a full hash matches", async () => {
    const f = fakeFetch({
      fullHashes: [
        {
          fullHash: await fullHashB64("evil.example/"),
          fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING" }],
        },
      ],
      cacheDuration: "300s",
    });
    const v = await createSafeBrowsingClient({ endpoint: "x", fetch: f }).check(URL_);
    expect(v).toEqual({ hit: true, expressions: ["evil.example/"] });
  });

  it("ignores other threat types, CANARY, and FRAME_ONLY", async () => {
    const hash = await fullHashB64("evil.example/");
    for (const details of [
      [{ threatType: "MALWARE" }],
      [{ threatType: "SOCIAL_ENGINEERING", attributes: ["CANARY"] }],
      [{ threatType: "SOCIAL_ENGINEERING", attributes: ["FRAME_ONLY"] }],
      [],
    ]) {
      const f = fakeFetch({ fullHashes: [{ fullHash: hash, fullHashDetails: details }] });
      const v = await createSafeBrowsingClient({ endpoint: "x", fetch: f }).check(URL_);
      expect(v.hit).toBe(false);
    }
  });

  it("ignores a full hash that only shares the prefix", async () => {
    const real = base64ToHex(await fullHashB64("evil.example/"));
    const collision = hexToBase64(real.slice(0, 8) + "0".repeat(56));
    const f = fakeFetch({
      fullHashes: [
        { fullHash: collision, fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING" }] },
      ],
    });
    expect((await createSafeBrowsingClient({ endpoint: "x", fetch: f }).check(URL_)).hit).toBe(
      false,
    );
  });

  it("caches hits and misses for cacheDuration", async () => {
    let t = 0;
    const f = fakeFetch({ cacheDuration: "60s" });
    const client = createSafeBrowsingClient({ endpoint: "x", fetch: f, now: () => t });
    await client.check(URL_);
    await client.check(URL_);
    expect(f).toHaveBeenCalledTimes(1);
    t = 61_000;
    await client.check(URL_);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("fails open on HTTP errors, network errors, and timeouts", async () => {
    const failures = [
      fakeFetch({}, 503),
      fakeFetch(() => Promise.reject(new TypeError("network down"))),
      fakeFetch(() => new Promise<Response>(() => {})),
    ];
    for (const f of failures) {
      const client = createSafeBrowsingClient({ endpoint: "x", fetch: f, timeoutMs: 20 });
      const v = await Promise.race([
        client.check(URL_),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung")), 1000)),
      ]);
      expect(v.hit).toBe(false);
      expect(v.error).toBeTruthy();
    }
  });

  it("does not cache failures", async () => {
    const f = fakeFetch({}, 503);
    const client = createSafeBrowsingClient({ endpoint: "x", fetch: f });
    await client.check(URL_);
    await client.check(URL_);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
