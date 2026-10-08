/**
 * Sign-in and payment hosts that legitimately open in a popup from a button click
 * (not a link). Strict mode always lets new tabs to these through (see
 * packages/extension/src/lib/hijack-detect.ts). Exact hosts only: a subdomain could be anyone's.
 */
import bundled from "./auth-popups.json" with { type: "json" };

const HOSTS = new Set(bundled.hosts);

export function isAuthPopupHost(host: string): boolean {
  return HOSTS.has(host.toLowerCase().replace(/\.$/, ""));
}
