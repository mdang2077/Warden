/**
 * Generates an Ed25519 keypair for signing the feed manifest.
 *
 *   node packages/service/src/runners/keygen.ts [--kid k2]
 *     Prints the private key (for `wrangler secret put MANIFEST_SIGNING_KEY`) and the public
 *     key (for packages/shared/src/manifest-keys.json).
 *   node packages/service/src/runners/keygen.ts --dev-vars [--kid k1]
 *     Writes MANIFEST_SIGNING_KEY and MANIFEST_KEY_ID into packages/service/.dev.vars (read by
 *     `wrangler dev`, gitignored) and prints only the public key. Refuses to replace a key
 *     already there.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateManifestKeyPair } from "@warden/shared/signed-manifest";

const { values } = parseArgs({
  options: {
    kid: { type: "string", default: "k1" },
    "dev-vars": { type: "boolean", default: false },
  },
});
const kid = values.kid;
const pair = await generateManifestKeyPair();
const keysEntry = JSON.stringify({ kid, publicKey: pair.publicKey });

if (values["dev-vars"]) {
  const file = path.resolve(import.meta.dirname, "../../.dev.vars");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^MANIFEST_SIGNING_KEY=/m.test(current)) {
    console.error(`${file} already has MANIFEST_SIGNING_KEY; remove it first to replace it.`);
    process.exit(1);
  }
  const sep = current && !current.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${sep}MANIFEST_SIGNING_KEY=${pair.privateKey}\nMANIFEST_KEY_ID=${kid}\n`);
  console.log(`Wrote the private key to ${file} (gitignored).`);
} else {
  console.log("Private key (keep secret):");
  console.log(`  wrangler secret put MANIFEST_SIGNING_KEY   # paste: ${pair.privateKey}`);
  console.log(`  wrangler secret put MANIFEST_KEY_ID        # value: ${kid}`);
}
console.log("\nAdd this public key to packages/shared/src/manifest-keys.json:");
console.log(`  ${keysEntry}`);
