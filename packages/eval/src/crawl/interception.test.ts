import { describe, expect, it } from "vitest";
import type { CrawlRecord } from "./crawler.ts";
import { classifyInterception, isTlsReset } from "./interception.ts";

const snap = (title: string, text: string) => ({ title, text }) as CrawlRecord["snapshot"];

describe("classifyInterception", () => {
  it("recognizes an ISP filter by its block host or text", () => {
    expect(
      classifyInterception({
        ok: true,
        final_url: "https://block.charter-prod.hosted.cujo.io/warn.html?url=x",
        snapshot: snap("", "Suspicious Site Blocked This site was blocked"),
      }),
    ).toBe("network-filter");
    expect(
      classifyInterception({
        ok: true,
        final_url: "https://x.example/",
        snapshot: snap("", "Suspicious Site Blocked ..."),
      }),
    ).toBe("network-filter");
  });

  it("recognizes CDN and host takedown pages", () => {
    expect(
      classifyInterception({
        ok: true,
        final_url: "https://p.example/",
        snapshot: snap("Suspected Phishing | Cloudflare", ""),
      }),
    ).toBe("provider-takedown");
    expect(
      classifyInterception({
        ok: true,
        final_url: "https://p.example/",
        snapshot: snap("Account Suspended", ""),
      }),
    ).toBe("provider-takedown");
  });

  it("leaves real pages alone", () => {
    expect(
      classifyInterception({
        ok: true,
        final_url: "https://p.example/",
        snapshot: snap("Sign in to your account", "Email"),
      }),
    ).toBeNull();
  });
});

describe("isTlsReset", () => {
  it("flags cut-off TLS handshakes on failed crawls", () => {
    expect(
      isTlsReset({ ok: false, error: "page.goto: net::ERR_SSL_PROTOCOL_ERROR at https://x/" }),
    ).toBe(true);
    expect(isTlsReset({ ok: false, error: "dns: host did not resolve" })).toBe(false);
    expect(isTlsReset({ ok: true })).toBe(false);
  });
});
