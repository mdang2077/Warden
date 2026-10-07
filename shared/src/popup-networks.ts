/**
 * Popup-network list: domains of ad networks whose click and redirect hops carry
 * pop-unders, tab-unders, and forced redirects. The backend builds it from EasyList's
 * `$popup` filters merged with the bundled list below (which is also the extension's
 * fallback until its first sync). The extension compiles it into hijack DNR rules
 * (extension/src/lib/hijack-rules.ts).
 *
 * Not an allowlist input: "not phishing" says nothing about whether a domain is a pop network.
 */
import bundled from "./popup-networks.json" with { type: "json" };

export interface PopupNetworkSource {
  name: string;
  license: string;
  url: string;
}

export interface PopupNetworksFile {
  version: number;
  generatedAt: string;
  sources: PopupNetworkSource[];
  domains: string[];
}

export interface PopupNetworkList {
  version: number;
  /** Sorted, deduplicated. */
  domains: readonly string[];
  /** True for a listed domain or any subdomain of one. */
  has(host: string): boolean;
}

/** Lowercase host names with at least one dot; no wildcards, ports, or paths. */
export const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function loadPopupNetworks(file: PopupNetworksFile): PopupNetworkList {
  if (!Number.isInteger(file.version) || file.version < 1) {
    throw new Error(`popup-networks: bad version ${file.version}`);
  }
  if (!Array.isArray(file.domains)) throw new Error("popup-networks: domains must be an array");
  const set = new Set<string>();
  for (const d of file.domains as unknown[]) {
    if (typeof d !== "string" || !DOMAIN_PATTERN.test(d)) {
      throw new Error(`popup-networks: bad domain ${String(d)}`);
    }
    set.add(d);
  }
  return {
    version: file.version,
    domains: [...set].sort(),
    has(host) {
      const h = host.toLowerCase().replace(/\.$/, "");
      if (set.has(h)) return true;
      for (let i = h.indexOf("."); i !== -1; i = h.indexOf(".", i + 1)) {
        if (set.has(h.slice(i + 1))) return true;
      }
      return false;
    },
  };
}

export function isPopupNetworkUrl(list: PopupNetworkList, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return list.has(url.hostname);
}

export const bundledPopupNetworksFile: PopupNetworksFile = bundled;
export const bundledPopupNetworks: PopupNetworkList = loadPopupNetworks(bundled);
