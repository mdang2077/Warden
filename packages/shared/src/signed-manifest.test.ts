import { describe, expect, it } from "vitest";
import type { Manifest } from "./feed-format.ts";
import keysFile from "./manifest-keys.json" with { type: "json" };
import {
  generateManifestKeyPair,
  importPrivateKey,
  importPublicKeys,
  ManifestSignatureError,
  type SignedManifest,
  signManifest,
  verifyManifest,
} from "./signed-manifest.ts";

const manifest = {
  schema: 1,
  version: 7,
  created: 7,
  snapshot: { key: "v1/snapshots/7.json", sha256: "aa" },
  deltas: [],
  allowlist: { key: "v1/allowlist/a.txt", sha256: "bb", count: 1 },
  sharedHosts: { key: "v1/shared-hosts/1.json", sha256: "cc", version: 1 },
  feeds: {
    openphish: { enabled: true, tier: "A" },
    phishing_database: { enabled: false, tier: "B" },
    phishstats: { enabled: false, tier: "B" },
  },
} as Manifest;

async function setup(kid = "t1") {
  const pair = await generateManifestKeyPair();
  const keys = await importPublicKeys({ keys: [{ kid, publicKey: pair.publicKey }] });
  const priv = await importPrivateKey(pair.privateKey);
  const signed = await signManifest(manifest, priv, kid);
  return { pair, keys, priv, signed };
}

async function reason(text: string, keys: Awaited<ReturnType<typeof setup>>["keys"]) {
  try {
    await verifyManifest(text, keys);
  } catch (err) {
    if (err instanceof ManifestSignatureError) return err.reason;
    throw err;
  }
  return "verified";
}

describe("signed manifest", () => {
  it("round-trips: what verifies is exactly the signed manifest", async () => {
    const { keys, signed } = await setup();
    expect(signed).toMatchObject({ schema: 1, kid: "t1", alg: "Ed25519" });
    expect(await verifyManifest(JSON.stringify(signed), keys)).toMatchObject(manifest);
  });

  it("rejects an altered payload or signature", async () => {
    const { keys, signed } = await setup();
    const payload = signed.payload.replace('"enabled":true', '"enabled":false');
    expect(await reason(JSON.stringify({ ...signed, payload }), keys)).toBe("bad signature");
    const sig = `${signed.sig.slice(0, -4)}AAA=`;
    expect(await reason(JSON.stringify({ ...signed, sig }), keys)).toBe("bad signature");
  });

  it("rejects an unknown key, another algorithm, or another envelope schema", async () => {
    const { keys, signed } = await setup();
    expect(await reason(JSON.stringify({ ...signed, kid: "other" }), keys)).toBe("unknown key");
    expect(await reason(JSON.stringify({ ...signed, alg: "RS256" }), keys)).toBe("unsupported");
    expect(await reason(JSON.stringify({ ...signed, schema: 2 }), keys)).toBe("unsupported");
  });

  it("rejects malformed envelopes, including an old unsigned manifest", async () => {
    const { keys, signed } = await setup();
    expect(await reason("not json", keys)).toBe("malformed");
    expect(await reason(JSON.stringify(manifest), keys)).toBe("malformed");
    const { sig: _, ...noSig } = signed;
    expect(await reason(JSON.stringify(noSig), keys)).toBe("malformed");
  });

  it("rejects a validly signed payload that isn't a supported manifest", async () => {
    const { keys, priv } = await setup();
    const odd = await signManifest({ ...manifest, schema: 2 } as unknown as Manifest, priv, "t1");
    expect(await reason(JSON.stringify(odd), keys)).toBe("unsupported");
    const notJson: SignedManifest = { ...odd, payload: "{oops" };
    const resigned = await signManifest(manifest, priv, "t1");
    expect(await reason(JSON.stringify({ ...notJson, sig: resigned.sig }), keys)).toBe(
      "bad signature",
    );
  });

  it("trusts every listed key, for rotation", async () => {
    const a = await generateManifestKeyPair();
    const b = await generateManifestKeyPair();
    const keys = await importPublicKeys({
      keys: [
        { kid: "k1", publicKey: a.publicKey },
        { kid: "k2", publicKey: b.publicKey },
      ],
    });
    for (const [kid, pair] of [
      ["k1", a],
      ["k2", b],
    ] as const) {
      const signed = await signManifest(manifest, await importPrivateKey(pair.privateKey), kid);
      expect(await verifyManifest(JSON.stringify(signed), keys)).toMatchObject(manifest);
    }
  });

  it("imports a private key pasted with surrounding whitespace and line breaks", async () => {
    const { pair, keys } = await setup();
    const pasted = `\n  ${pair.privateKey.slice(0, 20)}\n${pair.privateKey.slice(20)}  \n`;
    const signed = await signManifest(manifest, await importPrivateKey(pasted), "t1");
    expect(await verifyManifest(JSON.stringify(signed), keys)).toMatchObject(manifest);
  });

  it("refuses a public key that isn't 32 raw bytes", async () => {
    await expect(importPublicKeys({ keys: [{ kid: "x", publicKey: "AAAA" }] })).rejects.toThrow();
  });

  it("ships a keys file in the expected shape", async () => {
    expect(Array.isArray(keysFile.keys)).toBe(true);
    await importPublicKeys(keysFile);
  });
});

describe("signing time", () => {
  it("stamps the signing time into the signed payload", async () => {
    const { keys, priv } = await setup();
    const signed = await signManifest(manifest, priv, "t1", 1_234);
    expect(await verifyManifest(JSON.stringify(signed), keys)).toEqual({
      ...manifest,
      signedAt: 1_234,
    });
  });
});
