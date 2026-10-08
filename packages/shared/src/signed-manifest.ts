/**
 * Signed feed manifest (T4b.17). The Worker serves the manifest as an envelope whose
 * `payload` is the exact manifest JSON string and whose `sig` is an Ed25519 signature over
 * that string's UTF-8 bytes. The extension accepts a manifest only if it verifies against a
 * bundled public key (`manifest-keys.json`, every listed key trusted, for rotation). The
 * manifest pins every other file by SHA-256, so this authenticates the whole sync.
 *
 * WebCrypto only, so the same code runs in the Worker, the extension, and Node tests.
 * Design: docs/design/2026-10-07-manifest-signing-design.md.
 */
import { FORMAT_SCHEMA, type Manifest } from "./feed-format.ts";

export interface SignedManifest {
  schema: 1;
  kid: string;
  alg: "Ed25519";
  payload: string;
  /** Base64 Ed25519 signature over the UTF-8 bytes of `payload`. */
  sig: string;
}

export interface ManifestKeysFile {
  /** `publicKey`: base64 of the raw 32-byte Ed25519 public key. */
  keys: { kid: string; publicKey: string }[];
}

export type ManifestKeys = ReadonlyMap<string, CryptoKey>;

export type SignatureFailure = "malformed" | "unknown key" | "bad signature" | "unsupported";

export class ManifestSignatureError extends Error {
  constructor(readonly reason: SignatureFailure) {
    super(`manifest signature invalid: ${reason}`);
    this.name = "ManifestSignatureError";
  }
}

const ALG = { name: "Ed25519" } as const;
const ENVELOPE_SCHEMA = 1;

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importPublicKeys(file: ManifestKeysFile): Promise<ManifestKeys> {
  const keys = new Map<string, CryptoKey>();
  for (const { kid, publicKey } of file.keys) {
    const raw = fromBase64(publicKey);
    if (raw.length !== 32) throw new Error(`manifest key ${kid}: expected 32 raw bytes`);
    keys.set(kid, await crypto.subtle.importKey("raw", raw, ALG, false, ["verify"]));
  }
  return keys;
}

/** Imports a base64 PKCS#8 private key; whitespace and line breaks from pasting are ignored. */
export function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromBase64(pkcs8Base64), ALG, false, ["sign"]);
}

export async function generateManifestKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const pair = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    publicKey: toBase64((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    privateKey: toBase64((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer),
  };
}

export async function signManifest(
  manifest: Manifest,
  key: CryptoKey,
  kid: string,
): Promise<SignedManifest> {
  const payload = JSON.stringify(manifest);
  const sig = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(payload));
  return { schema: ENVELOPE_SCHEMA, kid, alg: "Ed25519", payload, sig: toBase64(sig) };
}

/** Returns the manifest inside a valid envelope; throws ManifestSignatureError otherwise. */
export async function verifyManifest(text: string, keys: ManifestKeys): Promise<Manifest> {
  let env: Partial<Record<keyof SignedManifest, unknown>>;
  try {
    env = JSON.parse(text) as typeof env;
  } catch {
    throw new ManifestSignatureError("malformed");
  }
  if (
    !env ||
    typeof env !== "object" ||
    typeof env.schema !== "number" ||
    typeof env.kid !== "string" ||
    typeof env.alg !== "string" ||
    typeof env.payload !== "string" ||
    typeof env.sig !== "string"
  ) {
    throw new ManifestSignatureError("malformed");
  }
  if (env.schema !== ENVELOPE_SCHEMA || env.alg !== "Ed25519") {
    throw new ManifestSignatureError("unsupported");
  }
  const key = keys.get(env.kid);
  if (!key) throw new ManifestSignatureError("unknown key");

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      ALG,
      key,
      fromBase64(env.sig),
      new TextEncoder().encode(env.payload),
    );
  } catch {
    ok = false; // undecodable or wrong-length signature
  }
  if (!ok) throw new ManifestSignatureError("bad signature");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(env.payload) as Manifest;
  } catch {
    throw new ManifestSignatureError("malformed");
  }
  if (manifest?.schema !== FORMAT_SCHEMA) throw new ManifestSignatureError("unsupported");
  return manifest;
}
