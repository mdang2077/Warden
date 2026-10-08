import { describe, expect, it } from "vitest";
import { manifestKeysFor } from "./manifest-trust.ts";

const prod = { keys: [{ kid: "p1", publicKey: "P" }] };
const dev = { keys: [{ kid: "k1", publicKey: "D" }] };
const kids = (feedUrl: string | undefined) =>
  manifestKeysFor({ feedUrl, production: prod, dev }).keys.map((k) => k.kid);

describe("manifestKeysFor", () => {
  it("trusts dev keys only for a feed service on this machine", () => {
    expect(kids("http://127.0.0.1:8787")).toEqual(["p1", "k1"]);
    expect(kids("http://localhost:8787/")).toEqual(["p1", "k1"]);
    expect(kids("http://[::1]:8787")).toEqual(["p1", "k1"]);
  });

  it("never trusts dev keys for a remote service, a lookalike host, or no service", () => {
    expect(kids("https://warden-feeds.example.workers.dev")).toEqual(["p1"]);
    expect(kids("http://127.0.0.1.evil.example")).toEqual(["p1"]);
    expect(kids("http://localhost.evil.example")).toEqual(["p1"]);
    expect(kids(undefined)).toEqual(["p1"]);
    expect(kids("not a url")).toEqual(["p1"]);
  });
});
