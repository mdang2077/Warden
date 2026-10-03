import { bundledSharedHosts as shared } from "@warden/shared/shared-hosts";
import { describe, expect, it, vi } from "vitest";
import { parseTrancoCsv, refreshAllowlist, TRANCO_BASE } from "./allowlist-source.ts";
import { memoryStore } from "./storage.ts";

const CSV = "1,google.com\n2,facebook.com\n3,docs.google.com\n4,example.org\r\n";

function trancoFetch(csv = CSV) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `${TRANCO_BASE}/top-1m-id`) return new Response("ABC12");
    if (url === `${TRANCO_BASE}/download/ABC12/4`) return new Response(csv);
    return new Response("", { status: 404 });
  });
}

describe("Tranco allowlist", () => {
  it("parses rank,domain CSV", () => {
    expect(parseTrancoCsv(CSV)).toEqual([
      "google.com",
      "facebook.com",
      "docs.google.com",
      "example.org",
    ]);
  });

  it("builds and stores the list, then reuses it for a day", async () => {
    const store = memoryStore();
    const f = trancoFetch();
    const first = await refreshAllowlist(store, f as typeof fetch, shared, 0, 4);
    expect(first.refreshed).toBe(true);
    expect(first.text).toBe("example.org\nfacebook.com\ngoogle.com\n");

    const again = await refreshAllowlist(store, f as typeof fetch, shared, 60_000, 4);
    expect(again.refreshed).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good list when a refresh fails", async () => {
    const store = memoryStore();
    await refreshAllowlist(store, trancoFetch() as typeof fetch, shared, 0, 4);
    const failing = vi.fn(async () => new Response("", { status: 503 }));
    const out = await refreshAllowlist(store, failing as typeof fetch, shared, 2 * 86_400_000, 4);
    expect(out.error).toContain("503");
    expect(out.text).toContain("google.com");
  });

  it("rejects a truncated list", async () => {
    const store = memoryStore();
    const out = await refreshAllowlist(
      store,
      trancoFetch("1,google.com\n") as typeof fetch,
      shared,
      0,
      4,
    );
    expect(out.error).toContain("too short");
    expect(out.text).toBeNull();
  });
});
