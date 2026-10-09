/**
 * Publish-time manifest signing. The hourly pipeline and the admin config route sign the
 * published manifest (with the current feed config) and store the envelope; the manifest
 * route serves that stored envelope as-is and never signs. So someone who can write to
 * storage but doesn't hold the key can't get a manifest or config change signed, and putting
 * back an older envelope is caught by the extension's replay check (`signedAt`).
 */
import type { Manifest } from "@warden/shared/feed-format";
import {
  importPrivateKey,
  type SignedManifest,
  signManifest,
} from "@warden/shared/signed-manifest";
import { loadConfig } from "./config.ts";
import { MANIFEST_KEY } from "./publish.ts";
import { type BlobStore, getJson } from "./storage.ts";

/** Where the signed envelope is stored; served only by the manifest route. */
export const SIGNED_MANIFEST_KEY = "v1/manifest.signed.json";

export type ManifestSigner = (manifest: Manifest, signedAt?: number) => Promise<SignedManifest>;

/** A signer for the Worker secrets, or null when either is missing. Imports the key once. */
export function createSigner(
  secret: string | undefined,
  kid: string | undefined,
): ManifestSigner | null {
  if (!secret || !kid) return null;
  let key: Promise<CryptoKey> | null = null;
  return async (manifest, signedAt) => {
    key ??= importPrivateKey(secret);
    try {
      return await signManifest(manifest, await key, kid, signedAt);
    } catch (err) {
      key = null; // an unusable key must not stay cached as a rejected promise
      throw err;
    }
  };
}

/**
 * Signs the published manifest with the current feed config and stores the envelope.
 * Returns false (and stores nothing) before the first publish or without a signer.
 */
export async function resignManifest(
  store: BlobStore,
  signer: ManifestSigner | null,
  now: () => number = Date.now,
): Promise<boolean> {
  if (!signer) return false;
  const manifest = await getJson<Manifest>(store, MANIFEST_KEY);
  if (!manifest) return false;
  const live: Manifest = { ...manifest, feeds: await loadConfig(store) };
  const signed = await signer(live, now());
  await store.put(SIGNED_MANIFEST_KEY, JSON.stringify(signed), "application/json");
  return true;
}
