/**
 * Keeps crawled pages off private networks. A phishing page's scripts run in the crawler's
 * browser, so without this they could probe the machine running it (localhost services,
 * the router, cloud metadata endpoints). Every request's host is resolved and blocked if
 * any address is loopback, private, link-local, or otherwise non-public.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return blocked.check(mapped[1], "ipv4");
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type Resolver = (host: string) => Promise<string[]>;

export const dnsResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export type HostVerdict = "allow" | "private" | "unresolved";

/** Caches per host. Hosts that don't resolve are refused too (and reported as such). */
export function createHostGuard(resolve: Resolver = dnsResolver) {
  const cache = new Map<string, Promise<HostVerdict>>();
  return (host: string): Promise<HostVerdict> => {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    let verdict = cache.get(h);
    if (!verdict) {
      verdict = (async () => {
        if (h === "localhost" || h.endsWith(".localhost")) return "private";
        if (isIP(h)) return isPrivateAddress(h) ? "private" : "allow";
        let addresses: string[];
        try {
          addresses = await resolve(h);
        } catch {
          return "unresolved";
        }
        if (addresses.length === 0) return "unresolved";
        return addresses.every((a) => !isPrivateAddress(a)) ? "allow" : "private";
      })();
      cache.set(h, verdict);
    }
    return verdict;
  };
}
