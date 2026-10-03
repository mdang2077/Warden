import { describe, expect, it, vi } from "vitest";
import { memoryStore } from "../storage.ts";
import { ENTRY_TTL_MS, ingest } from "./ingest.ts";
import { OPENPHISH_URL, openphish } from "./openphish.ts";
import { createPhishStats } from "./phishstats.ts";
import { parseUrlLines } from "./types.ts";

const HOUR = 60 * 60_000;

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function textResponse(body: string, headers: Record<string, string> = {}, status = 200) {
  return new Response(status === 304 ? null : body, { status, headers });
}

describe("parseUrlLines", () => {
  it("keeps http(s) lines only", () => {
    expect(
      parseUrlLines("https://a.example/\n\n# comment\nftp://x\n  http://b.example/x  \r\n"),
    ).toEqual(["https://a.example/", "http://b.example/x"]);
  });
});

describe("ingest (OpenPhish)", () => {
  it("records first_seen and last_seen and sends conditional headers", async () => {
    const store = memoryStore();
    const fetchFn = vi.fn(async (..._args: FetchArgs) =>
      textResponse("https://a.example/\nhttps://b.example/\n", { etag: '"v1"' }),
    );
    const first = await ingest(openphish, store, fetchFn as typeof fetch, 1000);
    expect(fetchFn).toHaveBeenCalledWith(OPENPHISH_URL, expect.anything());
    expect(first.records).toEqual([
      { url: "https://a.example/", source: "openphish", first_seen: 1000, last_seen: 1000 },
      { url: "https://b.example/", source: "openphish", first_seen: 1000, last_seen: 1000 },
    ]);

    fetchFn.mockImplementationOnce(async () => textResponse("", {}, 304));
    const second = await ingest(openphish, store, fetchFn as typeof fetch, 1000 + HOUR);
    expect(second.notModified).toBe(true);
    const headers = fetchFn.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers["if-none-match"]).toBe('"v1"');
    // A 304 means the same list is still live: last_seen moves forward.
    expect(second.records.map((r) => r.last_seen)).toEqual([1000 + HOUR, 1000 + HOUR]);
    expect(second.records.map((r) => r.first_seen)).toEqual([1000, 1000]);
  });

  it("doesn't poll before the minimum interval", async () => {
    const store = memoryStore();
    const fetchFn = vi.fn(async (..._args: FetchArgs) => textResponse("https://a.example/\n"));
    await ingest(openphish, store, fetchFn as typeof fetch, 0);
    const again = await ingest(openphish, store, fetchFn as typeof fetch, HOUR / 2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(again.polled).toBe(false);
    expect(again.records).toHaveLength(1);
  });

  it("keeps dropped-off URLs until the TTL, then forgets them", async () => {
    const store = memoryStore();
    const fetchFn = vi.fn(async (..._args: FetchArgs) => textResponse("https://a.example/\n"));
    await ingest(openphish, store, fetchFn as typeof fetch, 0);
    fetchFn.mockImplementation(async () => textResponse("https://b.example/\n"));
    const soon = await ingest(openphish, store, fetchFn as typeof fetch, HOUR);
    expect(soon.records.map((r) => r.url).sort()).toEqual([
      "https://a.example/",
      "https://b.example/",
    ]);
    const later = await ingest(openphish, store, fetchFn as typeof fetch, ENTRY_TTL_MS + 2 * HOUR);
    expect(later.records.map((r) => r.url)).toEqual(["https://b.example/"]);
  });

  it("fails open: a failed poll keeps the previous records", async () => {
    const store = memoryStore();
    const fetchFn = vi.fn(async (..._args: FetchArgs) => textResponse("https://a.example/\n"));
    await ingest(openphish, store, fetchFn as typeof fetch, 0);
    fetchFn.mockImplementation(async () => textResponse("", {}, 500));
    const out = await ingest(openphish, store, fetchFn as typeof fetch, HOUR);
    expect(out.error).toContain("500");
    expect(out.records).toEqual([
      { url: "https://a.example/", source: "openphish", first_seen: 0, last_seen: 0 },
    ]);
  });
});

describe("PhishStats", () => {
  it("keeps only entries at or above the score threshold", async () => {
    const fetchFn = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(
          JSON.stringify([
            { url: "https://hi.example/", score: 8.2 },
            { url: "https://lo.example/", score: 3 },
            { url: "javascript:alert(1)", score: 10 },
            { score: 9 },
          ]),
        ),
    );
    const result = await createPhishStats({ minScore: 7 }).poll(fetchFn as typeof fetch, {});
    expect(result).toEqual({ status: "updated", urls: ["https://hi.example/"] });
  });
});
