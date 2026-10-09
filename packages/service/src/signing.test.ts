import {
  generateManifestKeyPair,
  importPublicKeys,
  verifyManifest,
} from "@warden/shared/signed-manifest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIG_KEY, DEFAULT_FEED_CONFIG } from "./config.ts";
import { MANIFEST_KEY } from "./publish.ts";
import { createSigner, resignManifest, SIGNED_MANIFEST_KEY } from "./signing.ts";
import { memoryStore } from "./storage.ts";

let pair: { publicKey: string; privateKey: string };
beforeAll(async () => {
  pair = await generateManifestKeyPair();
});
const keys = () => importPublicKeys({ keys: [{ kid: "t1", publicKey: pair.publicKey }] });

describe("createSigner", () => {
  it("is null without a key or a key id", () => {
    expect(createSigner(undefined, "t1")).toBeNull();
    expect(createSigner(pair.privateKey, undefined)).toBeNull();
  });

  it("imports the key once, not per signature", async () => {
    const signer = createSigner(pair.privateKey, "t1");
    if (!signer) throw new Error("no signer");
    const m = { schema: 1, version: 1, feeds: DEFAULT_FEED_CONFIG } as never;
    await signer(m);
    const spy = vi.spyOn(crypto.subtle, "importKey");
    await signer(m);
    await signer(m);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects (and doesn't cache the failure) with an unusable key", async () => {
    const bad = createSigner("bm90IGEga2V5", "t1");
    if (!bad) throw new Error("no signer");
    await expect(bad({ schema: 1 } as never)).rejects.toThrow();
    await expect(bad({ schema: 1 } as never)).rejects.toThrow();
  });
});

describe("resignManifest", () => {
  it("stores the published manifest signed, with the current feed config", async () => {
    const store = memoryStore();
    await store.put(
      MANIFEST_KEY,
      JSON.stringify({ schema: 1, version: 5, feeds: DEFAULT_FEED_CONFIG }),
    );
    await store.put(CONFIG_KEY, JSON.stringify({ openphish: { enabled: false, tier: "A" } }));
    const signer = createSigner(pair.privateKey, "t1");
    expect(await resignManifest(store, signer, () => 1_234)).toBe(true);
    const m = await verifyManifest((await store.get(SIGNED_MANIFEST_KEY)) as string, await keys());
    expect(m).toMatchObject({ version: 5, signedAt: 1_234 });
    expect(m.feeds.openphish.enabled).toBe(false);
  });

  it("does nothing before the first publish or without a signer", async () => {
    const store = memoryStore();
    expect(await resignManifest(store, createSigner(pair.privateKey, "t1"))).toBe(false);
    await store.put(MANIFEST_KEY, JSON.stringify({ schema: 1, version: 5 }));
    expect(await resignManifest(store, null)).toBe(false);
    expect(await store.get(SIGNED_MANIFEST_KEY)).toBeNull();
  });
});
