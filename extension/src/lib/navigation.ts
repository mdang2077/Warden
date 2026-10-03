/**
 * Which top-frame navigations Warden evaluates. Only http(s) to public hosts:
 * browser pages, extension pages, local files, localhost, and private-network
 * addresses are never checked (and so can never be blocked).
 */

export function shouldEvaluate(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !isLocalHost(url.hostname);
}

/** `hostname` as returned by `URL`: lowercase, IPv4 normalized, IPv6 in brackets. */
export function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.startsWith("[")) return isPrivateIPv6(hostname.slice(1, -1));
  const v4 = parseIPv4(hostname);
  return v4 !== null && isPrivateIPv4(v4);
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIPv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return false;
  return (
    a === 0 || // "this network", incl. 0.0.0.0
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped?.[1]) {
    const v4 = parseIPv4(mapped[1]);
    return v4 !== null && isPrivateIPv4(v4);
  }
  // URL serializes IPv4-mapped addresses as hex, e.g. ::ffff:7f00:1.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex?.[1] && mappedHex[2]) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    return isPrivateIPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
  );
}
