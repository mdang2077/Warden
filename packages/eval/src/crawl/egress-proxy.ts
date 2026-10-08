/**
 * Filtering egress proxy for the crawler. Chromium sends every connection through it
 * (HTTP requests, HTTPS and WebSocket tunnels, preconnects), and the proxy:
 *
 * - resolves the host itself and refuses it if any address is private, loopback, or
 *   link-local (the same rules as network-guard.ts);
 * - connects to the exact address it checked, so a DNS-rebinding page can't swap in a
 *   private address between the check and the connection.
 *
 * This is the layer Playwright's request routing can't provide: routing never sees
 * preconnects or WebRTC (the latter is also disabled by a Chromium flag in crawler.ts).
 */
import http from "node:http";
import net from "node:net";
import { dnsResolver, isPrivateAddress, type Resolver } from "./network-guard.ts";

export interface EgressProxyOptions {
  resolveHost?: Resolver;
  /** Opens the upstream TCP connection to a checked address. Tests redirect it. */
  dial?: (address: string, port: number) => net.Socket;
  onRefused?: (host: string, reason: "private" | "unresolved") => void;
}

export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, for Chromium's proxy setting. */
  url: string;
  close(): Promise<void>;
}

const defaultDial = (address: string, port: number) => net.connect({ host: address, port });

export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const resolve = options.resolveHost ?? dnsResolver;
  const dial = options.dial ?? defaultDial;

  /** A checked public address for `host`, or null (refused). */
  async function check(host: string): Promise<string | null> {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    let addresses: string[];
    if (net.isIP(h)) addresses = [h];
    else if (h === "localhost" || h.endsWith(".localhost")) addresses = ["127.0.0.1"];
    else {
      try {
        addresses = await resolve(h);
      } catch {
        addresses = [];
      }
    }
    if (addresses.length === 0) {
      options.onRefused?.(h, "unresolved");
      return null;
    }
    if (addresses.some(isPrivateAddress)) {
      options.onRefused?.(h, "private");
      return null;
    }
    return addresses[0] as string;
  }

  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    return s;
  };

  const server = http.createServer(async (req, res) => {
    // Plain HTTP arrives in absolute form: GET http://host/path HTTP/1.1
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const address = await check(target.hostname);
    if (!address) {
      res.writeHead(403).end("refused by crawler egress proxy");
      return;
    }
    const port = Number(target.port || 80);
    const upstream = http.request({
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: req.headers,
      // Connect to the checked address, whatever DNS says now.
      createConnection: () => track(dial(address, port)),
    });
    upstream.on("response", (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // HTTPS and WebSocket (wss/ws via CONNECT) tunnels.
  server.on("connect", async (req, client: net.Socket, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url ?? "");
    const address = match ? await check(match[1] as string) : null;
    if (!match || !address) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = track(dial(address, Number(match[2])));
    upstream.on("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => {
      if (client.writable) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
