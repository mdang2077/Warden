/**
 * Which keys a feed manifest may be signed with. Production keys always; development keys
 * (manifest-dev-keys.json, whose private halves sit in developers' local `.dev.vars`) only
 * when the extension's feed service is on this machine. A store build points at the real
 * service, so a leaked dev key can't sign manifests its users accept.
 */
import type { ManifestKeysFile } from "@warden/shared/signed-manifest";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopback(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function manifestKeysFor(options: {
  feedUrl: string | undefined;
  production: ManifestKeysFile;
  dev: ManifestKeysFile;
}): ManifestKeysFile {
  const dev = isLoopback(options.feedUrl) ? options.dev.keys : [];
  return { keys: [...options.production.keys, ...dev] };
}
